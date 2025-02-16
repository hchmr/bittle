import * as vscode from 'vscode';
import { Origin, prettySym, Sym, SymKind, symRelatedType } from '../semantics/sym';
import { prettyType, Type, typeLayout, TypeLayout } from '../semantics/type';
import { ParsingService } from '../services/parsingService';
import { SemanticsService } from '../services/semanticsService';
import { SyntaxNode } from '../syntax';
import { isExprNode, isTypeNode } from '../syntax/nodeTypes';
import { TokenNodeImpl } from '../syntax/treeImpl';
import { dedent } from '../utils';
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
    const markdownString = new vscode.MarkdownString();

    if (hoverDetail.kind === 'sym') {
        for (const sym of hoverDetail.syms) {
            const docs = sym.origins.map(getDoc).filter(Boolean);
            for (const doc of docs) {
                markdownString.appendMarkdown(doc + '\n\n');
            }
            markdownString.appendCodeblock(prettySym(sym) + layoutDetail(hoverDetail), 'bittle');
        }
    } else {
        markdownString.appendCodeblock(prettyType(hoverDetail.type) + layoutDetail(hoverDetail), 'bittle');
    }

    return new vscode.Hover(markdownString, toVscRange(hoverDetail.node));

    function layoutDetail(hoverDetail: HoverDetail): string {
        if (!hoverDetail.layout) {
            return '';
        }
        const { size, align } = hoverDetail.layout;
        return ` /* size: ${size}, align: ${align} */`;
    }
}

function getDoc(origin: Origin): string {
    const node = origin.node;

    // TODO: should there be a tree method to get the list of tokens for a node?
    const smallestNode = node.descendantForPosition(node.startPosition);
    if (!(smallestNode instanceof TokenNodeImpl)) {
        return '';
    }

    const startColumn = smallestNode.startPosition.column;
    const lineRegexp = new RegExp(`^\\s{${startColumn}}//(.*)`);

    const triviaLines = smallestNode.token.leadingTrivia.join('').split('\n');
    triviaLines.pop(); // Same line as the node itself

    const docLines: string[] = [];
    for (const line of triviaLines.reverse()) {
        const match = line.match(lineRegexp);
        if (!match) {
            break;
        }
        docLines.push(match[1]);
    }
    docLines.reverse();

    return dedent(docLines.join('\n'));
}
