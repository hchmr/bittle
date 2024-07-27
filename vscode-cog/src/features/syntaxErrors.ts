import { Query, SyntaxNode, TreeCursor } from 'tree-sitter';
import Cog from 'tree-sitter-cog';
import * as vscode from 'vscode';
import { ParsingService } from '../services/parsingService';
import { toVscRange } from '../utils';

export class SyntaxErrorProvider implements vscode.Disposable {
    private diagnosticsCollection = vscode.languages.createDiagnosticCollection('Cog');

    constructor(private parsingService: ParsingService) { }

    dispose() {
        this.diagnosticsCollection.dispose();
    }

    updateDiagnostics(document: vscode.TextDocument) {
        if (document.isClosed) {
            this.diagnosticsCollection.delete(document.uri);
        } else {
            const diagnostics = this.createDiagnostics(document.uri);
            this.diagnosticsCollection.set(document.uri, diagnostics);
        }
    }

    createDiagnostics(uri: vscode.Uri) {
        const tree = this.parsingService.parse(uri.fsPath);
        const diagnostics: vscode.Diagnostic[] = [];

        const cursor = tree.walk();
        do {
            const node = cursor.currentNode;

            if (node.isError) {
                diagnostics.push(createDiagnostic(node, `Syntax error`));
            } else if (node.isMissing) {
                diagnostics.push(createDiagnostic(node, `Syntax error: missing \`${node.type}\``));
            }
        } while (advanceCursor(cursor));

        return diagnostics;
    }
}

function advanceCursor(cursor: TreeCursor): boolean {
    if (cursor.gotoFirstChild() || cursor.gotoNextSibling()) {
        return true;
    }
    while (cursor.gotoParent()) {
        if (cursor.gotoNextSibling()) {
            return true;
        }
    }
    return false;
}

function createDiagnostic(
    node: SyntaxNode,
    message: string,
    severity = vscode.DiagnosticSeverity.Error
): vscode.Diagnostic {
    return new vscode.Diagnostic(toVscRange(node), message, severity);
}
