import { BoolType, canCoerce, mkBoolType, mkIntType, mkPointerType, Type, typeEq, TypeKind, typeLayout } from './type';

export enum ConstValueKind {
    Bool,
    Int,
    Null,
    String,
}

export type ConstValue =
    | BoolConstValue
    | IntConstValue
    | NullConstValue
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

export type NullConstValue = {
    kind: ConstValueKind.Null;
    type: Type;
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

export function mkNullConstValue(type: Type): NullConstValue {
    return { kind: ConstValueKind.Null, type };
}

export function mkStringConstValue(value: string): StringConstValue {
    return { kind: ConstValueKind.String, type: mkPointerType(mkIntType(8), false), value };
}

export function constCoerce(value: ConstValue, target: Type): ConstValue | undefined {
    if (canCoerce(value.type, target)) {
        return constValueCast(value, target);
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
        case ConstValueKind.Null:
            if (target.kind === TypeKind.Bool) {
                return mkBoolConstValue(false);
            } else if (target.kind === TypeKind.Int) {
                return mkIntConstValue(0n, target);
            } else if (target.kind === TypeKind.Ptr) {
                return mkNullConstValue(target);
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
