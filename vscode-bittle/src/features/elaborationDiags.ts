import * as vscode from 'vscode';
import { ElaborationDiag } from '../semantics/elaborator';
import { SemanticsService } from '../services/semanticsService';
import { interceptExceptions } from '../utils/interceptExceptions';
import { ReactiveCache } from '../utils/reactiveCache';
import { stream } from '../utils/stream';
import { toVscRange } from '../utils/vscode';

export class ElaborationDiagnosticProvider implements vscode.Disposable {
    private diagnosticsCollection = vscode.languages.createDiagnosticCollection('Bittle');

    constructor(
        private semanticsService: SemanticsService,
        private cache: ReactiveCache,
    ) { }

    dispose() {
        this.diagnosticsCollection.dispose();
    }

    @interceptExceptions
    updateDiagnostics() {
        this.diagnosticsCollection.clear();
        stream(vscode.workspace.textDocuments)
            .filter(doc => doc.languageId === 'bittle')
            .flatMap<[vscode.Uri, vscode.Diagnostic[]]>(doc => this.createDiagnostics(doc))
            .groupBy(([uri, _]) => uri.toString())
            .map<[vscode.Uri, vscode.Diagnostic[]]>(([_key, pairs]) => [
                pairs[0][0],
                pairs.flatMap(([_, diagnostic]) => diagnostic),
            ])
            .forEach(([uri, diagnostics]) => {
                this.diagnosticsCollection.set(uri, diagnostics);
            });
    }

    createDiagnostics(document: vscode.TextDocument) {
        return this.cache.compute(
            'elaboration-errors:' + document.uri.toString(),
            () => this.createDiagnosticsUncached(document),
        );
    }

    createDiagnosticsUncached(document: vscode.TextDocument) {
        const diags = this.semanticsService.getDiagnostics(document.fileName);
        return stream(diags)
            .groupBy<string>(diag => diag.location.file)
            .map<[vscode.Uri, vscode.Diagnostic[]]>(([path, diags]) => {
                return [
                    vscode.Uri.file(path),
                    diags.map(diag => {
                        return fromElaborationDiag(diag);
                    }),
                ];
            })
            .toArray();
    }
}

function fromElaborationDiag(diag: ElaborationDiag): vscode.Diagnostic {
    const vscodeDiag = new vscode.Diagnostic(
        toVscRange(diag.location.range),
        diag.message,
        fromElaborationSeverity(diag.severity),
    );
    vscodeDiag.tags = diag.unnecessary ? [vscode.DiagnosticTag.Unnecessary] : [];
    return vscodeDiag;
}

function fromElaborationSeverity(severity: 'error' | 'warning' | 'info' | 'hint'): vscode.DiagnosticSeverity {
    switch (severity) {
        case 'error': return vscode.DiagnosticSeverity.Error;
        case 'warning': return vscode.DiagnosticSeverity.Warning;
        case 'info': return vscode.DiagnosticSeverity.Information;
        case 'hint': return vscode.DiagnosticSeverity.Hint;
    }
}
