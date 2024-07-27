import * as vscode from 'vscode';
import { ElaborationErrorProvider } from './features/elaborationErrors';
import { CodeActionsProvider } from './features/codeActions';
import { DocumentSymbolsProvider } from './features/documentSymbols';
import { IncludeDefinitionProvider, NameDefinitionProvider } from './features/gotoDefinition';
import { HoverProvider } from './features/hover';
import { SemanticTokensProvider } from './features/semanticTokens';
import { SyntaxErrorProvider } from './features/syntaxErrors';
import { ElaborationService } from './services/elaborationService';
import { IncludeResolver } from './services/IncludeResolver';
import { createParsingService } from './services/parsingService';
import { ReactiveCache } from './utils/reactiveCache';
import { createVirtualFileSystem } from './vfs';

export function activate(context: vscode.ExtensionContext) {
    const cache = new ReactiveCache();

    const vfs = createVirtualFileSystem(cache);
    context.subscriptions.push(vfs);

    const parsingService = createParsingService(cache, vfs);

    const includeResolver = new IncludeResolver(vfs);

    const elaborationService = new ElaborationService(parsingService, includeResolver);

    // Hover

    context.subscriptions.push(
        vscode.languages.registerHoverProvider('cog', new HoverProvider(parsingService, elaborationService)),
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

    const syntaxErrorProvider = new SyntaxErrorProvider(parsingService);
    context.subscriptions.push(syntaxErrorProvider);

    const elaborationErrorProvider = new ElaborationErrorProvider(elaborationService, cache);
    context.subscriptions.push(elaborationErrorProvider);

    function refreshDiagnostics(document: vscode.TextDocument) {
        if (document.languageId !== 'cog')
            return;

        syntaxErrorProvider.updateDiagnostics(document);
        elaborationErrorProvider.updateDiagnostics();
    }

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(document => refreshDiagnostics(document)),
        vscode.workspace.onDidChangeTextDocument(event => refreshDiagnostics(event.document)),
        vscode.workspace.onDidCloseTextDocument(document => refreshDiagnostics(document)),
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
        vscode.languages.registerDefinitionProvider('cog', new NameDefinitionProvider(parsingService, elaborationService)),
    );



    // TODO:
    // - Go to definition
    // - Find references
    // - Rename
    // - Auto-completion
    // - More code actions
}
