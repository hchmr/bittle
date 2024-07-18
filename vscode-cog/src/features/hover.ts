import * as vscode from 'vscode';
import { parser } from '../parser';

export class HoverProvider implements vscode.HoverProvider {
    provideHover(document: vscode.TextDocument, position: vscode.Position) {
        const tree = parser.parse(document.getText());
        const treePosition = { row: position.line, column: position.character };
        const node = tree.rootNode.namedDescendantForPosition(treePosition);
        if (node) {
            return new vscode.Hover(node.type);
        }
    }
};
