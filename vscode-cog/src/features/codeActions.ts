import * as vscode from 'vscode';
import { ParsingService } from '../services/parsingService';
import { isRangeEmpty, SyntaxNode, Tree } from '../syntax';
import { fromVscRange, toVscRange } from '../utils';
import { interceptExceptions } from '../utils/interceptExceptions';
import { getNodesAtPosition } from '../utils/nodeSearch';

export class CodeActionsProvider implements vscode.CodeActionProvider {
    constructor(private parsingService: ParsingService) { }

    @interceptExceptions
    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range,
        _context: vscode.CodeActionContext,
        _token: vscode.CancellationToken,
    ) {
        const tree = this.parsingService.parse(document.fileName);

        return [
            tryFlipComma(tree, document.uri, range),
        ].flatMap(action => action);
    }
}

function tryFlipComma(tree: Tree, documentUri: vscode.Uri, vscRange: vscode.Range): vscode.CodeAction[] {
    const range = fromVscRange(vscRange);
    if (!isRangeEmpty(range))
        return [];

    return getNodesAtPosition(tree, range.startPosition)
        .filter(canSwapSides)
        .map(createCodeAction);

    function canSwapSides(node: SyntaxNode) {
        return node.text === ','
            && node.previousSibling
            && node.nextSibling
            && !isClosingDelimiter(node.nextSibling);
    }

    function createCodeAction(node: SyntaxNode) {
        const fix = new vscode.CodeAction(
            `Flip ','`,
            vscode.CodeActionKind.QuickFix,
        );
        fix.edit = createSwapEdit(node);
        return fix;
    }

    function createSwapEdit(node: SyntaxNode) {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
            documentUri,
            toVscRange(node.previousSibling!),
            node.nextSibling!.text,
        );
        edit.replace(
            documentUri,
            toVscRange(node.nextSibling!),
            node.previousSibling!.text,
        );
        return edit;
    }
}

function isClosingDelimiter(node: SyntaxNode): boolean {
    return Array.from('])}').includes(node.text);
}
