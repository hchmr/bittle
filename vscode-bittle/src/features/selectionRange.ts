import * as vscode from 'vscode';
import { ParsingService } from '../services/parsingService';
import { PointRange, rangeContains, SyntaxNode } from '../syntax';
import { FuncDeclNode, IfStmtNode } from '../syntax/generated';
import { isStmtNode, NodeTypes } from '../syntax/nodeTypes';
import { Nullish } from '../utils';
import { interceptExceptions } from '../utils/interceptExceptions';
import { stream } from '../utils/stream';
import { fromVscPosition, toVscRange } from '../utils/vscode';

export class SelectionRangeProvider implements vscode.SelectionRangeProvider {
    constructor(private readonly parsingService: ParsingService) {}

    @interceptExceptions
    provideSelectionRanges(
        document: vscode.TextDocument,
        positions: vscode.Position[],
        _token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.SelectionRange[]> {
        const tree = this.parsingService.parse(document.uri.fsPath);

        return positions.map(position => {
            const syntaxNode = tree.rootNode.descendantForPosition(fromVscPosition(position));

            const collected = stream(collectSelectionRanges(syntaxNode))
                .map(r => toVscRange(r))
                .toArray();

            return collected.reduceRight(
                (parent, range) => new vscode.SelectionRange(range, parent),
                new vscode.SelectionRange(collected.pop()!), // Outermost
            );
        });
    }
}

function* collectSelectionRanges(initial: SyntaxNode): Generator<PointRange> {
    for (let node: SyntaxNode | null = initial; node; node = node.parent) {
        yield* collectNodeSpecificSubranges(initial, node);
        yield* collectContainingDelimitedRanges(node);
    }
}

function* collectNodeSpecificSubranges(initial: SyntaxNode, node: SyntaxNode): Generator<PointRange> {
    if (node.type === NodeTypes.FuncDecl) {
        const funcDecl = new FuncDeclNode(node);
        // ':' <return type>
        yield* tryCreateEnclosingRange(initial, [funcDecl.colonToken, funcDecl.returnType]);
        // Function signature
        yield* tryCreateEnclosingRange(initial, funcDecl.syntax.children.filter(c =>
            ![funcDecl.body?.syntax, funcDecl.semicolonToken].includes(c),
        ));
    } else if (node.type === NodeTypes.IfStmt) {
        const ifStmt = new IfStmtNode(node);
        // 'if' <condition> <body>
        yield* tryCreateEnclosingRange(initial, [ifStmt.ifToken, ifStmt.then]);
        // 'else' <body>
        yield* tryCreateEnclosingRange(initial, [ifStmt.elseToken, ifStmt.else]);
    } else if (isStmtNode(node) && node.lastChild?.type === ';') {
        yield* tryCreateEnclosingRange(initial, [node.firstChild, node.lastChild.previousSibling]);
    }
}

function* collectContainingDelimitedRanges(node: SyntaxNode): Generator<PointRange> {
    const delimiters: Partial<Record<string, string>> = { '(': ')', '{': '}', '[': ']' };

    for (let start: SyntaxNode | null = node; start; start = start.previousSibling) {
        const closeType = delimiters[start.type];
        if (!closeType)
            continue;

        let end: SyntaxNode | null = node.nextSibling;
        for (; end; end = end.nextSibling) {
            if (end.type === closeType)
                break;
        }
        if (end) {
            if (start !== node)
                yield rangeConcatInner(start, end);
            yield rangeConcat(start, end);
        }
    }
}

function* tryCreateEnclosingRange(node: PointRange, nodes: (PointRange | Nullish)[]): Generator<PointRange> {
    const start = nodes.find(Boolean);
    const end = nodes.findLast(Boolean);
    if (start && end && rangeContains(rangeConcat(start, end), node))
        yield rangeConcat(start, end);
}

function rangeConcat(start: PointRange, end: PointRange): PointRange {
    return { startPosition: start.startPosition, endPosition: end.endPosition };
}

function rangeConcatInner(open: SyntaxNode, close: SyntaxNode): PointRange {
    return { startPosition: open.endPosition, endPosition: close.startPosition };
}
