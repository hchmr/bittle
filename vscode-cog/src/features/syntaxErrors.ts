import { Query } from 'tree-sitter';
import Cog from 'tree-sitter-cog';
import * as vscode from 'vscode';
import { ParsingService } from '../parser';
import { toVscRange } from '../utils';

export class SyntaxErrorProvider {
    private readonly errorQuery = new Query(Cog, '(ERROR) @error');

    constructor(private parsingService: ParsingService) { }

    provideDiagnostics(document: vscode.TextDocument) {
        const tree = this.parsingService.parse(document.fileName);
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
