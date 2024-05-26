import { window, languages, workspace, Range, Location, SymbolInformation, OutputChannel, DiagnosticCollection, ExtensionContext, TextDocument, Position, Uri, DiagnosticSeverity, Diagnostic } from 'vscode';
import { checkFile as compilerCheck } from './compiler-check';
import { findDefinitionsInSource } from './definitions';
import { parser } from './parser';
import { Tree } from '@lezer/common';

module.exports = {
    activate,
};

export let log: OutputChannel;

let compilerDiagnostics: DiagnosticCollection;

let parserDiagnostics: DiagnosticCollection;

function searchDefinitions(document: TextDocument, position: Position) {
    const definitions = findDefinitionsInSource(document);
    const word = document.getText(document.getWordRangeAtPosition(position));
    log.appendLine(`Looking for definition of '${word}'`);
    const filtered = definitions.filter(def => def.name === word).map(def => new Location(
        document.uri,
        new Range(
            document.positionAt(def.index),
            document.positionAt(def.index + def.name.length)
        )
    ));
    log.appendLine(`Found definitions: ${JSON.stringify(filtered)}`);
    return filtered;
}

async function refreshCompilerDiagnostics(document: TextDocument) {
    if (document.languageId !== 'cog')
        return;

    const diagnostic = await compilerCheck(document);

    if (!diagnostic) {
        compilerDiagnostics.delete(document.uri);
    } else {
        compilerDiagnostics.set(
            Uri.file(diagnostic.fileName),
            [diagnostic.diagnostic]
        );
    }
}

function updateParserErrors(document: TextDocument, tree: Tree) {
    const diagnostics = []
    const cursor = tree.cursor()
    do {
        if (!cursor.type.isError)
            continue;
        diagnostics.push(new Diagnostic(
            new Range(
                document.positionAt(cursor.from),
                document.positionAt(cursor.to),
            ),
            'Syntax error',
            DiagnosticSeverity.Error,
        ));
    } while (cursor.next());

    parserDiagnostics.set(document.uri, diagnostics);
}

async function refreshFile(document: TextDocument) {
    if (document.languageId !== 'cog')
        return;

    log.appendLine(`Refreshing file ${document.fileName}`);

    const tree = parser.parse(document.getText());
    updateParserErrors(document, tree);
    await refreshCompilerDiagnostics(document);
}

function activate(context: ExtensionContext) {
    context.subscriptions.push(log = window.createOutputChannel('Cog'));
    setTimeout(() => log.show(), 1000);

    log.appendLine('Cog activated');

    compilerDiagnostics = languages.createDiagnosticCollection('Cog Compiler');
    context.subscriptions.push(compilerDiagnostics);

    parserDiagnostics = languages.createDiagnosticCollection('Cog Syntax');
    context.subscriptions.push(parserDiagnostics);

    workspace.onDidOpenTextDocument(e => refreshFile(e), null, context.subscriptions);
    workspace.onDidChangeTextDocument(e => refreshFile(e.document), null, context.subscriptions);
    workspace.textDocuments.forEach(refreshFile);

    context.subscriptions.push(languages.registerDefinitionProvider('cog', {
        provideDefinition(document, position) {
            return searchDefinitions(document, position);
        },
    }));

    context.subscriptions.push(languages.registerDocumentSymbolProvider('cog', {
        provideDocumentSymbols(document) {
            return findDefinitionsInSource(document).map(def =>
                new SymbolInformation(
                    def.name,
                    def.kind,
                    undefined!,
                    new Location(document.uri, new Range(
                        document.positionAt(def.index),
                        document.positionAt(def.index + def.name.length)
                    ))
                ));
        },
    }));
}
