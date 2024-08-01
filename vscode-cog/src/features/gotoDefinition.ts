import path from 'path';
import * as vscode from 'vscode';
import { Sym, SymKind, symRelatedType } from '../semantics/sym';
import { Type } from '../semantics/type';
import { ElaborationService } from '../services/elaborationService';
import { ParsingService } from '../services/parsingService';
import { SyntaxNode } from '../syntax';
import { isExprNode, isTypeNode } from '../syntax/nodeTypes';
import { fromVscPosition, toVscRange } from '../utils';
import { getNodesAtPosition } from '../utils/nodeSearch';
import { stream } from '../utils/stream';
import { VirtualFileSystem } from '../vfs';

export class IncludeDefinitionProvider implements vscode.DefinitionProvider {
    constructor(private vfs: VirtualFileSystem, private parsingService: ParsingService) { }

    provideDefinition(
        document: vscode.TextDocument,
        vscPosition: vscode.Position,
        token: vscode.CancellationToken,
    ) {
        const tree = this.parsingService.parse(document.fileName);
        const position = fromVscPosition(vscPosition);
        return getNodesAtPosition(tree, position)
            .filter(node => node.type === 'string_literal'
            && node.parent?.type === 'include_decl')
            .flatMap(node => {
                const stringValue = JSON.parse(node.text);
                const includePath = this.resolveInclude(document.uri.fsPath, stringValue);
                if (!includePath) {
                    return [];
                }
                return [{
                    originSelectionRange: toVscRange(node),
                    targetUri: vscode.Uri.file(includePath),
                    targetRange: new vscode.Range(0, 0, 0, 0),
                }];
            });
    }

    resolveInclude(filePath: string, stringValue: string) {
        const includePath = path.resolve(path.dirname(filePath), stringValue);
        if (this.vfs.readFile(includePath)) {
            return includePath;
        }
    }
}

export class NameDefinitionProvider implements vscode.DefinitionProvider {
    constructor(
        private parsingService: ParsingService,
        private elaborator: ElaborationService,
    ) { }

    provideDefinition(
        document: vscode.TextDocument,
        vscPosition: vscode.Position,
        token: vscode.CancellationToken,
    ) {
        const tree = this.parsingService.parse(document.fileName);
        const position = fromVscPosition(vscPosition);
        return getNodesAtPosition(tree, position)
            .filter(node => node.type === 'identifier')
            .flatMap(nameNode => {
                const symbol = this.elaborator.resolveSymbol(document.fileName, nameNode);
                if (!symbol) {
                    return [];
                }
                const originSelectionRange = toVscRange(nameNode);
                return symbol.origins.map(origin => {
                    return {
                        originSelectionRange,
                        targetUri: vscode.Uri.file(origin.file),
                        targetRange: toVscRange(origin.node),
                        targetSelectionRange: origin.nameNode ? toVscRange(origin.nameNode) : undefined,
                    };
                });
            });
    }
}

export class TypeDefinitionProvider implements vscode.TypeDefinitionProvider {
    constructor(
        private parsingService: ParsingService,
        private elaborationService: ElaborationService,
    ) { }

    provideTypeDefinition(
        document: vscode.TextDocument,
        vscPosition: vscode.Position,
        token: vscode.CancellationToken,
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
                symbol.origins.map(origin => {
                    return <vscode.LocationLink>{
                        originSelectionRange: toVscRange(node),
                        targetUri: vscode.Uri.file(origin.file),
                        targetRange: toVscRange(origin.node),
                        targetSelectionRange: origin.nameNode ? toVscRange(origin.nameNode) : undefined,
                    };
                }),
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
        if (type.kind === 'pointer') {
            type = type.elementType;
        }
        if (type.kind !== 'struct') {
            return;
        }
        return this.elaborationService.getSymbol(filePath, type.qualifiedName);
    }
}
