import * as vscode from 'vscode';
import { SymReference } from '../semantics/elaborator';
import { Sym } from '../semantics/sym';
import { IncludeGraphService } from '../services/includeGraphService';
import { ParsingService } from '../services/parsingService';
import { SemanticsService } from '../services/semanticsService';
import { fromVscPosition, toVscRange } from '../utils';
import { interceptExceptions } from '../utils/interceptExceptions';
import { getIdentifierAtPosition } from '../utils/nodeSearch';
import { stream } from '../utils/stream';

export class ReferenceProvider implements vscode.ReferenceProvider, vscode.RenameProvider {
    constructor(
        private parsingService: ParsingService,
        private semanticsService: SemanticsService,
        private includeGraphService: IncludeGraphService,
    ) { }

    @interceptExceptions
    provideRenameEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        newName: string,
        token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.WorkspaceEdit> {
        const references = this.provideReferences(document, position, { includeDeclaration: true }, token);

        const workspaceEdit = new vscode.WorkspaceEdit();
        for (const reference of references) {
            workspaceEdit.replace(reference.uri, reference.range, newName);
        }
        return workspaceEdit;
    }

    @interceptExceptions
    provideReferences(
        document: vscode.TextDocument,
        vscPosition: vscode.Position,
        context: vscode.ReferenceContext,
        _token: vscode.CancellationToken,
    ) {
        const path = document.uri.fsPath;
        const tree = this.parsingService.parse(path);
        const position = fromVscPosition(vscPosition);
        const nameNode = getIdentifierAtPosition(tree, position);
        if (!nameNode) {
            return [];
        }

        const symbol = this.semanticsService.resolveSymbol(path, nameNode);
        if (!symbol) {
            return [];
        }

        const referringFiles = this.findReferringFiles(symbol);

        const references: Array<SymReference> = [];

        // add definitions
        if (context.includeDeclaration) {
            references.push(
                ...stream([symbol]).concat(this.getSameSymbolInReferringFiles(symbol))
                    .flatMap(sym => sym.origins)
                    .filterMap(origin => origin.nameNode && { file: origin.file, nameNode: origin.nameNode }),
            );
        }

        // add references in the same file
        references.push(
            ...this.semanticsService.references(path, symbol.qualifiedName),
        );

        // add references in referring files
        for (const referringFile of referringFiles) {
            references.push(...this.semanticsService.references(referringFile, symbol.qualifiedName));
        }

        return stream(references)
            .distinctBy(reference => reference.file + '|' + reference.nameNode.startIndex)
            .map(reference => {
                return <vscode.Location>{
                    uri: vscode.Uri.file(reference.file),
                    range: toVscRange(reference.nameNode),
                };
            })
            .toArray();
    }

    private getSameSymbolInReferringFiles(symbol: Sym) {
        return this.findReferringFiles(symbol)
            .filterMap(filePath => this.semanticsService.getSymbol(filePath, symbol.qualifiedName));
    }

    private findReferringFiles(symbol: Sym) {
        return stream(symbol.origins)
            .map(origin => origin.file)
            .distinct()
            .flatMap(filePath => this.includeGraphService.getFinalReferences(filePath))
            .distinct();
    }
}
