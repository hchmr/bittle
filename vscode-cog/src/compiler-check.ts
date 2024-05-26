import { spawn } from "child_process";
import { workspace, Diagnostic, DiagnosticRelatedInformation, DiagnosticSeverity, TextDocument, Range, Location } from "vscode";
import { log } from "./extension";

async function compile(document: TextDocument) {
    log.appendLine(`Invoking compiler for ${document.fileName}`);

    const cogc = workspace.getConfiguration().get<string>('cog.compilerPath', 'cogc');
    const process = spawn(
        cogc,
        [document.fileName],
        {
            stdio: ['ignore', 'ignore', 'pipe'],
            timeout: 1000,
        }
    );

    let stderr = '';
    process.stderr.on('data', data => {
        stderr += data.toString();
    });

    const code = await new Promise(resolve => {
        process.on('close', code => {
            resolve(code ?? 'unknown');
        });
        process.on('error', error => {
            log.appendLine(`Error invoking compiler: ${error}`);
            resolve('unknown');
        });
    });
    log.appendLine(`Compiler exited with code ${code}`);

    return { ok: code == 0, stderr };
}

function makeDiagnostic(stderr: string, document: TextDocument) {
    const match = /^(.*?):(\d+):(\d+):(.*)/s.exec(stderr);
    if (match) {
        let fileName = match[1];
        if (fileName === '<stdin>') {
            fileName = document.fileName;
        }
        const row = parseInt(match[2]) - 1;
        const col = parseInt(match[3]) - 1;
        const diagnostic = new Diagnostic(
            new Range(row, col, row, col),
            match[4].trim(),
            DiagnosticSeverity.Error
        );
        if (fileName !== document.fileName) {
            diagnostic.relatedInformation = [
                new DiagnosticRelatedInformation(
                    new Location(document.uri, new Range(0, 0, 0, 0)),
                    `From compiler output for ${fileName}`
                )
            ];
        }
        return {
            fileName,
            diagnostic
        };
    } else {
        return {
            fileName: document.fileName,
            diagnostic: new Diagnostic(
                new Range(0, 0, 0, 0),
                stderr,
                DiagnosticSeverity.Error
            )
        };
    }
}

export async function getCompilerDiagnostics(document: TextDocument) {
    if (!(process.platform === 'linux' && process.arch === 'arm64')) {
        return [];
    }
    if (document.uri.scheme !== 'file') {
        return [];
    }
    const { ok, stderr } = await compile(document);

    log.appendLine(`Compiler output: ${ok}, '${stderr}'`);

    return !ok
        ? [makeDiagnostic(stderr, document)]
        : [];
}
