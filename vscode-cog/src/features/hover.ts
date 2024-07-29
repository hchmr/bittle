import { SyntaxNode } from 'cog-parser';
import * as vscode from 'vscode';
import { TypeLayout } from '../semantics/Elaborator';
import { prettySym, Sym, SymKind, symRelatedType } from '../semantics/sym';
import { prettyType, Type } from '../semantics/type';
import { ElaborationService } from '../services/elaborationService';
import { ParsingService } from '../services/parsingService';
import { isExprNode, isTypeNode } from '../syntax/nodeTypes';
import { toVscRange } from '../utils';

export class HoverProvider implements vscode.HoverProvider {
    constructor(
        private parsingService: ParsingService,
        private elaborationService: ElaborationService
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
            const sym = this.elaborationService.resolveSymbol(document.fileName, node);
            if (sym) {
                return this.addLayout(document, { kind: 'sym', sym, node })
            }
        }
        if (isExprNode(node)) {
            const type = this.elaborationService.inferType(document.fileName, node);
            if (type) {
                return this.addLayout(document, { kind: 'type', type, node })
            }
        }
        if (isTypeNode(node)) {
            const type = this.elaborationService.evalType(document.fileName, node);
            if (type) {
                return this.addLayout(document, { kind: 'type', type, node })
            }
        }
    }

    addLayout(document: vscode.TextDocument, hoverDetail: HoverDetail): HoverDetail {
        let type = hoverDetail.kind === 'sym'
            ? structSymType(hoverDetail.sym) ?? symRelatedType(hoverDetail.sym)
            : hoverDetail.type;

        if (type) {
            hoverDetail.layout = this.elaborationService.getLayout(document.fileName, type);
        }

        return hoverDetail;

        function structSymType(sym: Sym): Type | undefined {
            if (sym.kind === SymKind.Struct) {
                return { kind: 'struct', name: sym.name };
            }
        }
    }
};

type HoverDetail =
    | { kind: 'sym', sym: Sym, node: SyntaxNode, layout?: TypeLayout }
    | { kind: 'type', type: Type, node: SyntaxNode, layout?: TypeLayout }

function toHover(hoverDetail: HoverDetail): vscode.Hover {
    let text = hoverDetail.kind === 'sym'
        ? prettySym(hoverDetail.sym)
        : prettyType(hoverDetail.type);

    if (hoverDetail.layout) {
        const { size, align } = hoverDetail.layout;
        text += ` // size = ${size}, align = ${align}`;
    }

    return new vscode.Hover(new vscode.MarkdownString().appendCodeblock(text, 'cog'), toVscRange(hoverDetail.node));
}
