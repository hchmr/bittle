import * as vscode from 'vscode';
import { ParsingService } from '../parser';
import { Elaborator } from '../semantics/SymbolResolver';
import { prettySymbol } from '../semantics/sym';

export class HoverProvider implements vscode.HoverProvider {
    constructor(
        private parsingService: ParsingService,
        private elaborator: Elaborator
    ) { }

    provideHover(document: vscode.TextDocument, position: vscode.Position) {
        const tree = this.parsingService.parse(document.fileName);
        const treePosition = { row: position.line, column: position.character };
        const node = tree.rootNode.namedDescendantForPosition(treePosition);
        if (!node) {
            return;
        }
        if (node.type === 'identifier') {
            const symbol = this.elaborator.resolveSymbol(document.fileName, node);
            if (symbol) {
                return new vscode.Hover(new vscode.MarkdownString().appendCodeblock(prettySymbol(symbol), 'cog'));
            }
        }
    }
};
