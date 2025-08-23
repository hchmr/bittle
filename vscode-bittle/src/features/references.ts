import * as vscode from 'vscode';
import { SymReference } from '../semantics/elaborator';
import { Sym } from '../semantics/sym';
import { FileGraphService } from '../services/fileGraphService';
import { ParsingService } from '../services/parsingService';
import { SemanticsService } from '../services/semanticsService';
import { SyntaxNode } from '../syntax';
import { NodeTypes } from '../syntax/nodeTypes';
import { interceptExceptions } from '../utils/interceptExceptions';
import { getIdentifierAtPosition } from '../utils/nodeSearch';
import { stream } from '../utils/stream';
import { fromVscPosition, toVscRange } from '../utils/vscode';

export class ReferenceProvider implements vscode.ReferenceProvider, vscode.RenameProvider {
    constructor(
        private parsingService: ParsingService,
        private semanticsService: SemanticsService,
        private fileGraphService: FileGraphService,
    ) { }

    @interceptExceptions
    provideRenameEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        newName: string,
        _token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.WorkspaceEdit> {
        const references = this.findReferences(document, position, { includeDeclaration: true });

        const workspaceEdit = new vscode.WorkspaceEdit();
        for (const reference of references) {
            const uri = vscode.Uri.file(reference.file);
            const range = toVscRange(reference.nameNode);
            if (isShorthandFieldInit(reference.nameNode)) {
                workspaceEdit.insert(uri, range.start, `${newName}: `);
            } else {
                workspaceEdit.replace(uri, range, newName);
            }
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
        const references = this.findReferences(document, vscPosition, context);

        return references
            .map(reference => new vscode.Location(
                vscode.Uri.file(reference.file),
                toVscRange(reference.nameNode),
            ))
            .toArray();
    }

    private findReferences(
        document: vscode.TextDocument,
        vscPosition: vscode.Position,
        context: vscode.ReferenceContext,
    ) {
        const path = document.uri.fsPath;
        const tree = this.parsingService.parse(path);
        const position = fromVscPosition(vscPosition);
        const nameNode = getIdentifierAtPosition(tree, position);
        if (!nameNode) {
            return stream([]);
        }

        const symbols = this.semanticsService.resolveSymbol(path, nameNode);

        const references: SymReference[] = [];

        for (const symbol of symbols) {
            // add definitions
            if (context.includeDeclaration) {
                references.push(
                    ...stream([symbol])
                        .flatMap(sym => sym.origins)
                        .filterMap(origin => origin.nameNode && { file: origin.file, nameNode: origin.nameNode }),
                );
            }

            // add references in the same file
            references.push(
                ...this.semanticsService.references(path, symbol.qualifiedName),
            );

            // add references in referring files
            for (const referringFile of this.findImportingFiles(symbol)) {
                references.push(...this.semanticsService.references(referringFile, symbol.qualifiedName));
            }
        }

        return stream(references)
            .distinctBy(reference => reference.file + '|' + reference.nameNode.startIndex);
    }

    private findImportingFiles(symbol: Sym) {
        return stream(symbol.origins)
            .map(origin => origin.file)
            .distinct()
            .flatMap(filePath => this.fileGraphService.getImportingFiles(filePath))
            .distinct();
    }
}

// Look for the following pattern:
//  FieldInit
//    name: null
//    value: NameExpr
//      identifierToken: ${nameNode}
function isShorthandFieldInit(nameNode: SyntaxNode) {
    if (nameNode.parent?.type !== NodeTypes.NameExpr) {
        return false;
    }
    const nameExprNode = nameNode.parent;

    if (nameExprNode.parent?.type !== NodeTypes.FieldInit) {
        return false;
    }
    const fieldInitNode = nameExprNode.parent;

    return fieldInitNode.childForFieldName('name') === null
        && fieldInitNode.childForFieldName('value') === nameExprNode;
}
