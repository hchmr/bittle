import { PointRange, SyntaxNode } from '../syntax';
import { AstNode } from '../syntax/ast';
import { ArrayExprNode, BinaryExprNode, BlockStmtNode, BreakStmtNode, CallExprNode, CastExprNode, ConstDeclNode, ContinueStmtNode, DeclNode, ExprNode, ExprStmtNode, FieldExprNode, ForStmtNode, FuncDeclNode, GroupedExprNode, GroupedPatternNode, IfStmtNode, IndexExprNode, LiteralExprNode, LiteralPatternNode, LocalDeclNode, MatchStmtNode, NameExprNode, NamePatternNode, OrPatternNode, PatternNode, RangePatternNode, RecordExprNode, ReturnStmtNode, RootNode, SizeofExprNode, StmtNode, TernaryExprNode, UnaryExprNode, VarPatternNode, WhileStmtNode, WildcardPatternNode } from '../syntax/generated';
import { LiteralNodeTypes, NodeTypes } from '../syntax/nodeTypes';
import { Nullish, unreachable } from '../utils';
import { ElaborationDiag, ElaboratorResult, Severity } from './elaborator';
import { mkVoidType, Type, TypeKind } from './type';

export function analyzeControlFlow(path: string, rootNode: RootNode, elaboratorResult: ElaboratorResult) {
    return new ControlFlowAnalyzer(path, elaboratorResult).analyze(rootNode);
}

enum ExitLevel {
    None,
    Loop,
    Function,
}

type ExecutionState = {
    exitLevel: ExitLevel;
};

class ControlFlowAnalyzer {
    private nodeTypeMap: WeakMap<SyntaxNode, Type>;
    private diags: ElaborationDiag[] = [];
    private currentLoop: StmtNode | null = null;

    constructor(
        private path: string,
        elaboratorResult: ElaboratorResult,
    ) {
        this.nodeTypeMap = elaboratorResult.nodeTypeMap;
    }

    analyze(rootNode: RootNode) {
        for (const node of rootNode.declNodes) {
            this.analyzeTopLevelDecl(node);
        }
        return this.diags;
    }

    private analyzeTopLevelDecl(node: DeclNode) {
        if (node instanceof FuncDeclNode) {
            this.analyzeFunc(node);
        }
    }

    private analyzeFunc(node: FuncDeclNode) {
        const bodyNode = node.body;
        const returnTypeNode = node.returnType;
        if (!bodyNode) {
            return;
        }

        const returnType: Type = returnTypeNode ? this.getType(returnTypeNode)! : mkVoidType();

        const initialState: ExecutionState = {
            exitLevel: 0,
        };

        const state = this.analyzeBlockStmt(bodyNode, initialState);

        if (state.exitLevel < ExitLevel.Function && isNonVoidType(returnType)) {
            this.reportError(returnTypeNode!, 'Function lacks ending return statement');
        }
    }

    private analyzeStmt(node: StmtNode | Nullish, state: ExecutionState): ExecutionState {
        if (!node) {
            return state;
        }
        if (node instanceof BlockStmtNode) {
            return this.analyzeBlockStmt(node, state);
        } else if (node instanceof ConstDeclNode) {
            return state;
        } else if (node instanceof LocalDeclNode) {
            return this.analyzeLocalDecl(node, state);
        } else if (node instanceof IfStmtNode) {
            return this.analyzeIfStmt(node, state);
        } else if (node instanceof MatchStmtNode) {
            return this.analyzeMatchStmt(node, state);
        } else if (node instanceof WhileStmtNode) {
            return this.analyzeWhileStmt(node, state);
        } else if (node instanceof ForStmtNode) {
            return this.analyzeForStmt(node, state);
        } else if (node instanceof ReturnStmtNode) {
            return this.analyzeReturnStmt(node, state);
        } else if (node instanceof BreakStmtNode || node instanceof ContinueStmtNode) {
            return this.analyzeJumpStmt(node, state);
        } else if (node instanceof ExprStmtNode) {
            return this.analyzeExprStmt(node, state);
        } else {
            unreachable(node);
        }
    }

    private analyzeBlockStmt(node: BlockStmtNode, state: ExecutionState): ExecutionState {
        const unreachableStatements = [];
        for (const stmtNode of node.stmtNodes) {
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

    private analyzeLocalDecl(node: LocalDeclNode, state: ExecutionState): ExecutionState {
        const valueNode = node.value;
        if (valueNode) {
            state = this.analyzeExpr(valueNode, state);
        }
        return state;
    }

    private analyzeIfStmt(node: IfStmtNode, state: ExecutionState): ExecutionState {
        const condNode = node.cond;
        const thenNode = node.then;
        const elseNode = node.else;

        state = this.analyzeExpr(condNode, state);
        if (isTriviallyTrue(condNode)) {
            if (elseNode) {
                this.reportUnreachableCode(elseNode);
            }
            return this.analyzeStmt(thenNode, state);
        } else if (isTriviallyFalse(condNode)) {
            if (thenNode) {
                this.reportUnreachableCode(thenNode);
            }
            return this.analyzeStmt(elseNode, state);
        } else {
            const thenState = this.analyzeStmt(thenNode, state);
            const elseState = this.analyzeStmt(elseNode, state);
            return executionStateUnion(thenState, elseState);
        }
    }

    analyzeMatchStmt(node: MatchStmtNode, state: ExecutionState): ExecutionState {
        const valueNode = node.value;
        const bodyNode = node.body;

        state = this.analyzeExpr(valueNode, state);

        if (!bodyNode?.matchCaseNodes) {
            return state;
        }

        let combinedState: ExecutionState | undefined;
        let isExhausted = false;

        for (const matchCase of bodyNode.matchCaseNodes) {
            if (isExhausted) {
                this.reportUnreachableCode(matchCase);
                continue;
            }

            const matchState = this.analyzeStmt(matchCase.body, this.analyzeExpr(matchCase.guard, state));
            combinedState = combinedState ? executionStateUnion(combinedState, matchState) : matchState;

            isExhausted = (
                !matchCase.guard || isTriviallyTrue(matchCase.guard)
            ) && isMatchCaseDefinitelyExhaustive(matchCase.pattern);
        }

        return combinedState ?? state;

        function isMatchCaseDefinitelyExhaustive(node: PatternNode | Nullish): boolean {
            if (!node) {
                return false;
            } else if (node instanceof GroupedPatternNode || node instanceof VarPatternNode) {
                return isMatchCaseDefinitelyExhaustive(node.pattern);
            } else if (node instanceof LiteralPatternNode || node instanceof NamePatternNode) {
                return false;
            } else if (node instanceof WildcardPatternNode) {
                return true;
            } else if (node instanceof RangePatternNode) {
                return !node.lower && !node.upper;
            } else if (node instanceof OrPatternNode) {
                return node.patternNodes.some(isMatchCaseDefinitelyExhaustive);
            } else {
                unreachable(node);
            }
        }
    }

    private analyzeWhileStmt(node: WhileStmtNode, state: ExecutionState): ExecutionState {
        const condNode = node.cond;
        const bodyNode = node.body;

        state = this.analyzeExpr(condNode, state);

        const outerLoop = this.currentLoop;
        this.currentLoop = node;

        if (isTriviallyFalse(condNode)) {
            if (bodyNode) {
                this.reportUnreachableCode(bodyNode);
            }
        } else if (isTriviallyTrue(condNode)) {
            state = this.analyzeStmt(bodyNode, state);
        } else {
            this.analyzeStmt(bodyNode, state);
        }

        this.currentLoop = outerLoop;
        return state;
    }

    private analyzeForStmt(node: ForStmtNode, state: ExecutionState): ExecutionState {
        const initNode = node.init;
        const condNode = node.cond;
        const stepNode = node.step;
        const bodyNode = node.body;

        const outerLoop = this.currentLoop;
        this.currentLoop = node;

        state = this.analyzeStmt(initNode, state);
        this.analyzeExpr(condNode, state);
        this.analyzeStmt(bodyNode, state);
        this.analyzeExpr(stepNode, state);

        this.currentLoop = outerLoop;
        return state;
    }

    private analyzeReturnStmt(node: ReturnStmtNode, state: ExecutionState): ExecutionState {
        const valueNode = node.value;
        if (valueNode) {
            state = this.analyzeExpr(valueNode, state);
        }
        return {
            exitLevel: ExitLevel.Function,
        };
    }

    private analyzeJumpStmt(node: BreakStmtNode | ContinueStmtNode, state: ExecutionState): ExecutionState {
        if (!this.currentLoop) {
            const keyword = node instanceof BreakStmtNode ? 'Break' : 'Continue';
            this.reportError(node, `${keyword} statement outside of loop`);
        }
        return {
            exitLevel: ExitLevel.Loop,
        };
    }

    private analyzeExprStmt(node: ExprStmtNode, state: ExecutionState): ExecutionState {
        const exprNode = node.expr;
        return this.analyzeExpr(exprNode, state);
    }

    analyzeExpr(node: ExprNode | Nullish, state: ExecutionState): ExecutionState {
        if (!node) {
            return state;
        }
        if (node instanceof GroupedExprNode) {
            return this.analyzeGroupedExpr(node, state);
        } else if (node instanceof NameExprNode) {
            return this.analyzeNameExpr(node, state);
        } else if (node instanceof SizeofExprNode) {
            return this.analyzeSizeofExpr(node, state);
        } else if (node instanceof LiteralExprNode) {
            return this.analyzeLiteralExpr(node, state);
        } else if (node instanceof ArrayExprNode) {
            return this.analyzeArrayExpr(node, state);
        } else if (node instanceof BinaryExprNode) {
            return this.analyzeBinaryExpr(node, state);
        } else if (node instanceof TernaryExprNode) {
            return this.analyzeTernaryExpr(node, state);
        } else if (node instanceof UnaryExprNode) {
            return this.analyzeUnaryExpr(node, state);
        } else if (node instanceof CallExprNode) {
            return this.analyzeCallExpr(node, state);
        } else if (node instanceof IndexExprNode) {
            return this.analyzeIndexExpr(node, state);
        } else if (node instanceof FieldExprNode) {
            return this.analyzeFieldExpr(node, state);
        } else if (node instanceof CastExprNode) {
            return this.analyzeCastExpr(node, state);
        } else if (node instanceof RecordExprNode) {
            return this.analyzeRecordExpr(node, state);
        } else {
            unreachable(node);
        }
    }

    private analyzeGroupedExpr(node: GroupedExprNode, state: ExecutionState): ExecutionState {
        return this.analyzeExpr(node.exprNode, state);
    }

    private analyzeNameExpr(node: NameExprNode, state: ExecutionState): ExecutionState {
        return state;
    }

    private analyzeSizeofExpr(node: SizeofExprNode, state: ExecutionState): ExecutionState {
        return state;
    }

    private analyzeLiteralExpr(node: LiteralExprNode, state: ExecutionState): ExecutionState {
        return state;
    }

    private analyzeArrayExpr(node: ArrayExprNode, state: ExecutionState): ExecutionState {
        return node.exprNodes.reduce(
            (state, child) => this.analyzeExpr(child, state),
            state,
        );
    }

    private analyzeBinaryExpr(node: BinaryExprNode, state: ExecutionState): ExecutionState {
        const leftNode = node.left;
        const rightNode = node.right;
        state = this.analyzeExpr(leftNode, state);
        state = this.analyzeExpr(rightNode, state);
        return state;
    }

    private analyzeTernaryExpr(node: TernaryExprNode, state: ExecutionState): ExecutionState {
        const condNode = node.cond;
        const thenNode = node.then;
        const elseNode = node.else;

        state = this.analyzeExpr(node.cond, state);
        if (isTriviallyTrue(condNode)) {
            if (elseNode) {
                this.reportUnreachableCode(elseNode);
            }
            return this.analyzeExpr(thenNode, state);
        } else if (isTriviallyFalse(condNode)) {
            if (thenNode) {
                this.reportUnreachableCode(thenNode);
            }
            return this.analyzeExpr(elseNode, state);
        } else {
            const thenState = this.analyzeExpr(thenNode, state);
            const elseState = this.analyzeExpr(elseNode, state);
            return executionStateUnion(thenState, elseState);
        }
    }

    private analyzeUnaryExpr(node: UnaryExprNode, state: ExecutionState): ExecutionState {
        const operandNode = node.right;
        return this.analyzeExpr(operandNode, state);
    }

    private analyzeCallExpr(node: CallExprNode, state: ExecutionState): ExecutionState {
        const calleeNode = node.callee;
        const argNodes = node.args?.callArgNodes;
        if (!argNodes || !calleeNode) {
            return state;
        }
        state = this.analyzeExpr(calleeNode, state);
        for (const argNode of argNodes) {
            state = this.analyzeExpr(argNode.value, state);
        }
        const returnType = this.getType(node)!;
        if (returnType.kind === TypeKind.Never) {
            return {
                exitLevel: ExitLevel.Function,
            };
        }
        return state;
    }

    private analyzeIndexExpr(node: IndexExprNode, state: ExecutionState): ExecutionState {
        const indexeeNode = node.indexee;
        const indexNode = node.index;
        state = this.analyzeExpr(indexeeNode, state);
        state = this.analyzeExpr(indexNode, state);
        return state;
    }

    private analyzeFieldExpr(node: FieldExprNode, state: ExecutionState): ExecutionState {
        const leftNode = node.left;
        return this.analyzeExpr(leftNode, state);
    }

    private analyzeCastExpr(node: CastExprNode, state: ExecutionState): ExecutionState {
        const exprNode = node.expr;
        return this.analyzeExpr(exprNode, state);
    }

    private analyzeRecordExpr(node: RecordExprNode, state: ExecutionState): ExecutionState {
        const fieldNodes = node.fields?.fieldInitNodes;

        if (!fieldNodes) {
            return state;
        }

        return fieldNodes.reduce(
            (state, fieldNode) => this.analyzeExpr(fieldNode.value, state),
            state,
        );
    }

    //=========================================================================

    private getType(node: AstNode): Type | undefined {
        return this.nodeTypeMap.get(node.syntax);
    }

    private reportUnreachableCode(range: PointRange) {
        this.reportDiagnostic(range, 'hint', 'Unreachable code', true);
    }

    private reportDiagnostic(range: PointRange, severity: Severity, message: string, unnecessary = false) {
        this.diags.push({
            severity,
            location: { file: this.path, range: range },
            message,
            unnecessary,
        });
    }

    private reportError(range: PointRange, message: string) {
        this.reportDiagnostic(range, 'error', message);
    }
}

function isTriviallyTrue(node: ExprNode | Nullish): boolean {
    return isBoolLiteral('true', node);
}

function isTriviallyFalse(node: ExprNode | Nullish): boolean {
    return isBoolLiteral('false', node);
}

function isBoolLiteral(value: string, node: ExprNode | Nullish): boolean {
    const syntaxNode = node?.syntax;
    return syntaxNode?.type === NodeTypes.LiteralExpr
        && syntaxNode.firstChild?.type === LiteralNodeTypes.Bool
        && syntaxNode.firstChild.text === value;
}

function isNonVoidType(type: Type): boolean {
    return type.kind !== TypeKind.Err && type.kind !== TypeKind.Void;
}

function executionStateUnion(a: ExecutionState, b: ExecutionState): ExecutionState {
    return {
        exitLevel: Math.min(a.exitLevel, b.exitLevel),
    };
}
