import * as vscode from 'vscode';
import { ParsingService } from '../services/parsingService';
import { SyntaxNode } from '../syntax';
import { ExprNodeType, TopLevelNodeType, TypeNodeType } from '../syntax/nodeTypes';
import { Nullish, toVscRange } from '../utils';

export class SemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
    public readonly tokenTypes = ['type', 'function'];
    public readonly legend = new vscode.SemanticTokensLegend(this.tokenTypes);

    constructor(private parsingService: ParsingService) { }

    provideDocumentSemanticTokens(document: vscode.TextDocument) {
        const tree = this.parsingService.parse(document.uri.fsPath);
        const builder = new vscode.SemanticTokensBuilder(this.legend);

        for (const node of traverse(tree.rootNode)) {
            if (node.type === TypeNodeType.NameType) {
                const nameNode = node.firstChild;
                makeToken(builder, nameNode, 'type');
            } else if (node.type === TopLevelNodeType.Struct) {
                const nameNode = node.childForFieldName('name');
                makeToken(builder, nameNode, 'type');
            } else if (node.type === TopLevelNodeType.Func) {
                const nameNode = node.childForFieldName('name');
                makeToken(builder, nameNode, 'function');
            } else if (node.type === ExprNodeType.CallExpr) {
                const nameNode = node.childForFieldName('callee')?.firstChild;
                makeToken(builder, nameNode, 'function');
            }
        }

        return builder.build();
    }
}

function makeToken(builder: vscode.SemanticTokensBuilder, node: SyntaxNode | Nullish, type: string) {
    if (!node) {
        return;
    }

    builder.push(toVscRange(node.startPosition, node.endPosition), type);
}

function* traverse(node: SyntaxNode): IterableIterator<SyntaxNode> {
    yield node;
    for (const child of node.children) {
        yield * traverse(child);
    }
}
