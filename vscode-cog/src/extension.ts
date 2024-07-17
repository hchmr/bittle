import * as vscode from 'vscode';
import Parser from 'tree-sitter';
import Cog from 'tree-sitter-cog';

const parser = new Parser();
parser.setLanguage(Cog);

export function activate(context: vscode.ExtensionContext) {
    vscode.window.showInformationMessage('Hello World from vscode-cog!');

    context.subscriptions.push(
        vscode.languages.registerHoverProvider('cog', {
            provideHover(document, position, token) {
                const tree = parser.parse(document.getText());
                const treePosition = { row: position.line, column: position.character };
                const node = tree.rootNode.namedDescendantForPosition(treePosition);
                if (node) {
                    return new vscode.Hover(node.type);
                } else {
                    return new vscode.Hover('No node found');
                }
            }
        })
    );
}
