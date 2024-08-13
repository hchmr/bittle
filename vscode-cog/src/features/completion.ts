import assert from 'assert';
import * as vscode from 'vscode';
import { builtinTypes, builtinValues } from '../semantics/builtins';
import { FuncParamSym, isDefined, prettySym, StructFieldSym, Sym, SymKind } from '../semantics/sym';
import { TypeKind } from '../semantics/type';
import { ElaborationService } from '../services/elaborationService';
import { ParsingService } from '../services/parsingService';
import { SyntaxNode } from '../syntax';
import { ExprNodeTypes, isArgNode, TopLevelNodeTypes } from '../syntax/nodeTypes';
import { keywords } from '../syntax/token';
import { fromVscPosition, rangeContains, toVscRange } from '../utils';
import { fuzzySearch } from '../utils/fuzzySearch';
import { interceptExceptions } from '../utils/interceptExceptions';
import { countPrecedingCommas, getNodesAtPosition } from '../utils/nodeSearch';

export class CompletionProvider implements vscode.CompletionItemProvider {
    constructor(
        private parsingService: ParsingService,
        private elaborationService: ElaborationService,
    ) { }

    @interceptExceptions
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
            || this.autoCompleteArgumentLabel(filePath, node)
            || this.autoCompleteDefinition(filePath, node)
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
        const structSym = this.elaborationService.getSymbol(filePath, structType.sym.name);
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

    private autoCompleteArgumentLabel(
        filePath: string,
        node: SyntaxNode,
    ): vscode.CompletionItem[] | undefined {
        if (node.type !== 'identifier' && node.type !== ',' && node.type !== '(') {
            return;
        }

        const callNode = node.closest(ExprNodeTypes.CallExpr);
        if (!callNode) {
            return;
        }
        const calleeNode = callNode.childForFieldName('callee');
        if (!calleeNode) {
            return;
        }
        const calleeNameNode = calleeNode.type === ExprNodeTypes.NameExpr && calleeNode.firstChild;
        if (!calleeNameNode) {
            return;
        }
        const argNodes = callNode.childForFieldName('args')!.children;
        const argIndex = countPrecedingCommas(argNodes, node.endPosition);

        const argNode = argNodes.filter(isArgNode)[argIndex];
        const labelNode = argNode?.childForFieldName('label');
        if (labelNode && !rangeContains(labelNode, node)) {
            return; // Already has a label
        }

        const calleeSym = this.elaborationService.resolveSymbol(filePath, calleeNameNode);
        if (!calleeSym || (calleeSym.kind !== SymKind.Func && calleeSym.kind !== SymKind.Struct)) {
            return;
        }

        const labelSym
            = calleeSym.kind === SymKind.Func
                ? calleeSym.params[argIndex]
                : calleeSym.fields?.[argIndex];
        if (!labelSym) {
            return;
        }

        const labelCompletion = toLabelCompletionItem(labelSym, labelNode);

        const valueCompletions = this.autoCompleteDefault(filePath, node) ?? [];

        return [labelCompletion, ...valueCompletions];
    }

    private autoCompleteDefinition(
        filePath: string,
        nameNode: SyntaxNode,
    ): vscode.CompletionItem[] | undefined {
        if (nameNode.type !== 'identifier' || !nameNode.parent || !isCompletable(nameNode.parent.type)) {
            return;
        }

        return this.elaborationService
            .getSymbolsAtNode(filePath, nameNode)
            .filter(sym => !isDefined(sym) && !isCurrentDeclaration(sym, nameNode.parent!))
            .map(toDefinitionCompletionItem)
            .toArray();

        function isCompletable(nodeType: string): boolean {
            switch (nodeType) {
                case TopLevelNodeTypes.Func:
                case TopLevelNodeTypes.Global:
                case TopLevelNodeTypes.Struct:
                    return true;
                default:
                    return false;
            }
        }

        function isCurrentDeclaration(sym: Sym, nameNode: SyntaxNode): boolean {
            return sym.origins.length === 1
                && sym.origins.some(origin => rangeContains(origin.node, nameNode));
        }
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

function toLabelCompletionItem(labelSym: StructFieldSym | FuncParamSym, labelNode: SyntaxNode | null): vscode.CompletionItem {
    const insertText = `${labelSym.name}:`;
    const item = new vscode.CompletionItem(insertText, vscode.CompletionItemKind.Text);
    item.filterText = labelSym.name;
    item.detail = `label '${insertText}'`;
    if (labelNode) {
        item.range = toVscRange(
            labelNode.startPosition,
            labelNode.nextSibling!.endPosition,
        );
    }
    return item;
}

function toDefinitionCompletionItem(sym: Sym): vscode.CompletionItem {
    const item = toCompletionItem(sym);
    let insertText;
    if (sym.kind === SymKind.Func) {
        insertText = (prettySym(sym) + ' {\n\t$1\n}').replace(/^func /, '');
    } else if (sym.kind === SymKind.Struct) {
        insertText = (prettySym(sym) + ' {\n\t$1\n}').replace(/^struct /, '');
    } else if (sym.kind === SymKind.Global) {
        insertText = (prettySym(sym) + ';').replace(/^extern var /, '');
    } else {
        assert(false, `Unexpected symbol kind: ${sym.kind}`);
    }
    item.insertText = new vscode.SnippetString(insertText);
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
        default: {
            const unreachable: never = kind;
            return unreachable;
        }
    }
}
