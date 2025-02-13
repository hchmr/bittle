import * as vscode from 'vscode';
import { prettySym, Sym, SymKind, symRelatedType } from '../semantics/sym';
import { prettyType, Type, typeLayout, TypeLayout } from '../semantics/type';
import { ParsingService } from '../services/parsingService';
import { SemanticsService } from '../services/semanticsService';
import { SyntaxNode } from '../syntax';
import { isExprNode, isTypeNode } from '../syntax/nodeTypes';
import { interceptExceptions } from '../utils/interceptExceptions';
import { toVscRange } from '../utils/vscode';

export class HoverProvider implements vscode.HoverProvider {
    constructor(
        private parsingService: ParsingService,
        private semanticsService: SemanticsService,
    ) { }

    @interceptExceptions
    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
    ) {
        const detail = this.getDetailForPosition(document, position);
        if (detail) {
            return toHover(detail);
        }
    }

    getDetailForPosition(document: vscode.TextDocument, position: vscode.Position) {
        const tree = this.parsingService.parse(document.fileName);
        const treePosition = { row: position.line, column: position.character };
        const hoveredNode = tree.rootNode.descendantForPosition(treePosition);

        for (let node: SyntaxNode | null = hoveredNode; node; node = node.parent) {
            const detail = this.getDetailForNode(document, node);
            if (detail) {
                return detail;
            }
        }
    }

    getDetailForNode(document: vscode.TextDocument, node: SyntaxNode): HoverDetail | undefined {
        if (node.type === 'identifier') {
            const syms = this.semanticsService.resolveSymbol(document.fileName, node);
            if (syms.length) {
                return this.addLayout({ kind: 'sym', syms, node });
            }
        }
        if (isExprNode(node)) {
            const type = this.semanticsService.inferType(document.fileName, node);
            if (type) {
                return this.addLayout({ kind: 'type', type, node });
            }
        }
        if (isTypeNode(node)) {
            const type = this.semanticsService.evalType(document.fileName, node);
            if (type) {
                return this.addLayout({ kind: 'type', type, node });
            }
        }
    }

    addLayout(hoverDetail: HoverDetail): HoverDetail {
        if (hoverDetail.kind === 'sym') {
            for (const sym of hoverDetail.syms) {
                if (sym.kind !== SymKind.Func) {
                    hoverDetail.layout = typeLayout(symRelatedType(sym));
                }
            }
        } else {
            hoverDetail.layout = typeLayout(hoverDetail.type);
        }

        return hoverDetail;
    }
};

type HoverDetail =
    | { kind: 'sym'; syms: Sym[]; node: SyntaxNode; layout?: TypeLayout }
    | { kind: 'type'; type: Type; node: SyntaxNode; layout?: TypeLayout };

function toHover(hoverDetail: HoverDetail): vscode.Hover {
    let text = hoverDetail.kind === 'sym'
        ? hoverDetail.syms.map(prettySym).join('\n')
        : prettyType(hoverDetail.type);

    if (hoverDetail.layout) {
        const { size, align } = hoverDetail.layout;
        text += ` // size = ${size}, align = ${align}`;
    }

    return new vscode.Hover(new vscode.MarkdownString().appendCodeblock(text, 'bittle'), toVscRange(hoverDetail.node));
}
