import * as vscode from 'vscode';
import { FuncParamSym, FuncSym, prettyCallableSym, StructFieldSym, StructSym, SymKind } from '../semantics/sym';
import { ParsingService } from '../services/parsingService';
import { SemanticsService } from '../services/semanticsService';
import { ExprNodeTypes } from '../syntax/nodeTypes';
import { fromVscPosition } from '../utils';
import { interceptExceptions } from '../utils/interceptExceptions';
import { countPrecedingCommas } from '../utils/nodeSearch';

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

        const calleeSym = this.semanticsService.resolveSymbol(filePath, calleeNameNode);
        if (!calleeSym || (calleeSym.kind !== SymKind.Func && calleeSym.kind !== SymKind.Struct)) {
            return;
        }

        return createSignatureHelp(
            calleeSym,
            calleeSym.kind === SymKind.Func ? calleeSym.params : calleeSym.fields,
            calleeSym.kind === SymKind.Func && calleeSym.isVariadic,
            argIndex,
        );
    }
}

function createSignatureHelp(
    sym: FuncSym | StructSym,
    params: (FuncParamSym | StructFieldSym)[],
    isVariadic: boolean,
    paramIndex: number,
): vscode.SignatureHelp {
    const signature = new vscode.SignatureInformation(prettyCallableSym(sym));
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
