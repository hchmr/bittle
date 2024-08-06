import * as vscode from 'vscode';
import { builtinTypes, builtinValues } from '../semantics/builtins';
import { prettySym, Sym, SymKind } from '../semantics/sym';
import { TypeKind } from '../semantics/type';
import { ElaborationService } from '../services/elaborationService';
import { ParsingService } from '../services/parsingService';
import { SyntaxNode } from '../syntax';
import { ExprNodeTypes } from '../syntax/nodeTypes';
import { keywords } from '../syntax/token';
import { fromVscPosition } from '../utils';
import { fuzzySearch } from '../utils/fuzzySearch';
import { getNodesAtPosition } from '../utils/nodeSearch';

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
            || this.autoCompleteDefault(filePath, node);
    }

    private autoCompleteFieldAccess(
        filePath: string,
        node: SyntaxNode,
    ): vscode.CompletionItem[] | undefined {
        if (node.parent?.type !== ExprNodeTypes.FieldExpr) {
            return;
        }

        const leftNode = node.parent.childForFieldName('left');
        if (!leftNode || node === leftNode) {
            return;
        }

        // Search text
        let searchText: string;
        if (node.type === 'identifier') {
            searchText = node.text;
        } else if (node.type === '.') {
            searchText = '';
        } else {
            return;
        }

        // Infer type
        let structType = this.elaborationService.inferType(filePath, leftNode);
        if (structType.kind === TypeKind.Ptr) {
            structType = structType.pointeeType;
        }
        if (structType.kind !== TypeKind.Struct) {
            return;
        }

        // Get fields
        const structSym = this.elaborationService.getSymbol(filePath, structType.name);
        if (structSym?.kind !== SymKind.Struct) {
            return;
        }
        const fields = structSym?.fields;
        if (!fields) {
            return;
        }

        // Filter fields
        const results = fuzzySearch(searchText, fields, { key: 'name' });
        if (results.length === 0) {
            return;
        }

        return results.map(toCompletionItem);
    }

    private autoCompleteDefault(
        filePath: string,
        node: SyntaxNode,
    ): vscode.CompletionItem[] | undefined {
        const candidates: Array<CompletionCandidate>
            = this.elaborationService.getSymbolsAtNode(filePath, node)
                .filter(sym => sym.origins.some(origin => origin.nameNode !== node))
                .concat(generateBuiltins())
                .toArray();

        let results: Array<CompletionCandidate>;
        if (node.type === 'identifier') {
            results = fuzzySearch(node.text, candidates, { key: 'name' });
        } else {
            results = candidates;
        }

        return results.map(toCompletionItem);
    }
}

type CompletionCandidate =
    | Sym
    | { kind: 'static'; name: string; completionKind: vscode.CompletionItemKind };

function* generateBuiltins(): Iterable<CompletionCandidate> {
    yield * builtinValues
        .map<CompletionCandidate>(name => ({ kind: 'static', name: name, completionKind: vscode.CompletionItemKind.Constant }));
    yield * builtinTypes
        .map<CompletionCandidate>(name => ({ kind: 'static', name: name, completionKind: vscode.CompletionItemKind.Struct }));
    yield * keywords
        .filter(name => !(<readonly string[]>builtinValues).includes(name))
        .map<CompletionCandidate>(name => ({ kind: 'static', name: name, completionKind: vscode.CompletionItemKind.Keyword }));
}

function toCompletionItem(candidate: CompletionCandidate): vscode.CompletionItem {
    if (candidate.kind === 'static') {
        const item = new vscode.CompletionItem(candidate.name, candidate.completionKind);
        item.detail = item.kind === vscode.CompletionItemKind.Keyword ? 'keyword' : 'builtin';
        return item;
    } else {
        const sym = candidate;
        const item = new vscode.CompletionItem(sym.name, toCompletionType(sym.kind));
        item.detail = prettySym(sym);
        return item;
    }
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
        default: {
            const unreachable: never = kind;
            return unreachable;
        }
    }
}
