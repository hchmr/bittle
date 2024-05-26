import * as vscode from 'vscode';
import { parser } from './parser';
import * as lezer from '@lezer/common';
import * as path from 'path';
import * as fs from 'fs';
import { getCompilerDiagnostics } from './compiler-check';

export let log: vscode.OutputChannel;

// Map of diagnostics generated for each document
const diagnosticCollections = new Map<string, vscode.DiagnosticCollection>();

function getSyntaxErrors(tree: any, document: vscode.TextDocument) {
    const diagnostics = [];

    const cursor = tree.cursor();
    do {
        if (!cursor.type.isError)
            continue;
        diagnostics.push(new vscode.Diagnostic(
            new vscode.Range(
                document.positionAt(cursor.from),
                document.positionAt(cursor.to)
            ),
            'Syntax error',
            vscode.DiagnosticSeverity.Error,
        ));
    } while (cursor.next());

    return diagnostics;
}

async function lintDocument(document: vscode.TextDocument) {
    log.appendLine(`Linting ${document.uri.toString()}`);

    const tree = parser.parse(document.getText());

    let collection = diagnosticCollections.get(document.fileName)
        ?? vscode.languages.createDiagnosticCollection(document.uri.toString());
    collection.clear();
    diagnosticCollections.set(document.fileName, collection);

    const parserDiagnostics = getSyntaxErrors(tree, document);

    const groups: Map<string, vscode.Diagnostic[]> = new Map();
    groups.set(document.uri.toString(), parserDiagnostics);

    const compilerDiagnostics = await getCompilerDiagnostics(document);
    for (const { fileName, diagnostic } of compilerDiagnostics) {
        const diagnostics = groups.get(fileName) ?? [];
        diagnostics.push(diagnostic);
        groups.set(fileName, diagnostics);
    }

    for (const [path, diagnostics] of groups) {
        collection.set(vscode.Uri.parse(path), diagnostics);
    }
}

function getText(node: lezer.SyntaxNode, document: vscode.TextDocument) {
    return document.getText().slice(node.from, node.to);
}

function makeDefinition(kind: vscode.SymbolKind, node: lezer.SyntaxNode, document: vscode.TextDocument) {
    return new vscode.SymbolInformation(
        getText(node, document),
        kind,
        undefined!,
        new vscode.Location(
            document.uri,
            new vscode.Range(
                document.positionAt(node.from),
                document.positionAt(node.to),
            )
        ),
    )
}

function resolveIncludePath(document: vscode.TextDocument, fileName: string) {
    const includeFilename = JSON.parse(fileName);
    const includeFilePath = path.resolve(path.dirname(document.fileName), includeFilename);
    if (!fs.existsSync(includeFilePath))
        return;
    return includeFilePath;
}

async function* getTopLevelSymbols(document: vscode.TextDocument): AsyncGenerator<vscode.SymbolInformation> {
    const tree = parser.parse(document.getText());

    for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
        if (node.type.name == 'IncludeDecl') {
            const stringNode = node.getChild('String');
            if (!stringNode)
                continue;
            const includeFilePath = resolveIncludePath(document, getText(stringNode, document));
            if (!includeFilePath)
                continue;
            const includedDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(includeFilePath));
            yield* getTopLevelSymbols(includedDocument);
        } else if (node.type.name == 'FuncDecl') {
            const nameNode = node.getChild('Identifier');
            if (!nameNode)
                continue;
            yield makeDefinition(vscode.SymbolKind.Function, nameNode, document);
        } else if (node.type.name == 'GlobalDecl') {
            const nameNode = node.getChild('Identifier');
            if (!nameNode)
                continue;
            yield makeDefinition(vscode.SymbolKind.Function, nameNode, document);
        } else if (node.type.name == 'ConstDecl') {
            const nameNode = node.getChild('Identifier');
            if (!nameNode)
                continue;
            yield makeDefinition(vscode.SymbolKind.Constant, nameNode, document);
        } else if (node.type.name == 'EnumDecl') {
            for (let child = node.firstChild; child; child = child.nextSibling) {
                if (child.type.name !== 'EnumValue')
                    continue;
                const nameNode = child.getChild('Identifier');
                if (!nameNode)
                    continue;
                yield makeDefinition(vscode.SymbolKind.Constant, nameNode, document);
            }
        } else if (node.type.name == 'StructDecl') {
            const nameNode = node.getChild('Identifier');
            if (!nameNode)
                continue;
            yield makeDefinition(vscode.SymbolKind.Struct, nameNode, document);
        }
    }
}

async function getDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.DefinitionLink[] | vscode.Definition> {
    const offset = document.offsetAt(position);
    const node = parser.parse(document.getText()).topNode.resolve(offset);
    if (node.type.name == 'String' && node.matchContext(['IncludeDecl'])) {
        const resolvedPath = resolveIncludePath(document, getText(node, document));
        if (resolvedPath) {
            const resolvedUri = vscode.Uri.file(resolvedPath);
            return [{
                originSelectionRange: new vscode.Range(
                    document.positionAt(node.from + 1),
                    document.positionAt(node.to - 1),
                ),
                targetUri: resolvedUri,
                targetRange: new vscode.Range(0, 0, 0, 0),
            }];
        }
    }

    const topLevelSymbols = getTopLevelSymbols(document);

    const result = [];
    if (node.type.name == 'Identifier') {
        const name = getText(node, document);
        for await (const symbol of topLevelSymbols) {
            if (symbol.name === name) {
                result.push(symbol.location);
            }
        }
    }

    return result;
}

async function getDocumentSymbols(document: vscode.TextDocument): Promise<vscode.SymbolInformation[]> {
    const symbols = [];
    for await (const symbol of getTopLevelSymbols(document)) {
        if (symbol.location.uri === document.uri)
            symbols.push(symbol);
    }
    return symbols;
}

async function findWorkspaceSymbols(query: string, token: vscode.CancellationToken): Promise<vscode.SymbolInformation[]> {
    log.appendLine(`Searching for symbols matching ${query} in the following documents:`);
    for (const document of vscode.workspace.textDocuments) {
        if (document.languageId === 'cog')
            log.appendLine('  ' + document.uri.toString());
    }
    const symbols = [];
    for (const document of vscode.workspace.textDocuments) {
        if (document.languageId !== 'cog')
            continue;
        for await (const symbol of getTopLevelSymbols(document)) {
            if (!symbol.name.includes(query))
                continue;
            symbols.push(symbol);
        }
    }
    return symbols;
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        log = vscode.window.createOutputChannel('Cog'),
    );
    setTimeout(() => log.show(), 1000);

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(e => {
            if (e.languageId !== 'cog')
                return;
            lintDocument(e);
        }),
        vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.languageId !== 'cog')
                return;
            lintDocument(e.document);
        }),
    );
    vscode.workspace.textDocuments.forEach(document => {
        if (document.languageId === 'cog')
            lintDocument(document);
    });
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider('cog', {
            provideDefinition: getDefinition,
        }),
        vscode.languages.registerDocumentSymbolProvider('cog', {
            provideDocumentSymbols: getDocumentSymbols,
        }),
        vscode.languages.registerWorkspaceSymbolProvider({
            provideWorkspaceSymbols: findWorkspaceSymbols,
        }),
    );
}

export function deactivate() {
    for (const collection of diagnosticCollections.values()) {
        collection.dispose();
    }
}