import * as vscode from 'vscode';
import { ElaborationService } from '../services/elaborationService';
import { toVscRange } from '../utils';
import { ReactiveCache } from '../utils/reactiveCache';
import { stream } from '../utils/stream';

export class ElaborationErrorProvider implements vscode.Disposable {
    private diagnosticsCollection = vscode.languages.createDiagnosticCollection('Cog');

    constructor(
        private elaborationService: ElaborationService,
        private cache: ReactiveCache,
    ) { }

    dispose() {
        this.diagnosticsCollection.dispose();
    }

    updateDiagnostics() {
        this.diagnosticsCollection.clear();
        stream(vscode.workspace.textDocuments)
            .filter(doc => doc.languageId === 'cog')
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
        const errors = this.elaborationService.getErrors(document.fileName);
        return stream(errors)
            .groupBy<string>(error => error.location.file)
            .map<[vscode.Uri, vscode.Diagnostic[]]>(([path, errors]) => {
                return [
                    vscode.Uri.file(path),
                    errors.map(error => {
                        return new vscode.Diagnostic(
                            toVscRange(error.location.range),
                            error.message,
                            vscode.DiagnosticSeverity.Error,
                        );
                    }),
                ];
            })
            .toArray();
    }
}
