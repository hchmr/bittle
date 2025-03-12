import path from 'path';
import * as vscode from 'vscode';
import { Origin, Sym, SymKind, symRelatedType } from '../semantics/sym';
import { Type, TypeKind, unifyTypes } from '../semantics/type';
import { IncludeGraphService } from '../services/includeGraphService';
import { ParsingService } from '../services/parsingService';
import { SemanticsService } from '../services/semanticsService';
import { VirtualFileSystem } from '../services/vfs';
import { Point, SyntaxNode } from '../syntax';
import { isExprNode, isPatternNode, isTypeNode, NodeTypes } from '../syntax/nodeTypes';
import { interceptExceptions } from '../utils/interceptExceptions';
import { parseString } from '../utils/literalParsing';
import { stream } from '../utils/stream';
import { fromVscPosition, toVscRange } from '../utils/vscode';

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
        return stream(tree.rootNode.descendantsForPosition(position))
            .filter(node => node.type === 'string_literal' && node.parent?.type === NodeTypes.IncludeDecl)
            .filterMap(node => {
                const stringValue = parseString(node.text);
                if (!stringValue) {
                    return;
                }
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
        private semanticsService: SemanticsService,
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
        return stream(tree.rootNode.descendantsForPosition(position))
            .filter(node => node.type === NodeTypes.identifier)
            .flatMap(nameNode => {
                const symbols = this.semanticsService.resolveSymbol(filePath, nameNode);
                return stream(symbols)
                    .flatMap(sym => [sym, ...this.getSameSymbolInReferringFiles(sym)])
                    .flatMap(sym => sym.origins)
                    .filter(origin => !definitionOnly || !origin.isForwardDecl)
                    .distinctBy(origin => origin.file + '|' + origin.node.startIndex)
                    .map(origin => originToLocationLink(nameNode, origin))
                    .toArray();
            })
            .toArray();
    }

    private getSameSymbolInReferringFiles(symbol: Sym) {
        return this.findReferringFiles(symbol)
            .filterMap(filePath => this.semanticsService.getSymbol(filePath, symbol.qualifiedName));
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
        private semanticsService: SemanticsService,
    ) { }

    @interceptExceptions
    provideTypeDefinition(
        document: vscode.TextDocument,
        vscPosition: vscode.Position,
        _token: vscode.CancellationToken,
    ) {
        const tree = this.parsingService.parse(document.fileName);
        const position = fromVscPosition(vscPosition);
        return stream(tree.rootNode.descendantsForPosition(position))
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
        return this.fromType(filePath, type);
    }

    getTypeForNode(filePath: string, node: SyntaxNode): Type | undefined {
        if (node.type === NodeTypes.identifier) {
            const syms = this.semanticsService
                .resolveSymbol(filePath, node)
                .filter(sym => sym.kind !== SymKind.Func);
            if (!syms.length) {
                return;
            }
            return syms
                .map(sym => symRelatedType(sym))
                .reduce(unifyTypes);
        } else if (isExprNode(node) || isPatternNode(node)) {
            return this.semanticsService.inferType(filePath, node);
        } else if (isTypeNode(node)) {
            return this.semanticsService.evalType(filePath, node);
        }
    }

    fromType(filePath: string, type: Type): Sym | undefined {
        if (type.kind === TypeKind.Ptr) {
            type = type.pointeeType;
        }
        if (type.kind !== TypeKind.Record) {
            return;
        }
        return this.semanticsService.getSymbol(filePath, type.sym.qualifiedName);
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
