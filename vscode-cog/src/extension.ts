import { window, languages, workspace, Range, Location, SymbolInformation, OutputChannel, DiagnosticCollection, ExtensionContext, TextDocument, Position, Uri } from 'vscode';
import { checkFile } from './compiler-check';
import { findDefinitionsInSource } from './definitions';

module.exports = {
    activate,
};

export let log: OutputChannel;

let diagnosticsCollection: DiagnosticCollection;

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

async function refreshDiagnostics(document: TextDocument) {
    if (document.languageId !== 'cog')
        return;

    const diagnostic = await checkFile(document);

    if (!diagnostic) {
        diagnosticsCollection.delete(document.uri);
    } else {
        diagnosticsCollection.set(
            Uri.file(diagnostic.fileName),
            [diagnostic.diagnostic]
        );
    }
}

function activate(context: ExtensionContext) {
    context.subscriptions.push(log = window.createOutputChannel('Cog'));
    setTimeout(() => log.show(), 1000);

    log.appendLine('Cog activated');

    diagnosticsCollection = languages.createDiagnosticCollection('Cog');
    context.subscriptions.push(diagnosticsCollection);

    workspace.onDidOpenTextDocument(e => refreshDiagnostics(e), null, context.subscriptions);
    workspace.onDidChangeTextDocument(e => refreshDiagnostics(e.document), null, context.subscriptions);
    workspace.textDocuments.forEach(refreshDiagnostics);

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
