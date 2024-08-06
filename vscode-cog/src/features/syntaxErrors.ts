import * as vscode from 'vscode';
import { ParsingService } from '../services/parsingService';
import { Error } from '../syntax';
import { toVscPosition } from '../utils';
import { interceptExceptions } from '../utils/interceptExceptions';

export class SyntaxErrorProvider implements vscode.Disposable {
    private diagnosticsCollection = vscode.languages.createDiagnosticCollection('Cog');

    constructor(private parsingService: ParsingService) { }

    dispose() {
        this.diagnosticsCollection.dispose();
    }

    @interceptExceptions
    updateDiagnostics(document: vscode.TextDocument) {
        if (document.isClosed) {
            this.diagnosticsCollection.delete(document.uri);
        } else {
            const diagnostics = this.createDiagnostics(document);
            this.diagnosticsCollection.set(document.uri, diagnostics);
        }
    }

    createDiagnostics(document: vscode.TextDocument) {
        const errors = this.parsingService.parseErrors(document.uri.fsPath);
        return errors.map(error => createDiagnostic(document, error));
    }
}

function createDiagnostic(
    document: vscode.TextDocument,
    error: Error,
    severity = vscode.DiagnosticSeverity.Error,
): vscode.Diagnostic {
    const position = toVscPosition(error.position);
    const range = document.getWordRangeAtPosition(position) ?? new vscode.Range(position, position);
    return new vscode.Diagnostic(range, error.message, severity);
}
