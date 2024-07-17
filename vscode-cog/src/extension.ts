import * as vscode from 'vscode';
import Parser from 'tree-sitter';
import Cog from 'tree-sitter-cog';
import { Query } from 'tree-sitter';
import * as fs from 'fs';
import * as path from 'path';

const parser = new Parser();
parser.setLanguage(Cog);

function buildRange(node: Parser.SyntaxNode): vscode.Range {
    return new vscode.Range(
        node.startPosition.row,
        node.startPosition.column,
        node.endPosition.row,
        node.endPosition.column
    );
}

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
                buildRange(capture.node),
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
                buildRange(error.node),
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

class DocumentSymbolsProvider implements vscode.DocumentSymbolProvider {
    private readonly symbolKindMapping = {
        'enum_member': vscode.SymbolKind.Constant,
        'struct_decl': vscode.SymbolKind.Struct,
        'struct_member': vscode.SymbolKind.Field,
        'func_decl': vscode.SymbolKind.Function,
        'param_decl': vscode.SymbolKind.Variable,
        'global_decl': vscode.SymbolKind.Variable,
        'const_decl': vscode.SymbolKind.Constant,
        'local_decl': vscode.SymbolKind.Variable,
    };

    provideDocumentSymbols(document: vscode.TextDocument) {
        const tree = parser.parse(document.getText());

        const rootSymbols: vscode.DocumentSymbol[] = [];

        const visit = (node: Parser.SyntaxNode, currentSymbol: vscode.DocumentSymbol | null) => {
            if (node.type in this.symbolKindMapping) {
                const symbol = this.generateDocumentSymbol(node);
                (currentSymbol?.children ?? rootSymbols).push(symbol);
                currentSymbol = symbol;
            }

            for (const child of node.children) {
                visit(child, currentSymbol);
            }
        };

        visit(tree.rootNode, null);

        return rootSymbols;
    }

    private generateDocumentSymbol(node: Parser.SyntaxNode) {
        const nameNode = node.children.find(child => child.type === 'identifier');
        const symbol = new vscode.DocumentSymbol(
            nameNode?.text ?? '',
            '',
            this.convertSymbolKind(node.type),
            buildRange(node),
            buildRange(nameNode ?? node)
        );
        return symbol;
    }

    private convertSymbolKind(type: string) {
        const symbolKindMapping: Record<string, vscode.SymbolKind> = this.symbolKindMapping;
        return symbolKindMapping[type] ?? null;
    }
}

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

    // Document symbols

    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider('cog', new DocumentSymbolsProvider())
    );
}
