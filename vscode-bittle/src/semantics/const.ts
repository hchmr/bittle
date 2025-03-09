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

export function constCoerce(value: ConstValue, target: Type): ConstValue | undefined {
    if (typeEq(value.type, target)) {
        return value;
    }

    switch (target.kind) {
        case TypeKind.Bool:
            if (value.kind === ConstValueKind.Int) {
                return mkBoolConstValue(!!value.value);
            }
            break;
        case TypeKind.Int:
            if (value.kind === ConstValueKind.Bool) {
                return mkIntConstValue(value.value ? 1 : 0, target);
            } else if (value.kind === ConstValueKind.Int) {
                return mkIntConstValue(value.value, target);
            }
            break;
    }
    return undefined;
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
