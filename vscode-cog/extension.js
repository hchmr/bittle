const { window, languages, workspace, Diagnostic, DiagnosticSeverity, Range } = require('vscode');
const { spawn } = require('child_process');

// @ts-check

/** @typedef {import('vscode').ExtensionContext} ExtensionContext */
/** @typedef {import('vscode').OutputChannel} OutputChannel */
/** @typedef {import('vscode').TextDocument} TextDocument */
/** @typedef {import('vscode').DiagnosticCollection} DiagnosticCollection */

module.exports = {
    activate,
};

/** @type {OutputChannel} */
let log;

/** @type {DiagnosticCollection} */
let diagnosticsCollection;

/**
 * @param {ExtensionContext} context
 */
function activate(context) {
    context.subscriptions.push(log = window.createOutputChannel('Cog'));
    log.show();

    log.appendLine('Cog activated');

    diagnosticsCollection = languages.createDiagnosticCollection('Cog');
    context.subscriptions.push(diagnosticsCollection);

    workspace.onDidOpenTextDocument(e => refreshDiagnostics(e), null, context.subscriptions);
    workspace.onDidChangeTextDocument(e => refreshDiagnostics(e.document), null, context.subscriptions);
    workspace.textDocuments.forEach(refreshDiagnostics);
}

/**
 * @param {TextDocument} document
 */
async function refreshDiagnostics(document) {
    if (document.languageId !== 'cog')
        return;

    const { ok, stderr } = await compile(document);

    log.appendLine(`Compiler output: ${ok}, '${stderr}'`);

    let diagnostics = !ok
        ? [makeDiagnostic(stderr)]
        : [];

    diagnosticsCollection.set(document.uri, diagnostics);
}

/**
 * @param {string} stderr
 */
function makeDiagnostic(stderr) {
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

/**
 * @param {TextDocument} document
 */
async function compile(document) {
    log.appendLine('Invoking compiler');

    const compilerPath = __dirname + '/../bootstrap/cmake-build-debug/cog0';
    const process = spawn(compilerPath, { stdio: ['pipe', 'ignore', 'pipe'] });

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
