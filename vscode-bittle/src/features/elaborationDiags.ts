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
        const map = new Map<vscode.Uri, vscode.Diagnostic[] | undefined>();
        for (const [uri] of this.diagnosticsCollection) {
            map.set(uri, undefined);
        }
        for (const doc of vscode.workspace.textDocuments) {
            if (doc.languageId !== 'bittle') {
                continue;
            }
            const groups = this.createDiagnostics(doc);
            for (const [uri, diags] of groups) {
                const existing = map.get(uri);
                if (existing) {
                    existing.push(...diags);
                } else {
                    map.set(uri, diags);
                }
            }
        }
        for (const [uri, diags] of map) {
            this.diagnosticsCollection.set(uri, diags);
        }
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
