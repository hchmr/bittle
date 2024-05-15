import { window, languages, workspace, Diagnostic, DiagnosticSeverity, Range, Location, SymbolInformation, SymbolKind, OutputChannel, DiagnosticCollection, ExtensionContext, TextDocument, Position } from 'vscode';
import { spawn } from 'child_process';

module.exports = {
    activate,
};

let log: OutputChannel;

let diagnosticsCollection: DiagnosticCollection;

async function compile(document: TextDocument) {
    log.appendLine('Invoking compiler');

    const compilerPath = __dirname + '/../../out/stage0/cogc';
    const process = spawn(compilerPath, {
        stdio: ['pipe', 'ignore', 'pipe'],
        timeout: 1000,
    });

    process.stdin.write(document.getText());
    process.stdin.end();

    let stderr = '';
    process.stderr.on('data', data => {
        stderr += data.toString();
    });

    const code = await new Promise(resolve => {
        process.on('close', code => {
            resolve(code ?? 'unknown');
        });
    });
    log.appendLine(`Compiler exited with code ${code}`);

    return { ok: code == 0, stderr };
}

function makeDiagnostic(stderr: string) {
    const match = /^(\d+):(\d+):(.*)/s.exec(stderr);
    if (match) {
        const row = parseInt(match[1]) - 1;
        const col = parseInt(match[2]) - 1;
        return new Diagnostic(
            new Range(row, col, row, col),
            match[3].trim(),
            DiagnosticSeverity.Error
        );
    } else {
        return new Diagnostic(
            new Range(0, 0, 0, 0),
            stderr,
            DiagnosticSeverity.Error
        );
    }
}

function findDefinitionsInSource(document: TextDocument) {
    const definitions = [];

    for (const match of document.getText().matchAll(/^(struct|func|var|const)\s*(\w+)/gm)) {
        definitions.push({
            index: match.index + match[0].length - match[2].length,
            name: match[2],
            kind: {
                'struct': SymbolKind.Struct,
                'func': SymbolKind.Function,
                'var': SymbolKind.Variable,
                'const': SymbolKind.Constant,
            }[match[1]]!,
        });
    }

    // enums
    for (const match of document.getText().matchAll(/^enum\s*\{([^}]*)\}/gm)) {
        for (const part of match[1].split(',')) {
            const name = part.trim();
            if (name) {
                definitions.push({
                    index: match.index + match[0].indexOf(name),
                    name: name,
                    kind: SymbolKind.EnumMember,
                });
            }
        }
    }

    return definitions;
}

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

    const { ok, stderr } = await compile(document);

    log.appendLine(`Compiler output: ${ok}, '${stderr}'`);

    let diagnostics = !ok
        ? [makeDiagnostic(stderr)]
        : [];

    diagnosticsCollection.set(document.uri, diagnostics);
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
