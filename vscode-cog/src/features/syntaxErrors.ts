import { Query } from 'tree-sitter';
import Cog from 'tree-sitter-cog';
import * as vscode from 'vscode';
import { ParsingService } from '../services/parsingService';
import { toVscRange } from '../utils';

export class SyntaxErrorProvider implements vscode.Disposable {
    private readonly errorQuery = new Query(Cog, '(ERROR) @error');
    private diagnosticsCollection = vscode.languages.createDiagnosticCollection('Cog');

    constructor(private parsingService: ParsingService) { }

    dispose() {
        this.diagnosticsCollection.dispose();
    }

    updateDiagnostics(document: vscode.TextDocument) {
        if (document.isClosed) {
            this.diagnosticsCollection.delete(document.uri);
        } else {
            const diagnostics = this.createDiagnosticss(document.uri);
            this.diagnosticsCollection.set(document.uri, diagnostics);
        }
    }

    createDiagnosticss(uri: vscode.Uri) {
        const tree = this.parsingService.parse(uri.fsPath);
        const diagnostics: vscode.Diagnostic[] = [];

        for (const error of this.errorQuery.captures(tree.rootNode)) {
            const diagnostic = new vscode.Diagnostic(
                toVscRange(error.node),
                'Syntax error',
                vscode.DiagnosticSeverity.Error
            );
            diagnostics.push(diagnostic);
        }

        return diagnostics;
    }
}
