import * as vscode from 'vscode';
import { SymReference } from '../semantics/elaborator';
import { Sym } from '../semantics/sym';
import { ElaborationService } from '../services/elaborationService';
import { IncludeGraphService } from '../services/includeGraphService';
import { ParsingService } from '../services/parsingService';
import { fromVscPosition, toVscRange } from '../utils';
import { getIdentifierAtPosition } from '../utils/nodeSearch';
import { stream } from '../utils/stream';

export class ReferenceProvider implements vscode.ReferenceProvider, vscode.RenameProvider {
    constructor(
        private parsingService: ParsingService,
        private elaborationService: ElaborationService,
        private includeGraphService: IncludeGraphService,
    ) { }

    provideRenameEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        newName: string,
    ): vscode.ProviderResult<vscode.WorkspaceEdit> {
        const references = this.provideReferences(document, position, { includeDeclaration: true });

        const workspaceEdit = new vscode.WorkspaceEdit();
        for (const reference of references) {
            workspaceEdit.replace(reference.uri, reference.range, newName);
        }
        return workspaceEdit;
    }

    provideReferences(
        document: vscode.TextDocument,
        vscPosition: vscode.Position,
        context: vscode.ReferenceContext,
    ) {
        const path = document.uri.fsPath;
        const tree = this.parsingService.parse(path);
        const position = fromVscPosition(vscPosition);
        const nameNode = getIdentifierAtPosition(tree, position);
        if (!nameNode) {
            return [];
        }

        const symbol = this.elaborationService.resolveSymbol(path, nameNode);
        if (!symbol) {
            return [];
        }

        const referringFiles = this.findReferringFiles(symbol);

        const references: Array<SymReference> = [];

        // add definitions
        if (context.includeDeclaration) {
            references.push(
                ...stream(symbol.origins)
                    .filterMap(origin => origin.nameNode && { file: origin.file, nameNode: origin.nameNode }),
            );
        }

        // add references in the same file
        references.push(
            ...this.elaborationService.references(path, symbol.qualifiedName),
        );

        // add references in referring files
        for (const referringFile of referringFiles) {
            references.push(...this.elaborationService.references(referringFile, symbol.qualifiedName));
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

    private findReferringFiles(symbol: Sym) {
        return stream(symbol.origins)
            .map(origin => origin.file)
            .distinct()
            .flatMap(filePath => this.includeGraphService.getFinalReferences(filePath))
            .distinct();
    }
}
