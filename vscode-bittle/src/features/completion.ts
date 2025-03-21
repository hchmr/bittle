import assert from 'assert';
import path from 'path';
import * as vscode from 'vscode';
import { builtinTypes, builtinValues } from '../semantics/builtins';
import { FuncParamSym, prettySym, RecordFieldSym, RecordKind, Sym, SymKind } from '../semantics/sym';
import { TypeKind } from '../semantics/type';
import { ModuleListService } from '../services/moduleListService';
import { ParsingService } from '../services/parsingService';
import { SemanticsService } from '../services/semanticsService';
import { ClosestNodes, pointEq, rangeContains, SyntaxNode } from '../syntax';
import { ExprNodeTypes, isArgNode, NodeTypes, TopLevelNodeTypes } from '../syntax/nodeTypes';
import { keywords } from '../syntax/token';
import { unreachable } from '../utils';
import { fuzzySearch } from '../utils/fuzzySearch';
import { interceptExceptions } from '../utils/interceptExceptions';
import { parseString } from '../utils/literalParsing';
import { countPrecedingCommas, countPrecedingNamedArgs } from '../utils/nodeSearch';
import { stream } from '../utils/stream';
import { fromVscPosition, toVscRange } from '../utils/vscode';

export class CompletionProvider implements vscode.CompletionItemProvider {
    constructor(
        private parsingService: ParsingService,
        private semanticsService: SemanticsService,
        private moduleListService: ModuleListService,
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

        if (!closest.left && !closest.right) {
            return;
        }

        return this.autoCompleteImport(filePath, closest)
            ?? this.autoCompleteFieldAccess(filePath, closest)
            ?? this.autoCompleteFieldInit(filePath, closest)
            ?? this.autoCompleteArgumentLabel(filePath, closest)
            ?? this.autoCompleteDefinition(filePath, closest)
            ?? this.autoCompleteDefault(filePath, closest);
    }

    private autoCompleteImport(
        filePath: string,
        closest: ClosestNodes,
    ): vscode.CompletionItem[] | undefined {
        const node = closest.left;
        if (!node || node.type !== 'string_literal' || node.parent?.type !== TopLevelNodeTypes.Import) {
            return;
        }

        let stringLiteral = firstLineOf(node.text);
        if (!/.["]$/.test(stringLiteral)) {
            stringLiteral += '"';
        }

        const searchText = parseString(stringLiteral) ?? '';
        const hasExtension = path.basename(searchText).includes('.');

        const rows = this.moduleListService.getModuleList()
            .map(modulePath => ({ path: path.relative(path.dirname(filePath), modulePath) }));

        return fuzzySearch(searchText, rows, { key: 'path' })
            .map(row => toModuleCompletionItem(node, row.path, hasExtension));
    }

    private autoCompleteFieldAccess(
        filePath: string,
        closest: ClosestNodes,
    ): vscode.CompletionItem[] | undefined {
        const node = closest.left;
        if (node?.parent?.type !== ExprNodeTypes.FieldExpr) {
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
        closest: ClosestNodes,
    ): vscode.CompletionItem[] | undefined {
        let node = closest.left;
        if (!node) {
            return;
        }
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
        closest: ClosestNodes,
    ): vscode.CompletionItem[] | undefined {
        const node = closest.left;
        if (!node || node.type !== '(' && node.type !== ',' && node.type !== 'identifier') {
            return;
        }

        const callNode = node.closest(NodeTypes.CallExpr);
        if (!callNode) {
            return;
        }

        const argListNode = callNode.childForFieldName('args');
        if (!argListNode) {
            return;
        }

        const argListChildNode = argListNode.children.find(child => pointEq(child.startPosition, node.startPosition));
        if (!argListChildNode) {
            return;
        }

        const labelNode = argListChildNode.childForFieldName('label');

        const calleeNode = callNode.childForFieldName('callee');
        if (!calleeNode) {
            return;
        }

        const calleNameNode = calleeNode.type === ExprNodeTypes.NameExpr ? calleeNode.firstChild! : undefined;
        if (!calleNameNode) {
            return;
        }

        const calleeSym = this.semanticsService.resolveUnambiguousSymbol(filePath, calleNameNode);
        if (!calleeSym || calleeSym.kind !== SymKind.Func) {
            return;
        }

        const nPrecedingCommas = countPrecedingCommas(argListNode.children, node.endPosition);
        const nPrecedingPositionalArgs = nPrecedingCommas - countPrecedingNamedArgs(argListNode.children, node.endPosition);

        let searchText = '';
        if (node.type === 'identifier') {
            searchText = node.text;
        }

        const usedPositionalArgNames = stream(calleeSym.params)
            .filter((_, i) => i < nPrecedingPositionalArgs)
            .map(p => p.name);

        const usedNamedArgNames = stream(argListNode.children)
            .filter(isArgNode)
            .filter(x => x !== argListChildNode)
            .filterMap(argNode => argNode.childForFieldName('label')?.text);

        const usedNames = new Set(usedPositionalArgNames.concat(usedNamedArgNames));

        const unusedParams = calleeSym.params.filter(p => !usedNames.has(p.name));

        const results = fuzzySearch(searchText, unusedParams, { key: 'name' });

        const labelCompletions = results.map(p => toLabelCompletionItem(p, labelNode));

        const valueCompletions = this.autoCompleteDefault(filePath, closest) ?? [];

        return [...labelCompletions, ...valueCompletions];
    }

    private autoCompleteDefinition(
        filePath: string,
        closest: ClosestNodes,
    ): vscode.CompletionItem[] | undefined {
        const nameNode = closest.left ?? closest.right;
        if (nameNode.type !== 'identifier' || !nameNode.parent || !isCompletable(nameNode.parent.type)) {
            return;
        }

        return this.semanticsService
            .getSymbolsAtNode(filePath, nameNode)
            .filter(sym => !sym.isDefined && !isCurrentDeclaration(sym, nameNode.parent!))
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
        closest: ClosestNodes,
    ): vscode.CompletionItem[] | undefined {
        const { left, right } = closest;
        const nameNode = [left, right].find(node => node?.type === 'identifier');
        const node = nameNode ?? left ?? right;

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

function toModuleCompletionItem(stringNode: SyntaxNode, modulePath: string, includeExtension: boolean): vscode.CompletionItem {
    if (!includeExtension) {
        modulePath = modulePath.replace(/.btl$/, '');
    }

    const item = new vscode.CompletionItem(modulePath, vscode.CompletionItemKind.Module);
    item.insertText = `"${modulePath}";`;
    item.filterText = item.insertText;
    item.range = toVscRange(stringNode.startPosition, stringNode.parent!.endPosition);
    return item;
}

function firstLineOf(text: string): string {
    return text.slice(0, text.indexOf('\n'));
}
