import * as vscode from "vscode";
import { prettySym, Sym, SymKind } from "../semantics/sym";
import { ElaborationService } from "../services/elaborationService";
import { ParsingService } from "../services/parsingService";
import { ExprNodeType } from "../syntax/nodeTypes";
import { getNodesAtPosition } from "../utils/nodeSearch";
import { fromVscPosition } from "../utils";
import { SyntaxNode } from '../syntax';

export class CompletionProvider implements vscode.CompletionItemProvider {
    constructor(
        private parsingService: ParsingService,
        private elaborationService: ElaborationService,
    ) { }

    provideCompletionItems(
        document: vscode.TextDocument,
        vscPosition: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext,
    ): vscode.CompletionItem[] | undefined {
        const filePath = document.fileName;

        const tree = this.parsingService.parse(filePath);
        const position = fromVscPosition(vscPosition);
        const node = getNodesAtPosition(tree, position)[0];
        if (!node) {
            return;
        }

        return this.autoCompleteFieldAccess(filePath, node)
            || this.autoCompleteIdentifier(filePath, node)
            || this.autoCompleteDefault(filePath, node);
    }

    private autoCompleteFieldAccess(
        filePath: string,
        node: SyntaxNode,
    ): vscode.CompletionItem[] | undefined {
        if (node.parent?.type !== ExprNodeType.FieldExpr) {
            return;
        }

        const leftNode = node.parent.childForFieldName("left");
        if (!leftNode || node === leftNode) {
            return;
        }

        // Search text
        let searchText: string;
        if (node.type === "identifier") {
            searchText = node.text;
        } else if (node.type === ".") {
            searchText = "";
        } else {
            return;
        }

        // Infer type
        let structType = this.elaborationService.inferType(filePath, leftNode);
        if (structType.kind === "pointer") {
            structType = structType.elementType;
        }
        if (structType.kind !== "struct") {
            return;
        }

        // Get fields
        const structSym = this.elaborationService.getSymbol(filePath, structType.name);
        if (structSym?.kind !== SymKind.Struct) {
            return;
        }
        const fields = structSym?.fields;

        // Filter fields
        return fields
            ?.filter((field) => field.name.startsWith(searchText))
            .map(toCompletionItem);
    }

    private autoCompleteIdentifier(
        filePath: string,
        node: any
    ): vscode.CompletionItem[] | undefined {
        const symbols = this.elaborationService.getSymbolsAtNode(filePath, node);
        return symbols
            .filter((sym) => sym.name.startsWith(node.text))
            .map(toCompletionItem)
            .toArray();
    }

    private autoCompleteDefault(
        filePath: string,
        node: any
    ): vscode.CompletionItem[] | undefined {
        const symbols = this.elaborationService.getSymbolsAtNode(filePath, node);
        return symbols?.map(toCompletionItem).toArray();
    }
}

function toCompletionItem(sym: Sym): vscode.CompletionItem {
    const item = new vscode.CompletionItem(sym.name, toCompletionType(sym.kind));
    item.detail = prettySym(sym);
    return item;
}

function toCompletionType(kind: SymKind): vscode.CompletionItemKind {
    switch (kind) {
        case SymKind.Func:
            return vscode.CompletionItemKind.Function;
        case SymKind.Struct:
            return vscode.CompletionItemKind.Struct;
        case SymKind.StructField:
            return vscode.CompletionItemKind.Field;
        case SymKind.Global:
            return vscode.CompletionItemKind.Variable;
        case SymKind.Local:
            return vscode.CompletionItemKind.Variable;
        case SymKind.FuncParam:
            return vscode.CompletionItemKind.Variable;
        case SymKind.Const:
            return vscode.CompletionItemKind.Constant;
        default:
            const unreachable: never = kind;
            return unreachable;
    }
}
