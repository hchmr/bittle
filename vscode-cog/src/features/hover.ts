import { SyntaxNode } from 'tree-sitter';
import * as vscode from 'vscode';
import { isExprNode, isTypeNode, ParsingService } from '../parser';
import { ElaborationService } from '../semantics/ElaborationService';
import { prettySymbol, Symbol } from '../semantics/sym';
import { prettyType, Type } from '../semantics/type';
import { toVscRange } from '../utils';

export class HoverProvider implements vscode.HoverProvider {
    constructor(
        private parsingService: ParsingService,
        private elaborator: ElaborationService
    ) { }

    provideHover(document: vscode.TextDocument, position: vscode.Position) {
        const detail = this.getDetailForPosition(document, position);
        if (detail) {
            return toHover(detail);
        }
    }

    getDetailForPosition(document: vscode.TextDocument, position: vscode.Position) {
        const tree = this.parsingService.parse(document.fileName);
        const treePosition = { row: position.line, column: position.character };
        const hoveredNode = tree.rootNode.namedDescendantForPosition(treePosition);

        for (let node: SyntaxNode | null = hoveredNode; node; node = node.parent) {
            const detail = this.getDetailForNode(document, node);
            if (detail) {
                return detail;
            }
        }
    }

    getDetailForNode(document: vscode.TextDocument, node: SyntaxNode): HoverDetail | undefined {
        if (node.type === 'identifier') {
            const symbol = this.elaborator.resolveSymbol(document.fileName, node);
            if (symbol) {
                return { kind: 'symbol', symbol, node }
            }
        }
        if (isExprNode(node)) {
            const type = this.elaborator.inferType(document.fileName, node);
            if (type) {
                return { kind: 'type', type, node }
            }
        }
        if (isTypeNode(node)) {
            const type = this.elaborator.evalType(document.fileName, node);
            if (type) {
                return { kind: 'type', type, node }
            }
        }
    }
};

type HoverDetail =
    | { kind: 'symbol', symbol: Symbol, node: SyntaxNode }
    | { kind: 'type', type: Type, node: SyntaxNode };

function toHover(hoverDetail: HoverDetail): vscode.Hover {
    const text = hoverDetail.kind === 'symbol'
        ? prettySymbol(hoverDetail.symbol)
        : prettyType(hoverDetail.type);
    return new vscode.Hover(new vscode.MarkdownString().appendCodeblock(text, 'cog'), toVscRange(hoverDetail.node));
}
