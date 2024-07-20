import * as vscode from 'vscode';
import { ParsingService } from '../parser';

export class HoverProvider implements vscode.HoverProvider {
    constructor(private parsingService: ParsingService) { }

    provideHover(document: vscode.TextDocument, position: vscode.Position) {
        const tree = this.parsingService.parse(document.fileName);
        const treePosition = { row: position.line, column: position.character };
        const node = tree.rootNode.namedDescendantForPosition(treePosition);
        if (node) {
            return new vscode.Hover(node.type);
        }
    }
};
