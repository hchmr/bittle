import * as vscode from 'vscode';
import { ParsingService } from '../services/parsingService';
import { SyntaxNode } from '../syntax';
import { ExprNodeTypes, TopLevelNodeTypes, TypeNodeTypes } from '../syntax/nodeTypes';
import { Nullish } from '../utils';
import { interceptExceptions } from '../utils/interceptExceptions';
import { toVscRange } from '../utils/vscode';

export class SemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
    public readonly tokenTypes = ['type', 'function'];
    public readonly legend = new vscode.SemanticTokensLegend(this.tokenTypes);

    constructor(private parsingService: ParsingService) { }

    @interceptExceptions
    provideDocumentSemanticTokens(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken,
    ) {
        const tree = this.parsingService.parse(document.uri.fsPath);
        const builder = new vscode.SemanticTokensBuilder(this.legend);

        for (const node of traverse(tree.rootNode)) {
            if (node.type === TypeNodeTypes.NameType) {
                const nameNode = node.firstChild;
                makeToken(builder, nameNode, 'type');
            } else if (node.type === TopLevelNodeTypes.Record) {
                const nameNode = node.childForFieldName('name');
                makeToken(builder, nameNode, 'type');
            } else if (node.type === TopLevelNodeTypes.Func) {
                const nameNode = node.childForFieldName('name');
                makeToken(builder, nameNode, 'function');
            } else if (node.type === ExprNodeTypes.CallExpr) {
                const nameNode = node.childForFieldName('callee')?.firstChild;
                makeToken(builder, nameNode, 'function');
            } else if (node.type === ExprNodeTypes.RecordExpr) {
                const nameNode = node.childForFieldName('name');
                makeToken(builder, nameNode, 'type');
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
