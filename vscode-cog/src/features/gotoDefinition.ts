import path from 'path';
import * as vscode from 'vscode';
import { Origin, Sym, SymKind, symRelatedType } from '../semantics/sym';
import { Type, TypeKind } from '../semantics/type';
import { ElaborationService } from '../services/elaborationService';
import { IncludeGraphService } from '../services/includeGraphService';
import { ParsingService } from '../services/parsingService';
import { Point, SyntaxNode } from '../syntax';
import { isExprNode, isTypeNode, NodeTypes } from '../syntax/nodeTypes';
import { fromVscPosition, toVscRange } from '../utils';
import { interceptExceptions } from '../utils/interceptExceptions';
import { getNodesAtPosition } from '../utils/nodeSearch';
import { stream } from '../utils/stream';
import { VirtualFileSystem } from '../vfs';

export class IncludeDefinitionProvider implements vscode.DefinitionProvider {
    constructor(
        private vfs: VirtualFileSystem,
        private parsingService: ParsingService,
    ) { }

    @interceptExceptions
    provideDefinition(
        document: vscode.TextDocument,
        vscPosition: vscode.Position,
        _token: vscode.CancellationToken,
    ) {
        const tree = this.parsingService.parse(document.fileName);
        const position = fromVscPosition(vscPosition);
        return stream(getNodesAtPosition(tree, position))
            .filter(node => node.type === 'string_literal'
            && node.parent?.type === NodeTypes.IncludeDecl)
            .filterMap(node => {
                const stringValue = JSON.parse(node.text);
                const includePath = this.resolveInclude(document.uri.fsPath, stringValue);
                if (!includePath) {
                    return;
                }
                return {
                    originSelectionRange: toVscRange(node),
                    targetUri: vscode.Uri.file(includePath),
                    targetRange: new vscode.Range(0, 0, 0, 0),
                };
            })
            .toArray();
    }

    resolveInclude(filePath: string, stringValue: string) {
        const includePath = path.resolve(path.dirname(filePath), stringValue);
        if (this.vfs.readFile(includePath)) {
            return includePath;
        }
    }
}

export class NameDefinitionProvider implements vscode.DefinitionProvider, vscode.ImplementationProvider {
    constructor(
        private parsingService: ParsingService,
        private elaborator: ElaborationService,
        private includeGraphService: IncludeGraphService,
    ) { }

    @interceptExceptions
    provideDefinition(
        document: vscode.TextDocument,
        vscPosition: vscode.Position,
        _token: vscode.CancellationToken,
    ) {
        const position = fromVscPosition(vscPosition);
        const filePath = document.fileName;
        return this.getDefinitionOrigins(filePath, position);
    }

    @interceptExceptions
    provideImplementation(
        document: vscode.TextDocument,
        vscPosition: vscode.Position,
    ) {
        const position = fromVscPosition(vscPosition);
        const filePath = document.fileName;
        return this.getDefinitionOrigins(filePath, position, true);
    }

    private getDefinitionOrigins(filePath: string, position: Point, definitionOnly = false): vscode.LocationLink[] {
        const tree = this.parsingService.parse(filePath);
        return getNodesAtPosition(tree, position)
            .filter(node => node.type === 'identifier')
            .flatMap(nameNode => {
                const symbol = this.elaborator.resolveSymbol(filePath, nameNode);
                if (!symbol) {
                    return [];
                }

                return stream([symbol]).concat(this.getSameSymbolInReferringFiles(symbol))
                    .flatMap(sym => sym.origins)
                    .filter(origin => !definitionOnly || !origin.isForwardDecl)
                    .distinctBy(origin => origin.file + '|' + origin.node.startIndex)
                    .map(origin => originToLocationLink(nameNode, origin))
                    .toArray();
            });
    }

    private getSameSymbolInReferringFiles(symbol: Sym) {
        return this.findReferringFiles(symbol)
            .filterMap(filePath => this.elaborator.getSymbol(filePath, symbol.qualifiedName));
    }

    // TODO: Copied from references.ts
    private findReferringFiles(symbol: Sym) {
        return stream(symbol.origins)
            .map(origin => origin.file)
            .distinct()
            .flatMap(filePath => this.includeGraphService.getFinalReferences(filePath))
            .distinct();
    }
}

export class TypeDefinitionProvider implements vscode.TypeDefinitionProvider {
    constructor(
        private parsingService: ParsingService,
        private elaborationService: ElaborationService,
    ) { }

    @interceptExceptions
    provideTypeDefinition(
        document: vscode.TextDocument,
        vscPosition: vscode.Position,
        _token: vscode.CancellationToken,
    ) {
        const tree = this.parsingService.parse(document.fileName);
        const position = fromVscPosition(vscPosition);
        return stream(getNodesAtPosition(tree, position))
            .filterMap(startNode => {
                // Essentially the same algorithm as in the hover provider
                for (let node: SyntaxNode | null = startNode; node; node = node.parent) {
                    const symbol = this.getSymbolForNode(document.fileName, node);
                    if (symbol) {
                        return { node, symbol };
                    }
                }
            })
            .flatMap(({ node, symbol }) =>
                symbol.origins.map(origin => originToLocationLink(node, origin)),
            )
            .toArray();
    }

    getSymbolForNode(filePath: string, node: SyntaxNode): Sym | undefined {
        const type = this.getTypeForNode(filePath, node);
        if (!type) {
            return;
        }
        return this.fromType(filePath, node, type);
    }

    getTypeForNode(filePath: string, node: SyntaxNode): Type | undefined {
        if (node.type === 'identifier') {
            const sym = this.elaborationService.resolveSymbol(filePath, node);
            if (!sym || sym.kind === SymKind.Func) {
                return;
            }
            return symRelatedType(sym);
        } else if (isExprNode(node)) {
            return this.elaborationService.inferType(filePath, node);
        } else if (isTypeNode(node)) {
            return this.elaborationService.evalType(filePath, node);
        }
    }

    fromType(filePath: string, node: SyntaxNode, type: Type): Sym | undefined {
        if (type.kind === TypeKind.Ptr) {
            type = type.pointeeType;
        }
        if (type.kind !== TypeKind.Struct) {
            return;
        }
        return this.elaborationService.getSymbol(filePath, type.sym.qualifiedName);
    }
}

function originToLocationLink(sourceNode: SyntaxNode, target: Origin): vscode.LocationLink {
    return {
        originSelectionRange: toVscRange(sourceNode),
        targetUri: vscode.Uri.file(target.file),
        targetRange: toVscRange(target.node),
        targetSelectionRange: target.nameNode ? toVscRange(target.nameNode) : undefined,
    };
}
