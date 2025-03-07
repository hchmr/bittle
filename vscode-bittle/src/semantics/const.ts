import assert from 'assert';
import { BoolType, mkBoolType, mkIntType, mkPointerType, Type, typeEq, TypeKind, typeLayout } from './type';

export enum ConstValueKind {
    Bool,
    Int,
    String,
}

export type ConstValue =
    | BoolConstValue
    | IntConstValue
    | StringConstValue
    ;

export type BoolConstValue = {
    kind: ConstValueKind.Bool;
    type: BoolType;
    value: boolean;
};

export type IntConstValue = {
    kind: ConstValueKind.Int;
    type: Type;
    value: bigint;
};

export type StringConstValue = {
    kind: ConstValueKind.String;
    type: Type;
    value: string;
};

export function mkBoolConstValue(value: boolean): BoolConstValue {
    return { kind: ConstValueKind.Bool, type: mkBoolType(), value };
}

export function mkIntConstValue(value: bigint | number, type: Type): IntConstValue {
    if (typeof value === 'number') {
        value = BigInt(value);
    }
    return { kind: ConstValueKind.Int, type, value };
}

export function checkedMkIntConstValue(value: bigint, type: Type): IntConstValue | undefined {
    const size = typeLayout(type)?.size ?? 8;
    if (value != BigInt.asIntN(size * 8, value)) {
        return undefined; // out of range
    }
    return mkIntConstValue(value, type);
}

export function mkStringConstValue(value: string): StringConstValue {
    return { kind: ConstValueKind.String, type: mkPointerType(mkIntType(8)), value };
}

const compareOps = {
    '==': <T>(a: T, b: T) => a === b,
    '!=': <T>(a: T, b: T) => a !== b,
    '<': <T>(a: T, b: T) => a < b,
    '<=': <T>(a: T, b: T) => a <= b,
    '>': <T>(a: T, b: T) => a > b,
    '>=': <T>(a: T, b: T) => a >= b,
} as const;

function compare<T>(op: keyof typeof compareOps, a: T, b: T): boolean {
    return compareOps[op](a, b);
}

export function constValueUnop(op: string, a: ConstValue): ConstValue | undefined {
    switch (a.kind) {
        case ConstValueKind.Bool:
            switch (op) {
                case '!':
                    return mkBoolConstValue(!a.value);
            }
            break;
        case ConstValueKind.Int:
            switch (op) {
                case '-':
                    return mkIntConstValue(-a.value, a.type);
                case '~':
                    return mkIntConstValue(~a.value, a.type);
            }
            break;
    }
    return undefined;
}

export function constValueBinop(op: string, a: ConstValue, b: ConstValue): ConstValue | undefined {
    if (a.kind !== b.kind) {
        return undefined;
    }
    switch (a.kind) {
        case ConstValueKind.Bool:
            assert(b.kind === ConstValueKind.Bool);
            switch (op) {
                case '||':
                    return mkBoolConstValue(a.value || b.value);
                case '&&':
                    return mkBoolConstValue(a.value && b.value);
                case '==':
                case '!=':
                case '<':
                case '<=':
                case '>':
                case '>=':
                    return mkBoolConstValue(compare(op, a.value, b.value));
            }
            break;
        case ConstValueKind.Int:
            assert(b.kind === ConstValueKind.Int);
            switch (op) {
                case '+':
                    return checkedMkIntConstValue(a.value + b.value, a.type);
                case '-':
                    return checkedMkIntConstValue(a.value - b.value, a.type);
                case '*':
                    return checkedMkIntConstValue(a.value * b.value, a.type);
                case '/':
                    if (b.value === 0n) {
                        return undefined;
                    }
                    return checkedMkIntConstValue(a.value / b.value, a.type);
                case '%':
                    if (b.value === 0n) {
                        return undefined;
                    }
                    return checkedMkIntConstValue(a.value % b.value, a.type);
                case '==':
                case '!=':
                case '<':
                case '<=':
                case '>':
                case '>=':
                    return mkBoolConstValue(compare(op, a.value, b.value));
            }
            break;
    }
    return undefined;
}

export function constValueTernop(cond: ConstValue, t: () => ConstValue | undefined, f: () => ConstValue | undefined): ConstValue | undefined {
    if (cond.kind !== ConstValueKind.Bool) {
        return undefined;
    }
    if (cond.value) {
        return t();
    } else {
        return f();
    }
}

export function constValueCast(value: ConstValue, target: Type): ConstValue | undefined {
    if (typeEq(value.type, target)) {
        return value;
    }

    switch (value.kind) {
        case ConstValueKind.Bool:
            if (target.kind === TypeKind.Int) {
                return mkIntConstValue(value.value ? 1 : 0, target);
            }
            break;
        case ConstValueKind.Int:
            if (target.kind === TypeKind.Bool) {
                return mkBoolConstValue(!!value.value);
            } else if (target.kind === TypeKind.Int || target.kind === TypeKind.Enum) {
                return mkIntConstValue(value.value, target);
            }
            break;
        case ConstValueKind.String:
            if (target.kind === TypeKind.Bool) {
                return mkBoolConstValue(true);
            }
            break;
    }

    return undefined;
}
