import * as vscode from 'vscode';
import Parser from 'tree-sitter';
import Cog from 'tree-sitter-cog';
import { Query } from 'tree-sitter';
import * as fs from 'fs';
import * as path from 'path';

const parser = new Parser();
parser.setLanguage(Cog);

class SemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
    private readonly highlightsQuery: Query;
    public readonly tokenTypes = ['type', 'function'];
    public readonly legend = new vscode.SemanticTokensLegend(this.tokenTypes);

    constructor() {
        this.highlightsQuery = (() => {
            const queryPath = path.join(__dirname, '../node_modules/tree-sitter-cog/queries/highlights.scm');
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
                new vscode.Range(
                    capture.node.startPosition.row,
                    capture.node.startPosition.column,
                    capture.node.endPosition.row,
                    capture.node.endPosition.column
                ),
                capture.name
            );
        }
        return builder.build();
    }
}

class ParseErrorProvider {
    private readonly errorQuery = new Query(Cog, '(ERROR) @error');

    provideDiagnostics(document: vscode.TextDocument) {
        const tree = parser.parse(document.getText());
        const diagnostics: vscode.Diagnostic[] = [];

        for (const error of this.errorQuery.captures(tree.rootNode)) {
            const diagnostic = new vscode.Diagnostic(
                new vscode.Range(
                    error.node.startPosition.row,
                    error.node.startPosition.column,
                    error.node.endPosition.row,
                    error.node.endPosition.column
                ),
                'Syntax error',
                vscode.DiagnosticSeverity.Error
            );
            diagnostics.push(diagnostic);
        }

        return diagnostics;
    }
}

class HoverProvider implements vscode.HoverProvider {
    provideHover(document: vscode.TextDocument, position: vscode.Position) {
        const tree = parser.parse(document.getText());
        const treePosition = { row: position.line, column: position.character };
        const node = tree.rootNode.namedDescendantForPosition(treePosition);
        if (node) {
            return new vscode.Hover(node.type);
        }
    }
};

export function activate(context: vscode.ExtensionContext) {
    // Hover
    context.subscriptions.push(
        vscode.languages.registerHoverProvider('cog', new HoverProvider()),
    );

    // Semantic tokens
    const semanticTokensProvider = new SemanticTokensProvider();
    context.subscriptions.push(
        vscode.languages.registerDocumentSemanticTokensProvider(
            'cog',
            semanticTokensProvider,
            semanticTokensProvider.legend
        )
    );

    // Parse errors

    const diagnosticsCollection = vscode.languages.createDiagnosticCollection('Cog');
    context.subscriptions.push(diagnosticsCollection);

    function refreshDiagnostics(document: vscode.TextDocument) {
        if (document.languageId !== 'cog')
            return;
        const diagnostics = parseErrorProvider.provideDiagnostics(document);
        diagnosticsCollection.set(document.uri, diagnostics);
    }

    const parseErrorProvider = new ParseErrorProvider();
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(document => refreshDiagnostics(document)),
        vscode.workspace.onDidChangeTextDocument(event => refreshDiagnostics(event.document)),
        vscode.workspace.onDidCloseTextDocument(document => diagnosticsCollection.delete(document.uri)),
    );
    vscode.workspace.textDocuments.forEach(refreshDiagnostics);
}
