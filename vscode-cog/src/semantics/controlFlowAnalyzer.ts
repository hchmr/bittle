import { SyntaxNode, Tree } from '../syntax';
import {
    ErrorNodeType,
    ExprNodeType,
    ExprNodeTypes,
    isExprNode,
    isStmtNode,
    isTopLevelNode,
    NodeTypes,
    StmtNodeType,
    StmtNodeTypes,
    TopLevelNodeType,
    TopLevelNodeTypes,
} from '../syntax/nodeTypes';
import { Nullish } from '../utils';
import { stream } from '../utils/stream';
import { ElaborationError, ElaboratorResult } from './elaborator';
import { mkVoidType, Type, TypeKind } from './type';

export function analyzeControlFlow(path: string, tree: Tree, elaboratorResult: ElaboratorResult) {
    return new ControlFlowAnalyzer(path, elaboratorResult).analyze(tree);
}

enum ExitLevel {
    None,
    Loop,
    Function,
    Program,
}

type ExecutionState = {
    exitLevel: ExitLevel;
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
            exitLevel: 0,
        };

        const state = this.analyzeBlockStmt(bodyNode, initialState);

        if (state.exitLevel < ExitLevel.Function && isNonVoidType(returnType)) {
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
            case StmtNodeTypes.ForStmt:
                return this.analyzeForStmt(node, state);
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
            if (state.exitLevel !== ExitLevel.None) {
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
        const valueNode = node.childForFieldName('value');
        if (valueNode) {
            state = this.analyzeExpr(valueNode, state);
        }
        return state;
    }

    private analyzeIfStmt(node: SyntaxNode, state: ExecutionState): ExecutionState {
        const condNode = node.childForFieldName('cond');
        const thenNode = node.childForFieldName('then');
        const elseNode = node.childForFieldName('else');

        state = this.analyzeExpr(condNode, state);
        if (isTriviallyTrue(condNode)) {
            elseNode && this.reportUnreachableCode(elseNode);
            return this.analyzeStmt(thenNode, state);
        } else if (isTriviallyFalse(condNode)) {
            thenNode && this.reportUnreachableCode(thenNode);
            return this.analyzeStmt(elseNode, state);
        } else {
            const thenState = this.analyzeStmt(thenNode, state);
            const elseState = this.analyzeStmt(elseNode, state);
            return executionStateUnion(thenState, elseState);
        }
    }

    private analyzeWhileStmt(node: SyntaxNode, state: ExecutionState): ExecutionState {
        const condNode = node.childForFieldName('cond');
        const bodyNode = node.childForFieldName('body');

        state = this.analyzeExpr(condNode, state);

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

    private analyzeForStmt(node: SyntaxNode, state: ExecutionState): ExecutionState {
        const initNode = node.childForFieldName('init');
        const condNode = node.childForFieldName('cond');
        const stepNode = node.childForFieldName('step');
        const bodyNode = node.childForFieldName('body');

        const outerLoop = this.currentLoop;
        this.currentLoop = node;

        state = this.analyzeStmt(initNode, state);
        this.analyzeExpr(condNode, state);
        this.analyzeStmt(bodyNode, state);
        this.analyzeExpr(stepNode, state);

        this.currentLoop = outerLoop;
        return state;
    }

    private analyzeReturnStmt(node: SyntaxNode, state: ExecutionState): ExecutionState {
        const valueNode = node.childForFieldName('value');
        if (valueNode) {
            state = this.analyzeExpr(valueNode, state);
        }
        return {
            exitLevel: ExitLevel.Function,
        };
    }

    private analyzeJumpStmt(node: SyntaxNode, state: ExecutionState): ExecutionState {
        if (!this.currentLoop) {
            const keyword = node.type === StmtNodeTypes.BreakStmt ? 'Break' : 'Continue';
            this.reportError(node, `${keyword} statement outside of loop`);
        }
        return {
            exitLevel: ExitLevel.Loop,
        };
    }

    private analyzeExprStmt(node: SyntaxNode, state: ExecutionState): ExecutionState {
        const exprNode = node.childForFieldName('expr');
        return this.analyzeExpr(exprNode, state);
    }

    analyzeExpr(node: SyntaxNode | Nullish, state: ExecutionState): ExecutionState {
        if (!node) {
            return state;
        }
        const nodeType = node.type as ExprNodeType | ErrorNodeType;
        switch (nodeType) {
            case ExprNodeTypes.GroupedExpr:
                return this.analyzeGroupedExpr(node, state);
            case ExprNodeTypes.NameExpr:
                return this.analyzeNameExpr(node, state);
            case ExprNodeTypes.SizeofExpr:
                return this.analyzeSizeofExpr(node, state);
            case ExprNodeTypes.LiteralExpr:
                return this.analyzeLiteralExpr(node, state);
            case ExprNodeTypes.BinaryExpr:
                return this.analyzeBinaryExpr(node, state);
            case ExprNodeTypes.TernaryExpr:
                return this.analyzeTernaryExpr(node, state);
            case ExprNodeTypes.UnaryExpr:
                return this.analyzeUnaryExpr(node, state);
            case ExprNodeTypes.CallExpr:
                return this.analyzeCallExpr(node, state);
            case ExprNodeTypes.IndexExpr:
                return this.analyzeIndexExpr(node, state);
            case ExprNodeTypes.FieldExpr:
                return this.analyzeFieldExpr(node, state);
            case ExprNodeTypes.CastExpr:
                return this.analyzeCastExpr(node, state);
            case NodeTypes.Error:
                return state;
            default: {
                const unreachable: never = nodeType;
                throw new Error(`Unexpected node type: ${unreachable}`);
            }
        }
    }

    private analyzeGroupedExpr(node: SyntaxNode, state: ExecutionState): ExecutionState {
        return this.analyzeExpr(node.childForFieldName('expr'), state);
    }

    private analyzeNameExpr(node: SyntaxNode, state: ExecutionState): ExecutionState {
        return state;
    }

    private analyzeSizeofExpr(node: SyntaxNode, state: ExecutionState): ExecutionState {
        return state;
    }

    private analyzeLiteralExpr(node: SyntaxNode, state: ExecutionState): ExecutionState {
        return state;
    }

    private analyzeBinaryExpr(node: SyntaxNode, state: ExecutionState): ExecutionState {
        const leftNode = node.childForFieldName('left');
        const rightNode = node.childForFieldName('right');
        state = this.analyzeExpr(leftNode, state);
        state = this.analyzeExpr(rightNode, state);
        return state;
    }

    private analyzeTernaryExpr(node: SyntaxNode, state: ExecutionState): ExecutionState {
        const condNode = node.childForFieldName('cond');
        const thenNode = node.childForFieldName('then');
        const elseNode = node.childForFieldName('else');

        state = this.analyzeExpr(node.childForFieldName('cond'), state);
        if (isTriviallyTrue(condNode)) {
            elseNode && this.reportUnreachableCode(elseNode);
            return this.analyzeExpr(thenNode, state);
        } else if (isTriviallyFalse(condNode)) {
            thenNode && this.reportUnreachableCode(thenNode);
            return this.analyzeExpr(elseNode, state);
        } else {
            const thenState = this.analyzeExpr(thenNode, state);
            const elseState = this.analyzeExpr(elseNode, state);
            return executionStateUnion(thenState, elseState);
        }
    }

    private analyzeUnaryExpr(node: SyntaxNode, state: ExecutionState): ExecutionState {
        const operandNode = node.childForFieldName('operand');
        return this.analyzeExpr(operandNode, state);
    }

    private analyzeCallExpr(node: SyntaxNode, state: ExecutionState): ExecutionState {
        const calleeNode = node.childForFieldName('callee');
        const argsNodes = node.childrenForFieldName('args');
        if (!argsNodes || !calleeNode) {
            return state;
        }
        state = this.analyzeExpr(calleeNode, state);
        for (const argNode of argsNodes.filter(x => isExprNode(x))) {
            state = this.analyzeExpr(argNode, state);
        }
        const returnType = this.nodeTypeMap.get(node)!;
        if (returnType.kind === TypeKind.Never) {
            return {
                exitLevel: ExitLevel.Function,
            };
        }
        return state;
    }

    private analyzeIndexExpr(node: SyntaxNode, state: ExecutionState): ExecutionState {
        const indexeeNode = node.childForFieldName('indexee');
        const indexNode = node.childForFieldName('index');
        state = this.analyzeExpr(indexeeNode, state);
        state = this.analyzeExpr(indexNode, state);
        return state;
    }

    private analyzeFieldExpr(node: SyntaxNode, state: ExecutionState): ExecutionState {
        const leftNode = node.childForFieldName('left');
        return this.analyzeExpr(leftNode, state);
    }

    private analyzeCastExpr(node: SyntaxNode, state: ExecutionState): ExecutionState {
        const exprNode = node.childForFieldName('expr');
        return this.analyzeExpr(exprNode, state);
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
    return isBoolLiteral('true', node);
}

function isTriviallyFalse(node: SyntaxNode | Nullish): boolean {
    return isBoolLiteral('false', node);
}

function isBoolLiteral(value: string, node: SyntaxNode | Nullish): boolean {
    return node?.type === NodeTypes.LiteralExpr
        && node.firstChild?.type === NodeTypes.BoolLiteral
        && node.firstChild.text === value;
}

function isNonVoidType(type: Type): boolean {
    return type.kind !== TypeKind.Err && type.kind !== TypeKind.Void;
}

function executionStateUnion(a: ExecutionState, b: ExecutionState): ExecutionState {
    return {
        exitLevel: Math.min(a.exitLevel, b.exitLevel),
    };
}
