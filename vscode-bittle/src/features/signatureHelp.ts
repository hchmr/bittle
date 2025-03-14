import * as vscode from 'vscode';
import { FuncParamSym, FuncSym, prettyFuncSym, prettyRecordWithFields, RecordFieldSym, RecordSym, SymKind } from '../semantics/sym';
import { ParsingService } from '../services/parsingService';
import { SemanticsService } from '../services/semanticsService';
import { Point, SyntaxNode } from '../syntax';
import { ExprNodeTypes, NodeTypes } from '../syntax/nodeTypes';
import { comparing, Nullish } from '../utils';
import { interceptExceptions } from '../utils/interceptExceptions';
import { countPrecedingCommas, nodeEndsAt, nodeStartsAt } from '../utils/nodeSearch';
import { stream } from '../utils/stream';
import { fromVscPosition } from '../utils/vscode';

export class SignatureHelpProvider implements vscode.SignatureHelpProvider {
    constructor(
        private parsingService: ParsingService,
        private semanticsService: SemanticsService,
    ) { }

    @interceptExceptions
    provideSignatureHelp(
        document: vscode.TextDocument,
        vscPosition: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.SignatureHelpContext,
    ): vscode.ProviderResult<vscode.SignatureHelp> {
        const filePath = document.fileName;

        const tree = this.parsingService.parse(filePath);
        const position = fromVscPosition(vscPosition);
        const node = tree.rootNode.descendantForPosition(position);
        if (!node) {
            return;
        }

        let listNode: SyntaxNode | Nullish = node.closest([NodeTypes.CallArgList, NodeTypes.FieldInitList]);
        while (
            listNode
            && (nodeStartsAt(position, listNode) || nodeEndsAt(position, listNode))
        ) {
            listNode = listNode.parent?.closest([NodeTypes.CallArgList, NodeTypes.FieldInitList]);
        }
        if (!listNode) {
            return;
        }

        if (listNode.type === NodeTypes.CallArgList) {
            return this.provideSignatureHelpForCallArgList(filePath, position, listNode);
        } else {
            return this.provideSignatureHelpForFieldInitList(filePath, position, listNode);
        }
    }

    private provideSignatureHelpForCallArgList(
        filePath: string,
        position: Point,
        argListNode: SyntaxNode,
    ) {
        const callNode = argListNode.closest(NodeTypes.CallExpr);
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

        const calleeSym = this.semanticsService.resolveUnambiguousSymbol(filePath, calleeNameNode);
        if (!calleeSym || calleeSym.kind !== SymKind.Func) {
            return;
        }

        const argIndex = getArgIndex(calleeSym, argListNode, position);

        return createSignatureHelpForFunc(
            calleeSym,
            calleeSym.params,
            calleeSym.isVariadic,
            argIndex,
        );
    }

    private provideSignatureHelpForFieldInitList(
        filePath: string,
        position: Point,
        fieldInitListNode: SyntaxNode,
    ) {
        const recordNode = fieldInitListNode.closest(NodeTypes.RecordExpr);
        if (!recordNode) {
            return;
        }

        const recordNameNode = recordNode.childForFieldName('name');
        if (!recordNameNode) {
            return;
        }

        const recordSym = this.semanticsService.resolveUnambiguousSymbol(filePath, recordNameNode);
        if (!recordSym || recordSym.kind !== SymKind.Record) {
            return;
        }

        const fieldListNodes = recordNode.childForFieldName('fields')!.children;
        const fieldInitNodes = fieldListNodes.filter((node) => node.type === NodeTypes.FieldInit);
        const fieldIndex = countPrecedingCommas(fieldListNodes, position);
        const fieldInitNode = fieldInitNodes[fieldIndex];
        const fieldName = (fieldInitNode ? getFieldName(fieldInitNode) : undefined) ?? nextUninitializedFieldName(recordSym, fieldListNodes);
        if (!fieldName) {
            return;
        }

        return createSignatureHelpForRecord(
            recordSym,
            recordSym.fields,
            fieldName,
        );

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

        function nextUninitializedFieldName(recordSym: RecordSym, fieldInitNodes: SyntaxNode[]): string | undefined {
            const usedNames = stream(fieldInitNodes)
                .filterMap(getFieldName)
                .toSet();
            if (recordSym.recordKind === 'union' && usedNames.size > 0) {
                return undefined;
            }
            return stream(recordSym.fields)
                .filter(field => !usedNames.has(field.name))
                .sort(comparing(field => field.defaultValue !== undefined))
                .map(field => field.name)
                .first();
        }
    }
}

function createSignatureHelpForFunc(
    sym: FuncSym,
    params: FuncParamSym[],
    isVariadic: boolean,
    paramIndex: number,
): vscode.SignatureHelp {
    const signature = new vscode.SignatureInformation(prettyFuncSym(sym));
    signature.parameters = params.map((param) => {
        return new vscode.ParameterInformation(param.name);
    });
    if (isVariadic) {
        signature.parameters.push(new vscode.ParameterInformation('...', ''));
    }

    const signatureHelp = new vscode.SignatureHelp();
    signatureHelp.signatures = [signature];
    signatureHelp.activeSignature = 0; // Easy, we don't have overloads
    signatureHelp.activeParameter = paramIndex;
    if (isVariadic) {
        signatureHelp.activeParameter = Math.min(paramIndex, params.length);
    }

    return signatureHelp;
}

function createSignatureHelpForRecord(
    sym: RecordSym,
    fields: RecordFieldSym[],
    fieldIndex: string,
): vscode.SignatureHelp {
    const signature = new vscode.SignatureInformation(prettyRecordWithFields(sym));
    signature.parameters = fields.map((param) => new vscode.ParameterInformation(param.name));

    const signatureHelp = new vscode.SignatureHelp();
    signatureHelp.signatures = [signature];
    signatureHelp.activeSignature = 0;
    signatureHelp.activeParameter = fields.findIndex((param) => param.name === fieldIndex);

    return signatureHelp;
}

function getArgIndex(sym: FuncSym, argListNode: SyntaxNode, position: Point): number {
    const { left, right } = argListNode.closestChildrenForPosition(position);
    const argNode = [left, right].find(node => node?.type === NodeTypes.CallArg);
    const anyNode = left ?? right;
    if (argNode && isNamedCallArg(argNode)) {
        return getArgIndexForNamedArg(sym, argNode);
    } else if (anyNode) {
        return getArgIndexForPositionalArg(argListNode, (left || right)!);
    } else {
        return -1;
    }
}

function getArgIndexForNamedArg(sym: FuncSym, argNode: SyntaxNode): number {
    const labelNode = argNode.childForFieldName('label')!;
    const label = labelNode.text;
    return sym.params.findIndex((param) => param.name === label);
}

function getArgIndexForPositionalArg(argListNode: SyntaxNode, node: SyntaxNode): number {
    const firstNamedArg = argListNode.children.find(isNamedCallArg);
    if (firstNamedArg && firstNamedArg.startIndex < node.startIndex) {
        return -1;
    }

    return countPrecedingCommas(argListNode.children, node.endPosition);
}

function isNamedCallArg(node: SyntaxNode): boolean {
    return node.type === NodeTypes.CallArg && !!node.childForFieldName('label');
}
