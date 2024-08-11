import * as vscode from 'vscode';
import { ParsingService } from '../services/parsingService';
import { SyntaxNode } from '../syntax';
import { toVscRange } from '../utils';
import { fuzzySearch as searchFuzzy } from '../utils/fuzzySearch';
import { interceptExceptions } from '../utils/interceptExceptions';
import { ReactiveCache } from '../utils/reactiveCache';
import { stream } from '../utils/stream';
import { VirtualFileSystem } from '../vfs';

export class DocumentSymbolsProvider implements vscode.DocumentSymbolProvider, vscode.WorkspaceSymbolProvider {
    private readonly symbolKindMapping = {
        'enum_member': vscode.SymbolKind.Constant,
        'struct_decl': vscode.SymbolKind.Struct,
        'struct_member': vscode.SymbolKind.Field,
        'func_decl': vscode.SymbolKind.Function,
        'param_decl': vscode.SymbolKind.Variable,
        'global_decl': vscode.SymbolKind.Variable,
        'const_decl': vscode.SymbolKind.Constant,
        'local_decl': vscode.SymbolKind.Variable,
    };

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
        return searchFuzzy(query, unfilteredSymbols, { key: 'name' });
    }

    private getDocumentSymbols(path: string) {
        const tree = this.parsingService.parse(path);

        const rootSymbols: vscode.DocumentSymbol[] = [];

        const visit = (node: SyntaxNode, currentSymbol: vscode.DocumentSymbol | null) => {
            if (node.type in this.symbolKindMapping) {
                const symbol = this.generateDocumentSymbol(node);
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
                .flatMap(symbol => this.fromDocumentSymbol(vscode.Uri.file(file), symbol)),
        );
    }

    private generateDocumentSymbol(node: SyntaxNode) {
        const nameNode = node.children.find(child => child.type === 'identifier');
        const symbol = new vscode.DocumentSymbol(
            nameNode?.text || '{unknown}',
            '',
            this.convertSymbolKind(node.type),
            toVscRange(node),
            toVscRange(nameNode ?? node),
        );
        return symbol;
    }

    private fromDocumentSymbol(uri: vscode.Uri, symbol: vscode.DocumentSymbol, parent?: vscode.DocumentSymbol): vscode.SymbolInformation[] {
        return [
            new vscode.SymbolInformation(
                symbol.name,
                symbol.kind,
                parent?.name ?? '',
                new vscode.Location(uri, symbol.range),
            ),
            ...symbol.children.flatMap(child =>
                this.fromDocumentSymbol(uri, child, symbol),
            ),
        ];
    }

    private convertSymbolKind(type: string) {
        const symbolKindMapping: Record<string, vscode.SymbolKind> = this.symbolKindMapping;
        return symbolKindMapping[type] ?? null;
    }
}
