import { ArrayExprNode, BinaryExprNode, BoolLiteralNode, CallExprNode, CastExprNode, CharLiteralNode, ExprNode, FieldExprNode, GroupedExprNode, IndexExprNode, IntLiteralNode, LiteralExprNode, NameExprNode, RecordExprNode, SizeofExprNode, StringLiteralNode, TernaryExprNode, TypeNode, UnaryExprNode } from '../syntax/generated';
import { unreachable } from '../utils';
import { parseChar, parseString } from '../utils/literalParsing';
import { ConstValue, constValueBinop, constValueCast, constValueTernop, constValueUnop, mkBoolConstValue, mkIntConstValue, mkStringConstValue } from './const';
import { Sym, SymKind } from './sym';
import { Type, typeLayout } from './type';

export class ConstEvaluator {
    constructor(
        private getSym: (node: NameExprNode) => Sym | undefined,
        private getType: (node: ExprNode | TypeNode) => Type,
    ) {
    }

    public evaluate(node: ExprNode): ConstValue | undefined {
        if (node instanceof GroupedExprNode) {
            return this.evalGroupedExpr(node);
        } else if (node instanceof NameExprNode) {
            return this.evalNameExpr(node);
        } else if (node instanceof SizeofExprNode) {
            return this.evalSizeofExpr(node);
        } else if (node instanceof LiteralExprNode) {
            return this.evalLiteralExpr(node);
        } else if (node instanceof ArrayExprNode) {
            return this.evalArrayExpr(node);
        } else if (node instanceof UnaryExprNode) {
            return this.evalUnaryExpr(node);
        } else if (node instanceof BinaryExprNode) {
            return this.evalBinaryExpr(node);
        } else if (node instanceof TernaryExprNode) {
            return this.evalTernaryExpr(node);
        } else if (node instanceof CallExprNode) {
            return this.evalCallExpr(node);
        } else if (node instanceof IndexExprNode) {
            return this.evalIndexExpr(node);
        } else if (node instanceof FieldExprNode) {
            return this.evalFieldExpr(node);
        } else if (node instanceof CastExprNode) {
            return this.evalCastExpr(node);
        } else if (node instanceof RecordExprNode) {
            return this.evalRecordExpr(node);
        } else {
            unreachable(node);
        }
    }

    private evalGroupedExpr(node: GroupedExprNode): ConstValue | undefined {
        if (!node.exprNode) {
            return undefined;
        }
        return this.evaluate(node.exprNode);
    }

    private evalNameExpr(node: NameExprNode): ConstValue | undefined {
        const sym = this.getSym(node);
        if (!sym || sym.kind !== SymKind.Const) {
            return undefined;
        }
        return sym.value;
    }

    private evalSizeofExpr(node: SizeofExprNode): ConstValue | undefined {
        if (!node.type) {
            return undefined;
        }
        const type = this.getType(node.type);
        const size = typeLayout(type)?.size;
        if (!size) {
            return undefined;
        }
        const resultType = this.getType(node);
        return mkIntConstValue(size, resultType);
    }

    private evalLiteralExpr(node: LiteralExprNode): ConstValue | undefined {
        const literal = node.literalNode!;
        const text = literal.syntax.text;

        const resultType = this.getType(node);

        if (literal instanceof BoolLiteralNode) {
            return mkBoolConstValue(text === 'true');
        } else if (literal instanceof IntLiteralNode) {
            const value = parseInt(text);
            if (!Number.isSafeInteger(value)) {
                return undefined;
            }
            return mkIntConstValue(value, resultType);
        } else if (literal instanceof CharLiteralNode) {
            const value = parseChar(text)?.charCodeAt(0);
            if (value === undefined) {
                return undefined;
            }
            return mkIntConstValue(value, resultType);
        } else if (literal instanceof StringLiteralNode) {
            const value = parseString(text);
            if (value === undefined) {
                return undefined;
            }
            return mkStringConstValue(value);
        } else {
            return undefined;
        }
    }

    private evalArrayExpr(node: ArrayExprNode): ConstValue | undefined {
        return undefined;
    }

    private evalBinaryExpr(node: BinaryExprNode): ConstValue | undefined {
        const op = node.op?.text;
        if (!op || !node.left || !node.right) {
            return undefined;
        }
        const leftValue = this.evaluate(node.left);
        if (!leftValue) {
            return undefined;
        }
        const rightValue = this.evaluate(node.right);
        if (!rightValue) {
            return undefined;
        }
        return constValueBinop(op, leftValue, rightValue);
    }

    private evalUnaryExpr(node: UnaryExprNode): ConstValue | undefined {
        const op = node.op?.text;
        if (!op || !node.right) {
            return undefined;
        }
        const rightValue = this.evaluate(node.right);
        if (!rightValue) {
            return undefined;
        }
        return constValueUnop(op, rightValue);
    }

    private evalTernaryExpr(node: TernaryExprNode): ConstValue | undefined {
        if (!node.cond) {
            return undefined;
        }
        const condValue = this.evaluate(node.cond);
        if (!condValue) {
            return undefined;
        }
        return constValueTernop(
            condValue,
            () => {
                if (!node.then) {
                    return undefined;
                }
                return this.evaluate(node.then);
            },
            () => {
                if (!node.else) {
                    return undefined;
                }
                return this.evaluate(node.else);
            },
        );
    }

    private evalCallExpr(node: CallExprNode): ConstValue | undefined {
        return undefined;
    }

    private evalIndexExpr(node: IndexExprNode): ConstValue | undefined {
        return undefined;
    }

    private evalFieldExpr(node: FieldExprNode): ConstValue | undefined {
        return undefined;
    }

    private evalCastExpr(node: CastExprNode): ConstValue | undefined {
        if (!node.type || !node.expr) {
            return undefined;
        }
        const exprValue = this.evaluate(node.expr);
        if (!exprValue) {
            return undefined;
        }
        const resultType = this.getType(node.type);
        return constValueCast(exprValue, resultType);
    }

    private evalRecordExpr(node: RecordExprNode): ConstValue | undefined {
        return undefined;
    }
}
