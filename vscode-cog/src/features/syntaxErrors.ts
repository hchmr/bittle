import * as vscode from 'vscode';
import Cog from 'tree-sitter-cog';
import { Query } from 'tree-sitter';
import { parser } from '../parser';
import { buildRange } from '../utils';

export class SyntaxErrorProvider {
    private readonly errorQuery = new Query(Cog, '(ERROR) @error');

    provideDiagnostics(document: vscode.TextDocument) {
        const tree = parser.parse(document.getText());
        const diagnostics: vscode.Diagnostic[] = [];

        for (const error of this.errorQuery.captures(tree.rootNode)) {
            const diagnostic = new vscode.Diagnostic(
                buildRange(error.node),
                'Syntax error',
                vscode.DiagnosticSeverity.Error
            );
            diagnostics.push(diagnostic);
        }

        return diagnostics;
    }
}
