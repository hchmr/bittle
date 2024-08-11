import * as vscode from 'vscode';
import { FuncSym, prettySym, SymKind } from '../semantics/sym';
import { ElaborationService } from '../services/elaborationService';
import { ParsingService } from '../services/parsingService';
import { ExprNodeTypes } from '../syntax/nodeTypes';
import { fromVscPosition } from '../utils';
import { interceptExceptions } from '../utils/interceptExceptions';
import { countPrecedingCommas, getNodesAtPosition } from '../utils/nodeSearch';

export class SignatureHelpProvider implements vscode.SignatureHelpProvider {
    constructor(
        private parsingService: ParsingService,
        private elaborationService: ElaborationService,
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
        const node = getNodesAtPosition(tree, position)[0];
        if (!node) {
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
        const argIndex = countPrecedingCommas(argNodes, position);

        const calleeSym = this.elaborationService.resolveSymbol(filePath, calleeNameNode);
        if (!calleeSym || calleeSym.kind !== SymKind.Func) {
            return;
        }

        return createSignatureHelp(calleeSym, argIndex);
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
