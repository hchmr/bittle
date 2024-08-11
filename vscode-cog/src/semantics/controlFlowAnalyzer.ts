import { SyntaxNode, Tree } from '../syntax';
import { ErrorNodeType, isStmtNode, isTopLevelNode, NodeTypes, StmtNodeType, StmtNodeTypes, TopLevelNodeType, TopLevelNodeTypes } from '../syntax/nodeTypes';
import { Nullish } from '../utils';
import { stream } from '../utils/stream';
import { ElaborationError, ElaboratorResult } from './elaborator';
import { mkVoidType, Type, TypeKind } from './type';

export function analyzeControlFlow(path: string, tree: Tree, elaboratorResult: ElaboratorResult) {
    return new ControlFlowAnalyzer(path, elaboratorResult).analyze(tree);
}

type ExecutionState = {
    didReturn: boolean;
    didExitLoop: boolean;
};

class ControlFlowAnalyzer {
    private nodeTypeMap: WeakMap<SyntaxNode, Type>;
    private errors: ElaborationError[] = [];
    private currentLoop: SyntaxNode | null = null;

    constructor(
        private path: string,
        elaboratorResult: ElaboratorResult,
    ) {
        this.nodeTypeMap = elaboratorResult.nodeTypeMap;
    }

    analyze(tree: Tree) {
        for (const node of stream(tree.rootNode.children).filter(node => isTopLevelNode(node))) {
            this.analyzeTopLevelDecl(node);
        }
        return this.errors;
    }

    private analyzeTopLevelDecl(node: SyntaxNode) {
        const nodeType = node.type as TopLevelNodeType | ErrorNodeType;
        switch (nodeType) {
            case TopLevelNodeTypes.Func:
                return this.analyzeFunc(node);
        }
    }

    private analyzeFunc(node: SyntaxNode) {
        const bodyNode = node.childForFieldName('body');
        const returnTypeNode = node.childForFieldName('return_type');
        if (!bodyNode) {
            return;
        }

        const returnType: Type = returnTypeNode ? this.nodeTypeMap.get(returnTypeNode)! : mkVoidType();

        const initialState: ExecutionState = {
            didReturn: false,
            didExitLoop: false,
        };

        const state = this.analyzeBlockStmt(bodyNode, initialState);

        if (!state.didReturn && isNonVoidType(returnType)) {
            this.reportError(returnTypeNode!, 'Function lacks ending return statement');
        }
    }

    private analyzeStmt(node: SyntaxNode | Nullish, state: ExecutionState): ExecutionState {
        if (!node) {
            return state;
        }
        const nodeType = node.type as StmtNodeType | ErrorNodeType;
        switch (nodeType) {
            case StmtNodeTypes.BlockStmt:
                return this.analyzeBlockStmt(node, state);
            case StmtNodeTypes.LocalDecl:
                return this.analyzeLocalDecl(node, state);
            case StmtNodeTypes.IfStmt:
                return this.analyzeIfStmt(node, state);
            case StmtNodeTypes.WhileStmt:
                return this.analyzeWhileStmt(node, state);
            case StmtNodeTypes.ReturnStmt:
                return this.analyzeReturnStmt(node, state);
            case StmtNodeTypes.BreakStmt:
            case StmtNodeTypes.ContinueStmt:
                return this.analyzeJumpStmt(node, state);
            case StmtNodeTypes.ExprStmt:
                return this.analyzeExprStmt(node, state);
            case NodeTypes.Error:
                return state;
            default: {
                const unreachable: never = nodeType;
                throw new Error(`Unexpected node type: ${unreachable}`);
            }
        }
    }

    private analyzeBlockStmt(node: SyntaxNode, state: ExecutionState): ExecutionState {
        const unreachableStatements = [];
        for (const stmtNode of node.namedChildren.filter(n => isStmtNode(n))) {
            if (state.didReturn || state.didExitLoop) {
                unreachableStatements.push(stmtNode);
            } else {
                state = this.analyzeStmt(stmtNode, state);
            }
        }
        for (const stmt of unreachableStatements) {
            this.reportUnreachableCode(stmt);
        }
        return state;
    }

    private analyzeLocalDecl(node: SyntaxNode, state: ExecutionState): ExecutionState {
        return state;
    }

    private analyzeIfStmt(node: SyntaxNode, state: ExecutionState): ExecutionState {
        const condNode = node.childForFieldName('cond');
        const thenNode = node.childForFieldName('then');
        const elseNode = node.childForFieldName('else');

        if (isTriviallyTrue(condNode)) {
            elseNode && this.reportUnreachableCode(elseNode);
            return this.analyzeStmt(thenNode, state);
        } else if (isTriviallyFalse(condNode)) {
            thenNode && this.reportUnreachableCode(thenNode);
            return this.analyzeStmt(elseNode, state);
        } else {
            const thenState = this.analyzeStmt(thenNode, state);
            const elseState = this.analyzeStmt(elseNode, state);
            return {
                didReturn: thenState.didReturn && elseState.didReturn,
                didExitLoop: thenState.didExitLoop && elseState.didExitLoop,
            };
        }
    }

    private analyzeWhileStmt(node: SyntaxNode, state: ExecutionState): ExecutionState {
        const condNode = node.childForFieldName('cond');
        const bodyNode = node.childForFieldName('body');

        const outerLoop = this.currentLoop;
        this.currentLoop = node;
        if (isTriviallyFalse(condNode)) {
            bodyNode && this.reportUnreachableCode(bodyNode);
        } else if (isTriviallyTrue(condNode)) {
            state = this.analyzeStmt(bodyNode, state);
        } else {
            this.analyzeStmt(bodyNode, state);
        }
        this.currentLoop = outerLoop;
        return state;
    }

    private analyzeReturnStmt(node: SyntaxNode, state: ExecutionState): ExecutionState {
        return {
            ...state,
            didReturn: true,
        };
    }

    private analyzeJumpStmt(node: SyntaxNode, state: ExecutionState): ExecutionState {
        if (!this.currentLoop) {
            const keyword = node.type === StmtNodeTypes.BreakStmt ? 'Break' : 'Continue';
            this.reportError(node, `${keyword} statement outside of loop`);
        }
        return {
            ...state,
            didExitLoop: true,
        };
    }

    private analyzeExprStmt(node: SyntaxNode, state: ExecutionState): ExecutionState {
        return state;
    }

    //=========================================================================

    private reportUnreachableCode(node: SyntaxNode) {
        this.reportError(node, 'Unreachable code');
    }

    private reportError(node: SyntaxNode, message: string) {
        this.errors.push({
            location: { file: this.path, range: node },
            message,
        });
    }
}

function isTriviallyTrue(node: SyntaxNode | Nullish): boolean {
    return node?.type === NodeTypes.BoolLiteral && node.text === 'true';
}

function isTriviallyFalse(node: SyntaxNode | Nullish): boolean {
    return node?.type === NodeTypes.BoolLiteral && node.text === 'false';
}

function isNonVoidType(type: Type): boolean {
    return type.kind !== TypeKind.Err && type.kind !== TypeKind.Void;
}
