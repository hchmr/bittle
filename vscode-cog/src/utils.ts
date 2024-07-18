import * as vscode from 'vscode';
import Parser from 'tree-sitter';

export function buildRange(node: Parser.SyntaxNode): vscode.Range {
    return new vscode.Range(
        node.startPosition.row,
        node.startPosition.column,
        node.endPosition.row,
        node.endPosition.column
    );
}
