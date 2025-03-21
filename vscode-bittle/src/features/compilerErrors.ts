import * as vscode from 'vscode';
import { log } from '../log';
import { CompilerService } from '../services/compilerService';
import { interceptExceptionsAsync } from '../utils/interceptExceptions';
import { stream } from '../utils/stream';

export interface CompilerErrorProvider extends vscode.Disposable {
    updateDiagnostics(): Promise<void>;
}

export function createCompilerErrorProvider(compilerService: CompilerService): CompilerErrorProvider {
    if (process.platform === 'linux' && process.arch === 'arm64') {
        return new CompilerErrorProviderImpl(compilerService);
    } else {
        return new DummyErrorProvider();
    }
}

class DummyErrorProvider implements CompilerErrorProvider {
    dispose() {
        // Nothing to do
    }

    async updateDiagnostics() {
        // Nothing to do
    }
}

class CompilerErrorProviderImpl implements CompilerErrorProvider {
    private diagnosticsCollection = vscode.languages.createDiagnosticCollection('Bittle');

    constructor(
        private compilerService: CompilerService,
    ) { }

    dispose() {
        this.diagnosticsCollection.dispose();
    }

    @interceptExceptionsAsync
    async updateDiagnostics() {
        this.diagnosticsCollection.clear();

        const fileDiagnostics = [];
        for (const document of vscode.workspace.textDocuments) {
            if (!document.isDirty && document.fileName.endsWith('.btl') && document.uri.scheme === 'file') {
                const fileDiagnostic = await this.getFileDiagnostic(document);
                if (fileDiagnostic) {
                    fileDiagnostics.push(fileDiagnostic);
                }
            }
        }

        for (const [fileName, diagnostics] of stream(fileDiagnostics).groupBy(d => d.fileName)) {
            this.diagnosticsCollection.set(
                vscode.Uri.file(fileName),
                diagnostics.map(d => d.diagnostic),
            );
        }
    }

    async getFileDiagnostic(document: vscode.TextDocument) {
        const { exitCode, stderr } = await this.compilerService.compile(document.fileName);

        log.log(`Compiler exited with code ${exitCode}.`);
        log.log(`Compiler output: ${stderr}`);

        if (exitCode === 0) {
            return;
        }
        return makeDiagnostic(exitCode, stderr, document);
    }
}

type FileDiagnostic = {
    fileName: string;
    diagnostic: vscode.Diagnostic;
};

function makeDiagnostic(exitCode: number | undefined, stderr: string, document: vscode.TextDocument): FileDiagnostic {
    const match = /^(.*?):(\d+):(\d+):(.*)/s.exec(stderr);
    if (match) {
        let fileName = match[1];
        if (fileName === '<stdin>') {
            fileName = document.fileName;
        }
        const row = parseInt(match[2]) - 1;
        const col = parseInt(match[3]) - 1;
        const diagnostic = new vscode.Diagnostic(
            new vscode.Range(row, col, row, col),
            match[4].trim(),
            vscode.DiagnosticSeverity.Error,
        );
        diagnostic.source = 'Bittle compiler';
        if (fileName !== document.fileName) {
            diagnostic.relatedInformation = [
                new vscode.DiagnosticRelatedInformation(
                    new vscode.Location(document.uri, new vscode.Range(0, 0, 0, 0)),
                    `From compiler output for ${fileName}`,
                ),
            ];
        }
        return {
            fileName,
            diagnostic,
        };
    } else {
        let message: string;
        if (stderr.trim()) {
            message = 'Compiler error: ' + stderr;
        } else {
            message = `Unknown compiler error (exit code ${exitCode}).`;
        }
        const diagnostic = new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 0),
            message,
            vscode.DiagnosticSeverity.Error,
        );
        diagnostic.source = 'Bittle compiler';
        return {
            fileName: document.fileName,
            diagnostic,
        };
    }
}
