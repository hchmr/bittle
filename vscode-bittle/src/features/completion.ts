import assert from 'assert';
import * as vscode from 'vscode';
import { builtinTypes, builtinValues } from '../semantics/builtins';
import { FuncParamSym, isDefined, prettySym, RecordFieldSym, RecordKind, Sym, SymKind } from '../semantics/sym';
import { TypeKind } from '../semantics/type';
import { ParsingService } from '../services/parsingService';
import { SemanticsService } from '../services/semanticsService';
import { rangeContains, rangeContainsPoint, SyntaxNode } from '../syntax';
import { ExprNodeTypes, isArgNode, NodeTypes, TopLevelNodeTypes } from '../syntax/nodeTypes';
import { keywords } from '../syntax/token';
import { unreachable } from '../utils';
import { fuzzySearch } from '../utils/fuzzySearch';
import { interceptExceptions } from '../utils/interceptExceptions';
import { countPrecedingCommas } from '../utils/nodeSearch';
import { stream } from '../utils/stream';
import { fromVscPosition, toVscRange } from '../utils/vscode';

export class CompletionProvider implements vscode.CompletionItemProvider {
    constructor(
        private parsingService: ParsingService,
        private semanticsService: SemanticsService,
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
        const closest = tree.rootNode.closestDescendantsForPosition(position);

        const node =
            closest.find(node => rangeContainsPoint(node, position))
            ?? closest[0];
        if (!node) {
            return;
        }

        return this.autoCompleteFieldAccess(filePath, node)
            ?? this.autoCompleteFieldInit(filePath, node)
            ?? this.autoCompleteArgumentLabel(filePath, node)
            ?? this.autoCompleteDefinition(filePath, node)
            ?? this.autoCompleteDefault(filePath, node);
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
        let recordType = this.semanticsService.inferType(filePath, leftNode);
        if (recordType.kind === TypeKind.Ptr) {
            recordType = recordType.pointeeType;
        }
        if (recordType.kind !== TypeKind.Record) {
            return;
        }

        // Get fields
        const recordSym = this.semanticsService.getSymbol(filePath, recordType.sym.qualifiedName);
        if (recordSym?.kind !== SymKind.Record) {
            return;
        }
        if (!recordSym.isDefined) {
            return;
        }

        // Filter fields
        const results = fuzzySearch(searchText, recordSym.fields, { key: 'name' });
        if (results.length === 0) {
            return;
        }

        return results.map(toCompletionItem);
    }

    private autoCompleteFieldInit(
        filePath: string,
        node: SyntaxNode,
    ): vscode.CompletionItem[] | undefined {
        let searchText: string;
        if (node.type === 'identifier') {
            if (node.parent?.type !== NodeTypes.FieldInit) {
                return;
            }
            searchText = node.text;
            node = node.parent;
        } else if (node.type === ',' || node.type === '{') {
            searchText = '';
        } else {
            return;
        }
        if (node.parent?.type !== NodeTypes.FieldInitList) {
            return;
        }
        const recordExprNode = node.parent.closest(NodeTypes.RecordExpr);
        if (!recordExprNode) {
            return;
        }
        const recordNameNode = recordExprNode.childForFieldName('name');
        if (!recordNameNode) {
            return;
        }
        const recordSym = this.semanticsService.resolveUnambiguousSymbol(filePath, recordNameNode);
        if (!recordSym || recordSym.kind !== SymKind.Record) {
            return;
        }


        const usedNames = stream(recordExprNode.childForFieldName('fields')!.children)
                .filter(x => x.type === NodeTypes.FieldInit)
                .filterMap(getFieldName)
                .filter(x => x !== searchText)
                .toSet();

        let candidates: RecordFieldSym[];
        if (recordSym.recordKind === RecordKind.Struct) {
            candidates = recordSym.fields.filter(f => !usedNames.has(f.name));
        } else {
            candidates = usedNames.size === 0 ? recordSym.fields : [];
        }

        return fuzzySearch(searchText, candidates, { key: 'name' })
            .map(toCompletionItem);

        function getFieldName(fieldInitNode: SyntaxNode): string | undefined {
            const nameNode = fieldInitNode.childForFieldName('name');
            if (nameNode) {
                return nameNode.text;
            }

            const valueNode = fieldInitNode.childForFieldName('value');
            if (valueNode && valueNode.type === ExprNodeTypes.NameExpr) {
                return valueNode.text;
            }

            return undefined;
        }
    }

    private autoCompleteArgumentLabel(
        filePath: string,
        node: SyntaxNode,
    ): vscode.CompletionItem[] | undefined {
        if (node.type !== 'identifier' && node.type !== ',' && node.type !== '(') {
            return;
        }

        const callNode = node.closest(NodeTypes.CallArgList)?.closest(NodeTypes.CallExpr);
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

        const potentialArgNode = argNodes.filter(n => n.type === '(' || n.type === ',')[argIndex]?.nextSibling;
        const labelNode =
            potentialArgNode && isArgNode(potentialArgNode)
                ? potentialArgNode.childForFieldName('label')
                : null;
        if (labelNode && !rangeContains(labelNode, node)) {
            return; // Already has a label
        }

        const calleeSym = this.semanticsService.resolveUnambiguousSymbol(filePath, calleeNameNode);
        if (!calleeSym || calleeSym.kind !== SymKind.Func) {
            return;
        }

        const labelSym = calleeSym.params[argIndex];
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

        return this.semanticsService
            .getSymbolsAtNode(filePath, nameNode)
            .filter(sym => !isDefined(sym) && !isCurrentDeclaration(sym, nameNode.parent!))
            .map(toDefinitionCompletionItem)
            .toArray();

        function isCompletable(nodeType: string): boolean {
            switch (nodeType) {
                case TopLevelNodeTypes.Func:
                case TopLevelNodeTypes.Global:
                case TopLevelNodeTypes.Record:
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
        const candidates: CompletionCandidate[] =
            this.semanticsService.getSymbolsAtNode(filePath, node)
                .filter(sym => sym.origins.some(origin => origin.nameNode !== node))
                .concat(generateBuiltins())
                .toArray();

        let results: CompletionCandidate[];
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
        .filter(name => !(builtinValues as readonly string[]).includes(name))
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

function toLabelCompletionItem(labelSym: FuncParamSym, labelNode: SyntaxNode | null): vscode.CompletionItem {
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
    } else if (sym.kind === SymKind.Record) {
        insertText = (prettySym(sym) + ' {\n\t$1\n}').replace(/^(struct|union) /, '');
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
        case SymKind.Enum:
            return vscode.CompletionItemKind.Enum;
        case SymKind.Record:
            return vscode.CompletionItemKind.Struct;
        case SymKind.RecordField:
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
            unreachable(kind);
        }
    }
}
