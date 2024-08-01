import { Point, SyntaxNode } from '../syntax';
import * as vscode from 'vscode';
import { FuncSym, prettySym, SymKind } from '../semantics/sym';
import { ElaborationService } from '../services/elaborationService';
import { ParsingService } from '../services/parsingService';
import { fromVscPosition, pointLe } from '../utils';
import { getNodesAtPosition } from '../utils/nodeSearch';

export class SignatureHelpProvider implements vscode.SignatureHelpProvider {
    constructor(
        private parsingService: ParsingService,
        private elaborationService: ElaborationService,
    ) { }

    provideSignatureHelp(
        document: vscode.TextDocument,
        vscPosition: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.SignatureHelpContext,
    ): vscode.ProviderResult<vscode.SignatureHelp> {
        const filePath = document.fileName;

        const tree = this.parsingService.parse(filePath);
        const position = fromVscPosition(vscPosition);
        const node = getNodesAtPosition(tree, position)[0];
        if (!node) {
            return;
        }

        const callNode = node.closest('call_expr');
        if (!callNode) {
            return;
        }
        const calleeNode = callNode.childForFieldName('callee');
        if (!calleeNode) {
            return;
        }
        const nameNode = calleeNode.type === 'name_expr' && calleeNode.firstChild;
        if (!nameNode) {
            return;
        }
        const argsNodes = callNode.childrenForFieldName('args');
        const argIndex = countPrecedingCommas(argsNodes, position);

        const funcSym = this.elaborationService.resolveSymbol(filePath, nameNode);
        if (!funcSym || funcSym.kind !== SymKind.Func) {
            return;
        }

        return createSignatureHelp(funcSym, argIndex);
    }
}

function createSignatureHelp(
    funcSym: FuncSym,
    paramIndex: number,
): vscode.SignatureHelp {
    const signature = new vscode.SignatureInformation(prettySym(funcSym));
    signature.parameters = funcSym.params.map((param) => {
        return new vscode.ParameterInformation(param.name, prettySym(param));
    });
    if (funcSym.isVariadic) {
        signature.parameters.push(new vscode.ParameterInformation('...', ''));
    }

    const signatureHelp = new vscode.SignatureHelp();
    signatureHelp.signatures = [signature];
    signatureHelp.activeSignature = 0; // Easy, we don't have overloads
    signatureHelp.activeParameter = paramIndex;
    if (funcSym.isVariadic) {
        signatureHelp.activeParameter = Math.min(paramIndex, funcSym.params.length);
    }

    return signatureHelp;
}

function countPrecedingCommas(argsNodes: SyntaxNode[], treePosition: Point) {
    return argsNodes
        .filter((argNode) =>
            argNode.type == ',' && pointLe(argNode.endPosition, treePosition),
        )
        .length;
}
