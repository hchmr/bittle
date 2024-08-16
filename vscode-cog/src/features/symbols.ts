import * as vscode from 'vscode';
import { ParsingService } from '../services/parsingService';
import { VirtualFileSystem } from '../services/vfs';
import { SyntaxNode } from '../syntax';
import { NodeTypes } from '../syntax/nodeTypes';
import { toVscRange } from '../utils';
import { fuzzySearch as searchFuzzy } from '../utils/fuzzySearch';
import { interceptExceptions } from '../utils/interceptExceptions';
import { ReactiveCache } from '../utils/reactiveCache';
import { stream } from '../utils/stream';

export class DocumentSymbolsProvider implements vscode.DocumentSymbolProvider, vscode.WorkspaceSymbolProvider {
    constructor(
        private parsingService: ParsingService,
        private vfs: VirtualFileSystem,
        private cache: ReactiveCache,
    ) { }

    @interceptExceptions
    provideDocumentSymbols(document: vscode.TextDocument) {
        return this.getDocumentSymbols(document.uri.fsPath);
    }

    @interceptExceptions
    provideWorkspaceSymbols(query: string, token: vscode.CancellationToken): vscode.ProviderResult<vscode.SymbolInformation[]> {
        const unfilteredSymbols = this.getUnfilteredWorkspaceSymbols();
        return searchFuzzy(query, unfilteredSymbols, { key: 'name' }).reverse(); // Reverse to show definitions before declarations.
    }

    private getDocumentSymbols(path: string) {
        const tree = this.parsingService.parse(path);

        const rootSymbols: DocumentSymbol[] = [];

        const visit = (node: SyntaxNode, currentSymbol: DocumentSymbol | null) => {
            if (node.type in symbolKindMapping) {
                const symbol = DocumentSymbol.fromNode(node);
                (currentSymbol?.children ?? rootSymbols).push(symbol);
                currentSymbol = symbol;
            }

            for (const child of node.children) {
                visit(child, currentSymbol);
            }
        };

        visit(tree.rootNode, null);

        return rootSymbols;
    }

    private getUnfilteredWorkspaceSymbols() {
        // Cached to avoid recomputing when the search query changes.
        return this.cache.compute('workspaceSymbols:*', () =>
            stream(this.vfs.listFiles())
                .flatMap(file => this.getWorkspaceSymbolsForFile(file))
                .toArray(),
        );
    }

    private getWorkspaceSymbolsForFile(file: string): Iterable<vscode.SymbolInformation> {
        // Cached to avoid recomputing if another file in the file list is invalidated.
        return this.cache.compute(`workspaceSymbols:${file}`, () =>
            this.getDocumentSymbols(file)
                .flatMap(symbol => fromDocumentSymbol(vscode.Uri.file(file), symbol)),
        );
    }
}

const symbolKindMapping = {
    [NodeTypes.EnumMember]: vscode.SymbolKind.Constant,
    [NodeTypes.StructDecl]: vscode.SymbolKind.Struct,
    [NodeTypes.StructMember]: vscode.SymbolKind.Field,
    [NodeTypes.FuncDecl]: vscode.SymbolKind.Function,
    [NodeTypes.FuncParam]: vscode.SymbolKind.Variable,
    [NodeTypes.GlobalDecl]: vscode.SymbolKind.Variable,
    [NodeTypes.ConstDecl]: vscode.SymbolKind.Constant,
    [NodeTypes.LocalDecl]: vscode.SymbolKind.Variable,
};

function convertSymbolKind(type: string) {
    const mapping: Record<string, vscode.SymbolKind> = symbolKindMapping;
    return mapping[type] ?? null;
}

class DocumentSymbol extends vscode.DocumentSymbol {
    constructor(
        name: string,
        detail: string,
        kind: vscode.SymbolKind,
        range: vscode.Range,
        selectionRange: vscode.Range,
        public ignoreInWorkspaceSymbols = false,
    ) {
        super(name, detail, kind, range, selectionRange);
    }

    declare children: DocumentSymbol[];

    static fromNode(node: SyntaxNode) {
        const nameNode = node.children.find(child => child.type === 'identifier');
        const symbol = new DocumentSymbol(
            makeSymbolName(node, nameNode),
            isForwardDeclaration(node) ? '(declaration)' : '',
            convertSymbolKind(node.type),
            toVscRange(node),
            toVscRange(nameNode ?? node),
            ignoreInWorkspaceSymbols(node),
        );
        return symbol;
    }
}

function ignoreInWorkspaceSymbols(node: SyntaxNode) {
    return node.type in {
        [NodeTypes.LocalDecl]: true,
        [NodeTypes.FuncParam]: true,
    };
}

function fromDocumentSymbol(uri: vscode.Uri, symbol: DocumentSymbol, parent?: DocumentSymbol): vscode.SymbolInformation[] {
    if (symbol.ignoreInWorkspaceSymbols) {
        return [];
    }
    return [
        new vscode.SymbolInformation(
            symbol.name + (symbol.detail ? ` ${symbol.detail}` : ''),
            symbol.kind,
            parent?.name ?? '',
            new vscode.Location(uri, symbol.range),
        ),
        ...symbol.children.flatMap(child =>
            fromDocumentSymbol(uri, child, symbol),
        ),
    ];
}

function isForwardDeclaration(node: SyntaxNode) {
    if (node.type === NodeTypes.FuncDecl || node.type === NodeTypes.StructDecl) {
        return !node.childForFieldName('body');
    } else if (node.type === NodeTypes.GlobalDecl) {
        return !node.children.find(n => n.type === 'extern');
    } else {
        return false;
    }
}

function makeSymbolName(node: SyntaxNode, nameNode: SyntaxNode | undefined) {
    if (!nameNode) {
        return '{unknown}';
    }
    let name = nameNode.text;
    if (node.type == NodeTypes.FuncDecl) {
        name += '()';
    }
    return name;
}
