import { SyntaxNode } from 'tree-sitter';
import * as vscode from 'vscode';
import { parser } from '../parser';
import { fromVscRange, rangeEmpty, toVscRange } from '../utils';
import { getNodesAtPosition } from '../utils/nodeSearch';

export class CodeActionsProvider implements vscode.CodeActionProvider {
    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ) {
        return [
            tryFlipComma(document, range)
        ].flatMap(action => action);
    }
}

function tryFlipComma(document: vscode.TextDocument, vscRange: vscode.Range): vscode.CodeAction[] {
    const tree = parser.parse(document.getText());

    const range = fromVscRange(vscRange);
    if (!rangeEmpty(range))
        return [];

    return getNodesAtPosition(tree, range.startPosition)
        .filter(canSwapSides)
        .map(createCodeAction);

    function canSwapSides(node: SyntaxNode) {
        return node.text === ','
            && node.previousSibling
            && node.nextSibling
            && !isClosingDelimiter(node.nextSibling)
    }

    function createCodeAction(node: SyntaxNode) {
        const fix = new vscode.CodeAction(
            `Flip ','`,
            vscode.CodeActionKind.QuickFix
        );
        fix.edit = createSwapEdit(node);
        return fix;
    }

    function createSwapEdit(node: SyntaxNode) {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
            document.uri,
            toVscRange(node.previousSibling!),
            node.nextSibling!.text
        );
        edit.replace(
            document.uri,
            toVscRange(node.nextSibling!),
            node.previousSibling!.text
        );
        return edit;
    }
}

function isClosingDelimiter(node: SyntaxNode): boolean {
    return Array.from('])}').includes(node.text);
}
