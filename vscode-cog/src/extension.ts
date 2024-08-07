import * as vscode from 'vscode';
import { CodeActionsProvider } from './features/codeActions';
import { createCompilerErrorProvider } from './features/compilerErrors';
import { CompletionProvider } from './features/completion';
import { ElaborationErrorProvider } from './features/elaborationErrors';
import { IncludeDefinitionProvider, NameDefinitionProvider, TypeDefinitionProvider } from './features/gotoDefinition';
import { HoverProvider } from './features/hover';
import { ReferenceProvider } from './features/references';
import { SemanticTokensProvider } from './features/semanticTokens';
import { SignatureHelpProvider } from './features/signatureHelp';
import { DocumentSymbolsProvider as SymbolProvider } from './features/symbols';
import { SyntaxErrorProvider } from './features/syntaxErrors';
import { CompilerService } from './services/compilerService';
import { ElaborationService } from './services/elaborationService';
import { IncludeGraphService } from './services/includeGraphService';
import { IncludeResolver } from './services/IncludeResolver';
import { ParsingServiceImpl } from './services/parsingService';
import { ReactiveCache } from './utils/reactiveCache';
import { VirtualFileSystemImpl } from './vfs';

export function activate(context: vscode.ExtensionContext) {
    // Services

    const cache = new ReactiveCache();

    const vfs = new VirtualFileSystemImpl(cache);
    context.subscriptions.push(vfs);

    const parsingService = new ParsingServiceImpl(cache, vfs);

    const includeResolver = new IncludeResolver(vfs);

    const elaborationService = new ElaborationService(parsingService, includeResolver, cache);

    const includeGraphService = new IncludeGraphService(parsingService, vfs, includeResolver);

    const compilerService = new CompilerService();

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
            semanticTokensProvider.legend,
        ),
    );

    // Syntax errors

    const syntaxErrorProvider = new SyntaxErrorProvider(parsingService);
    context.subscriptions.push(syntaxErrorProvider);

    const elaborationErrorProvider = new ElaborationErrorProvider(elaborationService, cache);
    context.subscriptions.push(elaborationErrorProvider);

    const compilerErrorProvider = createCompilerErrorProvider(compilerService);
    context.subscriptions.push(compilerErrorProvider);

    function refreshDiagnostics(document: vscode.TextDocument) {
        if (document.languageId !== 'cog')
            return;

        syntaxErrorProvider.updateDiagnostics(document);
        elaborationErrorProvider.updateDiagnostics();
        compilerErrorProvider.updateDiagnostics();
    }

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(document => refreshDiagnostics(document)),
        vscode.workspace.onDidChangeTextDocument(event => refreshDiagnostics(event.document)),
        vscode.workspace.onDidCloseTextDocument(document => refreshDiagnostics(document)),
    );
    vscode.workspace.textDocuments.forEach(refreshDiagnostics);

    // Document symbols and workspace symbols

    const symbolProvider = new SymbolProvider(parsingService, vfs, cache);
    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider('cog', symbolProvider),
        vscode.languages.registerWorkspaceSymbolProvider(symbolProvider),
    );

    // Code actions

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider('cog', new CodeActionsProvider(parsingService)),
    );

    // Navigation

    const nameDefinitionProvider = new NameDefinitionProvider(parsingService, elaborationService, includeGraphService);
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider('cog', new IncludeDefinitionProvider(vfs, parsingService)),
        vscode.languages.registerDefinitionProvider('cog', nameDefinitionProvider),
        vscode.languages.registerImplementationProvider('cog', nameDefinitionProvider),
        vscode.languages.registerTypeDefinitionProvider('cog', new TypeDefinitionProvider(parsingService, elaborationService)),
    );

    // Completion

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider('cog', new CompletionProvider(parsingService, elaborationService), '.'),
    );

    context.subscriptions.push(
        vscode.languages.registerSignatureHelpProvider('cog', new SignatureHelpProvider(parsingService, elaborationService), '(', ','),
    );

    // Rename and references

    const referenceProvider = new ReferenceProvider(parsingService, elaborationService, includeGraphService);
    context.subscriptions.push(
        vscode.languages.registerReferenceProvider('cog', referenceProvider),
        vscode.languages.registerRenameProvider('cog', referenceProvider),
    );

    // TODO:
    // - More code actions
    // - Formatting
}
