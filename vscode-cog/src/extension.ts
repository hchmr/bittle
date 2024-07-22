import * as vscode from 'vscode';
import { CodeActionsProvider } from './features/codeActions';
import { DocumentSymbolsProvider } from './features/documentSymbols';
import { IncludeDefinitionProvider, NameDefinitionProvider } from './features/gotoDefinition';
import { HoverProvider } from './features/hover';
import { SemanticTokensProvider } from './features/semanticTokens';
import { SyntaxErrorProvider } from './features/syntaxErrors';
import { IncludeResolver } from './IncludeResolver';
import { createParsingService } from './parser';
import { ElaborationService } from './semantics/ElaborationService';
import { IndexingService } from './semantics/IndexingService';
import { ReactiveCache } from './utils/reactiveCache';
import { createVirtualFileSystem } from './vfs';

export function activate(context: vscode.ExtensionContext) {
    const cache = new ReactiveCache();

    const vfs = createVirtualFileSystem(cache);
    context.subscriptions.push(vfs);

    const parsingService = createParsingService(cache, vfs);

    const includeResolver = new IncludeResolver(vfs);

    const indexService = new IndexingService(cache, includeResolver, parsingService);

    const elaborator = new ElaborationService(indexService);

    // Hover

    context.subscriptions.push(
        vscode.languages.registerHoverProvider('cog', new HoverProvider(parsingService, elaborator)),
    );

    // Semantic tokens

    const semanticTokensProvider = new SemanticTokensProvider(parsingService);
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

    const syntaxErrorProvider = new SyntaxErrorProvider(parsingService);
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(document => refreshDiagnostics(document)),
        vscode.workspace.onDidChangeTextDocument(event => refreshDiagnostics(event.document)),
        vscode.workspace.onDidCloseTextDocument(document => diagnosticsCollection.delete(document.uri)),
    );
    vscode.workspace.textDocuments.forEach(refreshDiagnostics);

    // Document symbols

    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider('cog', new DocumentSymbolsProvider(parsingService))
    );

    // Code actions

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider('cog', new CodeActionsProvider(parsingService))
    );

    // Resolve include

    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider('cog', new IncludeDefinitionProvider(vfs, parsingService)),
        vscode.languages.registerDefinitionProvider('cog', new NameDefinitionProvider(parsingService, elaborator)),
    );

    // TODO:
    // - Go to definition
    // - Find references
    // - Rename
    // - Auto-completion
    // - More code actions
}
