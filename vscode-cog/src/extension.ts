import * as vscode from 'vscode';
import { SyntaxErrorProvider } from './features/syntaxErrors';
import { DocumentSymbolsProvider } from './features/documentSymbols';
import { HoverProvider } from './features/hover';
import { SemanticTokensProvider } from './features/semanticTokens';
import { CodeActionsProvider } from './features/codeActions';

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

    // Syntax errors

    const diagnosticsCollection = vscode.languages.createDiagnosticCollection('Cog');
    context.subscriptions.push(diagnosticsCollection);

    function refreshDiagnostics(document: vscode.TextDocument) {
        if (document.languageId !== 'cog')
            return;
        const diagnostics = syntaxErrorProvider.provideDiagnostics(document);
        diagnosticsCollection.set(document.uri, diagnostics);
    }

    const syntaxErrorProvider = new SyntaxErrorProvider();
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

    // Code actions

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider('cog', new CodeActionsProvider())
    );

    // TODO:
    // - Go to definition
    // - Find references
    // - Rename
    // - Auto-completion
    // - More code actions
}
