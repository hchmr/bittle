import Parser from 'tree-sitter';
import * as vscode from 'vscode';
import { ParsingService } from '../parser';
import { toVscRange } from '../utils';

export class DocumentSymbolsProvider implements vscode.DocumentSymbolProvider {
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

    constructor(private parsingService: ParsingService) { }

    provideDocumentSymbols(document: vscode.TextDocument) {
        const tree = this.parsingService.parse(document.uri.fsPath);

        const rootSymbols: vscode.DocumentSymbol[] = [];

        const visit = (node: Parser.SyntaxNode, currentSymbol: vscode.DocumentSymbol | null) => {
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

    private generateDocumentSymbol(node: Parser.SyntaxNode) {
        const nameNode = node.children.find(child => child.type === 'identifier');
        const symbol = new vscode.DocumentSymbol(
            nameNode?.text ?? '',
            '',
            this.convertSymbolKind(node.type),
            toVscRange(node),
            toVscRange(nameNode ?? node)
        );
        return symbol;
    }

    private convertSymbolKind(type: string) {
        const symbolKindMapping: Record<string, vscode.SymbolKind> = this.symbolKindMapping;
        return symbolKindMapping[type] ?? null;
    }
}
