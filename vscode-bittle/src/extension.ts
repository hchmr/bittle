import * as vscode from 'vscode';
import { CodeActionsProvider } from './features/codeActions';
import { createCompilerErrorProvider } from './features/compilerErrors';
import { CompletionProvider } from './features/completion';
import { ElaborationDiagnosticProvider } from './features/elaborationDiags';
import { ImportAndIncludeDefinitionProvider, NameDefinitionProvider, TypeDefinitionProvider } from './features/gotoDefinition';
import { HoverProvider } from './features/hover';
import { ReferenceProvider } from './features/references';
import { SemanticTokensProvider } from './features/semanticTokens';
import { SignatureHelpProvider } from './features/signatureHelp';
import { DocumentSymbolsProvider as SymbolProvider } from './features/symbols';
import { SyntaxErrorProvider } from './features/syntaxErrors';
import { CompilerService } from './services/compilerService';
import { FileGraphService } from './services/fileGraphService';
import { ParsingServiceImpl } from './services/parsingService';
import { PathResolver } from './services/pathResolver';
import { SemanticsService } from './services/semanticsService';
import { VirtualFileSystemImpl } from './services/vfs';
import { ReactiveCache } from './utils/reactiveCache';

export function activate(context: vscode.ExtensionContext) {
    // Services

    const cache = new ReactiveCache();

    const vfs = new VirtualFileSystemImpl(cache);
    context.subscriptions.push(vfs);

    const parsingService = new ParsingServiceImpl(cache, vfs);

    const pathResolver = new PathResolver(vfs);

    const semanticsService = new SemanticsService(parsingService, pathResolver, cache);

    const fileGraphService = new FileGraphService(parsingService, vfs, pathResolver);

    const compilerService = new CompilerService();

    // Hover

    context.subscriptions.push(
        vscode.languages.registerHoverProvider('bittle', new HoverProvider(parsingService, semanticsService)),
    );

    // Semantic tokens

    const semanticTokensProvider = new SemanticTokensProvider(parsingService);
    context.subscriptions.push(
        vscode.languages.registerDocumentSemanticTokensProvider(
            'bittle',
            semanticTokensProvider,
            semanticTokensProvider.legend,
        ),
    );

    // Syntax errors

    const syntaxErrorProvider = new SyntaxErrorProvider(parsingService);
    context.subscriptions.push(syntaxErrorProvider);

    const elaborationErrorProvider = new ElaborationDiagnosticProvider(semanticsService, cache);
    context.subscriptions.push(elaborationErrorProvider);

    const compilerErrorProvider = createCompilerErrorProvider(compilerService);
    context.subscriptions.push(compilerErrorProvider);

    function refreshDiagnostics(document: vscode.TextDocument) {
        if (document.languageId !== 'bittle')
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
        vscode.languages.registerDocumentSymbolProvider('bittle', symbolProvider),
        vscode.languages.registerWorkspaceSymbolProvider(symbolProvider),
    );

    // Code actions

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider('bittle', new CodeActionsProvider(parsingService)),
    );

    // Navigation

    const nameDefinitionProvider = new NameDefinitionProvider(parsingService, semanticsService, fileGraphService);
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider('bittle', new ImportAndIncludeDefinitionProvider(pathResolver, parsingService)),
        vscode.languages.registerDefinitionProvider('bittle', nameDefinitionProvider),
        vscode.languages.registerImplementationProvider('bittle', nameDefinitionProvider),
        vscode.languages.registerTypeDefinitionProvider('bittle', new TypeDefinitionProvider(parsingService, semanticsService)),
    );

    // Completion

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider('bittle', new CompletionProvider(parsingService, semanticsService), '.'),
    );

    context.subscriptions.push(
        vscode.languages.registerSignatureHelpProvider('bittle', new SignatureHelpProvider(parsingService, semanticsService), '(', ','),
    );

    // Rename and references

    const referenceProvider = new ReferenceProvider(parsingService, semanticsService, fileGraphService);
    context.subscriptions.push(
        vscode.languages.registerReferenceProvider('bittle', referenceProvider),
        vscode.languages.registerRenameProvider('bittle', referenceProvider),
    );

    // TODO:
    // - More code actions
    // - Formatting
}
