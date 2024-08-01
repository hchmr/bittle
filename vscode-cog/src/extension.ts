import * as vscode from 'vscode';
import { CodeActionsProvider } from './features/codeActions';
import { CompletionProvider } from './features/completion';
import { DocumentSymbolsProvider } from './features/documentSymbols';
import { ElaborationErrorProvider } from './features/elaborationErrors';
import { IncludeDefinitionProvider, NameDefinitionProvider, TypeDefinitionProvider } from './features/gotoDefinition';
import { HoverProvider } from './features/hover';
import { SemanticTokensProvider } from './features/semanticTokens';
import { SyntaxErrorProvider } from './features/syntaxErrors';
import { ElaborationService } from './services/elaborationService';
import { IncludeResolver } from './services/IncludeResolver';
import { ParsingService } from './services/parsingService';
import { ReactiveCache } from './utils/reactiveCache';
import { VirtualFileSystem } from './vfs';
import { SignatureHelpProvider } from './features/signatureHelp';
import { IncludeGraphService } from './services/includeGraphService';
import { ReferenceProvider } from './features/references';

export function activate(context: vscode.ExtensionContext) {
    const cache = new ReactiveCache();

    const vfs = new VirtualFileSystem(cache);
    context.subscriptions.push(vfs);

    const parsingService = new ParsingService(cache, vfs);

    const includeResolver = new IncludeResolver(vfs);

    const elaborationService = new ElaborationService(parsingService, includeResolver, cache);

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
        vscode.languages.registerTypeDefinitionProvider('cog', new TypeDefinitionProvider(parsingService, elaborationService))
    );

    // Completion

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider('cog', new CompletionProvider(parsingService, elaborationService), '.')
    );

    context.subscriptions.push(
        vscode.languages.registerSignatureHelpProvider('cog', new SignatureHelpProvider(parsingService, elaborationService), '(', ',')
    );

    // References

    const includeGraphService = new IncludeGraphService(parsingService, vfs, includeResolver);

    const referenceProvider = new ReferenceProvider(parsingService, elaborationService, includeGraphService);
    context.subscriptions.push(
        vscode.languages.registerReferenceProvider('cog', referenceProvider),
        vscode.languages.registerRenameProvider('cog', referenceProvider),
    );

    // TODO:
    // - Go to definition VS declaration
    // - Go directly to definition
    // - Go to workspace symbol
    // - More code actions
    // - Formatting
}
