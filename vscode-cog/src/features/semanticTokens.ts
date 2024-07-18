import * as vscode from 'vscode';
import Cog from 'tree-sitter-cog';
import { Query } from 'tree-sitter';
import * as fs from 'fs';
import * as path from 'path';
import { parser } from '../parser';
import { toVscRange } from '../utils';

export class SemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
    private readonly highlightsQuery: Query;
    public readonly tokenTypes = ['type', 'function'];
    public readonly legend = new vscode.SemanticTokensLegend(this.tokenTypes);

    constructor() {
        this.highlightsQuery = (() => {
            const queryPath = path.join(__dirname, '../../node_modules/tree-sitter-cog/queries/highlights.scm');
            const querySource = fs.readFileSync(queryPath, 'utf8');
            return new Query(Cog, querySource);
        })();
    }

    provideDocumentSemanticTokens(document: vscode.TextDocument) {
        const tree = parser.parse(document.getText());
        const builder = new vscode.SemanticTokensBuilder(this.legend);
        for (const capture of this.highlightsQuery.captures(tree.rootNode)) {
            if (!this.tokenTypes.includes(capture.name))
                continue;
            if (capture.node.startPosition.row != capture.node.endPosition.row)
                continue;

            builder.push(
                toVscRange(capture.node),
                capture.name
            );
        }
        return builder.build();
    }
}
