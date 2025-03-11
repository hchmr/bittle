import assert from 'assert';
import { ArrayExprNode, BinaryExprNode, BoolLiteralNode, CallExprNode, CastExprNode, CharLiteralNode, ExprNode, FieldExprNode, GroupedExprNode, IndexExprNode, IntLiteralNode, LiteralExprNode, NameExprNode, NullLiteralNode, RecordExprNode, SizeofExprNode, StringLiteralNode, TernaryExprNode, TypeNode, UnaryExprNode } from '../syntax/generated';
import { Nullish, unreachable } from '../utils';
import { parseChar, parseString } from '../utils/literalParsing';
import { checkedMkIntConstValue, constCoerce, ConstValue, constValueCast, ConstValueKind, mkBoolConstValue, mkIntConstValue, mkNullConstValue, mkStringConstValue } from './const';
import { Sym, SymKind } from './sym';
import { mkBoolType, mkErrorType, Type, typeLayout, unifyTypesWithCoercion } from './type';

const compareOps = {
    '==': <T>(a: T, b: T) => a === b,
    '!=': <T>(a: T, b: T) => a !== b,
    '<': <T>(a: T, b: T) => a < b,
    '<=': <T>(a: T, b: T) => a <= b,
    '>': <T>(a: T, b: T) => a > b,
    '>=': <T>(a: T, b: T) => a >= b,
} as const;

const arithmeticOps = {
    '+': (a: bigint, b: bigint) => a + b,
    '-': (a: bigint, b: bigint) => a - b,
    '*': (a: bigint, b: bigint) => a * b,
    '/': (a: bigint, b: bigint) => b === 0n ? undefined : a / b,
    '%': (a: bigint, b: bigint) => b === 0n ? undefined : a % b,
} as const;

function compare<T>(op: keyof typeof compareOps, a: T, b: T): boolean {
    return compareOps[op](a, b);
}

export class ConstEvaluator {
    getType: (node: ExprNode | TypeNode | Nullish) => Type;

    constructor(
        private getSym: (node: NameExprNode) => Sym | undefined,
        getType: (node: ExprNode | TypeNode) => Type,
    ) {
        this.getType = (node) => node ? getType(node) : mkErrorType();
    }

    public eval(node: ExprNode | Nullish): ConstValue | undefined {
        if (!node) {
            return undefined;
        }

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
        return this.eval(node.exprNode);
    }

    private evalNameExpr(node: NameExprNode): ConstValue | undefined {
        const sym = this.getSym(node);
        if (sym?.kind !== SymKind.Const) {
            return undefined;
        }
        return sym.value;
    }

    private evalSizeofExpr(node: SizeofExprNode): ConstValue | undefined {
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

        if (literal instanceof NullLiteralNode) {
            return mkNullConstValue(resultType);
        } else if (literal instanceof BoolLiteralNode) {
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
        if (!op) {
            return undefined;
        }

        if (op === '&&' || op === '||') {
            return this.evalLogicalExpr(node);
        }

        let a = this.eval(node.left);
        let b = this.eval(node.right);

        if (!a || !b) {
            return undefined;
        }

        switch (op) {
            case '+':
            case '-':
            case '*':
            case '/':
            case '%': {
                const resultType = this.getType(node);
                [a, b] = [constCoerce(a, resultType), constCoerce(b, resultType)];
                if (a?.kind !== ConstValueKind.Int || b?.kind !== ConstValueKind.Int) {
                    return undefined;
                }
                const result = arithmeticOps[op](a.value, b.value);
                if (result === undefined) {
                    return undefined;
                }
                return checkedMkIntConstValue(result, resultType);
            }
            case '==':
            case '!=':
            case '<':
            case '<=':
            case '>':
            case '>=': {
                const resultType = unifyTypesWithCoercion(a.type, b.type);
                [a, b] = [constCoerce(a, resultType), constCoerce(b, resultType)];
                if (!a || !b) {
                    return undefined;
                }
                switch (a.kind) {
                    case ConstValueKind.Bool:
                        if (b?.kind !== ConstValueKind.Bool) {
                            return undefined;
                        }
                        return mkBoolConstValue(compare(op, a.value, b.value));
                    case ConstValueKind.Int:
                        if (b?.kind !== ConstValueKind.Int) {
                            return undefined;
                        }
                        return mkBoolConstValue(compare(op, a.value, b.value));
                }
            }
        }
        return undefined;
    }

    private evalLogicalExpr(node: BinaryExprNode): ConstValue | undefined {
        const op = node.op?.text;
        assert(op === '&&' || op === '||');

        let a = this.eval(node.left);
        a = a && constCoerce(a, mkBoolType());

        if (a?.kind !== ConstValueKind.Bool) {
            return undefined;
        }

        if (!a.value && op === '&&' || a.value && op === '||') {
            return a;
        }

        let b = this.eval(node.right);
        b = b && constCoerce(b, mkBoolType());

        return b;
    }

    private evalUnaryExpr(node: UnaryExprNode): ConstValue | undefined {
        const op = node.op?.text;
        if (!op) {
            return undefined;
        }

        let a = this.eval(node.right);
        if (!a) {
            return undefined;
        }

        const resultType = this.getType(node);

        switch (op) {
            case '!':
                a = constCoerce(a, mkBoolType());
                if (a?.kind !== ConstValueKind.Bool) {
                    return undefined;
                }
                return mkBoolConstValue(!a.value);
            case '-':
            case '~':
                a = constCoerce(a, resultType);
                if (a?.kind !== ConstValueKind.Int) {
                    return undefined;
                }
                switch (op) {
                    case '-':
                        return mkIntConstValue(-a.value, a.type);
                    case '~':
                        return mkIntConstValue(~a.value, a.type);
                }
        }
    }

    private evalTernaryExpr(node: TernaryExprNode): ConstValue | undefined {
        let a = this.eval(node.cond);
        a = a && constCoerce(a, mkBoolType());

        if (a?.kind !== ConstValueKind.Bool) {
            return undefined;
        }

        const resultType = this.getType(node);

        if (a.value) {
            const b = this.eval(node.then);
            return b && constCoerce(b, resultType);
        } else {
            const b = this.eval(node.else);
            return b && constCoerce(b, resultType);
        }
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
        const value = this.eval(node.expr);
        if (!value) {
            return undefined;
        }
        const target = this.getType(node.type);

        return constValueCast(value, target);
    }

    private evalRecordExpr(node: RecordExprNode): ConstValue | undefined {
        return undefined;
    }
}
