import { stream } from '../utils/stream';
import { EnumSym, StructSym } from './sym';

export type Type =
    | VoidType
    | BoolType
    | IntType
    | PointerType
    | ArrayType
    | EnumType
    | StructType
    | NeverType
    | ErrorType;

export enum TypeKind {
    Void = 'Void',
    Bool = 'Bool',
    Int = 'Int',
    Ptr = 'Ptr',
    Arr = 'Arr',
    Enum = 'Enum',
    Struct = 'Struct',
    Never = 'Never',
    Err = 'Err',
}

export type VoidType = Readonly<{
    kind: TypeKind.Void;
}>;

export type BoolType = Readonly<{
    kind: TypeKind.Bool;
}>;

export type IntType = Readonly<{
    kind: TypeKind.Int;
    size: number | undefined;
}>;

export type PointerType = Readonly<{
    kind: TypeKind.Ptr;
    pointeeType: Type;
}>;

export type ArrayType = Readonly<{
    kind: TypeKind.Arr;
    elemType: Type;
    size: number | undefined;
}>;

export type EnumType = Readonly<{
    kind: TypeKind.Enum;
    sym: EnumSym;
}>;

export type StructType = Readonly<{
    kind: TypeKind.Struct;
    sym: StructSym;
}>;

export type NeverType = Readonly<{
    kind: TypeKind.Never;
}>;

export type ErrorType = Readonly<{
    kind: TypeKind.Err;
}>;

//= Factory functions

const VOID_TYPE: VoidType = { kind: TypeKind.Void };

const BOOL_TYPE: BoolType = { kind: TypeKind.Bool };

const INT8_TYPE: IntType = { kind: TypeKind.Int, size: 8 };

const INT16_TYPE: IntType = { kind: TypeKind.Int, size: 16 };

const INT32_TYPE: IntType = { kind: TypeKind.Int, size: 32 };

const INT64_TYPE: IntType = { kind: TypeKind.Int, size: 64 };

const INT_UNKNOWN_TYPE: IntType = { kind: TypeKind.Int, size: undefined };

const NEVER_TYPE: NeverType = { kind: TypeKind.Never };

const ERROR_TYPE: ErrorType = { kind: TypeKind.Err };

const POINTER_TYPES = new WeakMap<Type, PointerType>();

const ENUM_TYPES = new WeakMap<EnumSym, EnumType>();

const STRUCT_TYPES = new WeakMap<StructSym, StructType>();

export function mkVoidType(): Type {
    return VOID_TYPE;
}

export function mkBoolType(): Type {
    return BOOL_TYPE;
}

export function mkIntType(size: number | undefined): Type {
    switch (size) {
        case 8: return INT8_TYPE;
        case 16: return INT16_TYPE;
        case 32: return INT32_TYPE;
        case 64: return INT64_TYPE;
        default: return INT_UNKNOWN_TYPE;
    }
}

export function mkPointerType(pointeeType: Type): Type {
    let ptrType = POINTER_TYPES.get(pointeeType);
    if (ptrType === undefined) {
        ptrType = { kind: TypeKind.Ptr, pointeeType };
        POINTER_TYPES.set(pointeeType, ptrType);
    }
    return ptrType;
}

export function mkArrayType(elemType: Type, size: number | undefined): Type {
    return { kind: TypeKind.Arr, elemType, size };
}

export function mkNeverType(): Type {
    return NEVER_TYPE;
}

export function mkEnumType(sym: EnumSym): EnumType {
    let enumType = ENUM_TYPES.get(sym);
    if (!enumType) {
        enumType = { kind: TypeKind.Enum, sym };
        ENUM_TYPES.set(sym, enumType);
    }
    return enumType;
}

export function mkStructType(sym: StructSym): StructType {
    let structType = STRUCT_TYPES.get(sym);
    if (!structType) {
        structType = { kind: TypeKind.Struct, sym };
        STRUCT_TYPES.set(sym, structType);
    }
    return structType;
}

export function mkErrorType(): Type {
    return ERROR_TYPE;
}

export const primitiveTypes: Partial<Record<string, Type>> = {
    Void: mkVoidType(),
    Bool: mkBoolType(),
    Char: mkIntType(8),
    Int8: mkIntType(8),
    Int16: mkIntType(16),
    Int32: mkIntType(32),
    Int: mkIntType(64),
    Int64: mkIntType(64),
};

//= Type layout

export type TypeLayout = {
    size: number;
    align: number;
};

export function typeLayout(type: Type): TypeLayout | undefined {
    switch (type.kind) {
        case TypeKind.Void: {
            return undefined;
        }
        case TypeKind.Bool: {
            return { size: 1, align: 1 };
        }
        case TypeKind.Int: {
            const byteCount = type.size! / 8;
            return { size: byteCount, align: byteCount };
        }
        case TypeKind.Ptr: {
            return { size: 8, align: 8 };
        }
        case TypeKind.Arr: {
            const elemLayout = typeLayout(type.elemType);
            return elemLayout && { size: elemLayout.size * type.size!, align: elemLayout.align };
        }
        case TypeKind.Enum: {
            return typeLayout(mkIntType(type.sym.size));
        }
        case TypeKind.Struct: {
            const sym = type.sym;
            if (!sym.isDefined) {
                return undefined;
            }
            const a = stream(sym.fields)
                .map(field => typeLayout(field.type))
                .reduce<TypeLayout | undefined>((a, b) => a && b && {
                    size: alignUp(a.size, b.align) + b.size,
                    align: Math.max(a.align, b.align),
                }, { size: 0, align: 0 });
            return a && {
                size: alignUp(a.size, a.align),
                align: a.align,
            };
        }
        case TypeKind.Never:
        case TypeKind.Err: {
            return undefined;
        }
        default: {
            const unreachable: never = type;
            throw new Error(`Unexpected type: ${unreachable}`);
        }
    }

    function alignUp(size: number, align: number) {
        return Math.ceil(size / align) * align;
    }
}

//= Type merging

export function tryUnifyTypes(t1: Type, t2: Type, onError: () => void): Type {
    if (typeEq(t1, t2) || typeImplicitlyConvertible(t1, t2)) {
        return t2;
    } else if (typeImplicitlyConvertible(t2, t1)) {
        return t1;
    }

    if (t1.kind !== t2.kind) {
        onError();
        return mkErrorType();
    }

    if (t1.kind === TypeKind.Int && t2.kind === t1.kind) {
        const size = unifySize(t1.size, t2.size, onError);
        return mkIntType(size);
    } else if (t1.kind === TypeKind.Ptr && t2.kind === t1.kind) {
        const pointeeType = tryUnifyTypes(t1.pointeeType, t2.pointeeType, onError);
        return mkPointerType(pointeeType);
    } else if (t1.kind === TypeKind.Arr && t2.kind === t1.kind) {
        const elemType = tryUnifyTypes(t1.elemType, t2.elemType, onError);
        const size = unifySize(t1.size, t2.size, onError);
        return mkArrayType(elemType, size);
    } else if ((t1.kind === TypeKind.Enum || t1.kind === TypeKind.Struct) && t2.kind === t1.kind) {
        if (t1.sym.qualifiedName !== t2.sym.qualifiedName) {
            onError();
            return mkErrorType();
        }
        return t1;
    } else {
        return t1;
    }

    function unifySize(size1: number | undefined, size2: number | undefined, onError: () => void): number | undefined {
        if (size1 !== undefined && size2 !== undefined && size1 !== size2) {
            onError();
            return undefined;
        }
        return size1 ?? size2;
    }
}

export function typeEq(t1: Type, t2: Type): boolean {
    if (t1 === t2) {
        return true;
    }
    if (t1.kind !== t2.kind) {
        return false;
    }
    if (t1.kind === TypeKind.Int) {
        t2 = t2 as IntType;
        return t1.size === t2.size;
    } else if (t1.kind === TypeKind.Ptr) {
        t2 = t2 as PointerType;
        return typeEq(t1.pointeeType, t2.pointeeType);
    } else if (t1.kind === TypeKind.Arr) {
        t2 = t2 as ArrayType;
        return typeEq(t1.elemType, t2.elemType) && t1.size === t2.size;
    } else if (t1.kind === TypeKind.Enum || t1.kind === TypeKind.Struct) {
        t2 = t2 as EnumType | StructType;
        return t1.sym.qualifiedName === t2.sym.qualifiedName;
    } else {
        return true;
    }
}

export function isScalarType(type: Type): boolean {
    return type.kind === TypeKind.Bool
        || type.kind === TypeKind.Int
        || type.kind === TypeKind.Ptr
        || type.kind === TypeKind.Enum;
}

export function isValidReturnType(type: Type): boolean {
    return type.kind === TypeKind.Void
        || type.kind === TypeKind.Never
        || isScalarType(type);
}

export function typeImplicitlyConvertible(src: Type, dst: Type): boolean {
    if (src.kind === TypeKind.Never || src.kind === TypeKind.Err) {
        return true;
    }

    if (dst.kind === TypeKind.Bool) {
        return isScalarType(src);
    } else if (dst.kind === TypeKind.Int) {
        return (src.kind === TypeKind.Int && src.size! <= dst.size!)
            || (src.kind === TypeKind.Enum && src.sym.size! <= dst.size!);
    } else if (dst.kind === TypeKind.Ptr) {
        return src.kind === TypeKind.Ptr && pointeeTypeLe(src.pointeeType, dst.pointeeType);
    } else {
        return false;
    }
}

export function typeConvertible(src: Type, dst: Type): boolean {
    if (src.kind === TypeKind.Never || src.kind === TypeKind.Err) {
        return true;
    }

    if (dst.kind === TypeKind.Bool) {
        return isScalarType(src);
    } else if (dst.kind === TypeKind.Int) {
        return isScalarType(src);
    } else if (dst.kind === TypeKind.Ptr) {
        return (src.kind === TypeKind.Int && src.size === 64)
            || src.kind === TypeKind.Ptr;
    } else if (dst.kind === TypeKind.Enum) {
        return src.kind === TypeKind.Int
            || src.kind === TypeKind.Enum;
    } else {
        return false;
    }
}

function pointeeTypeLe(t1: Type, t2: Type): boolean {
    return typeEq(t1, t2)
        || (t1.kind === TypeKind.Err || t2.kind === TypeKind.Err)
        || (t1.kind === TypeKind.Void)
        || (t1.kind === TypeKind.Struct && t2.kind === TypeKind.Struct && structLe(t1.sym, t2.sym));
}

function structLe(s1: StructSym, s2: StructSym): boolean {
    if (s1.qualifiedName === s2.qualifiedName) {
        return true;
    }
    if (s1.base === undefined) {
        return false;
    }
    return structLe(s1.base, s2);
}

export function prettyType(t: Type): string {
    switch (t.kind) {
        case TypeKind.Void: return 'Void';
        case TypeKind.Bool: return 'Bool';
        case TypeKind.Int: return `Int${t.size ?? ''}`;
        case TypeKind.Ptr: return '*' + prettyType(t.pointeeType);
        case TypeKind.Arr: return `[${prettyType(t.elemType)}; ${t.size ?? '?'}]`;
        case TypeKind.Enum:
        case TypeKind.Struct: return t.sym.name;
        case TypeKind.Never: return '!';
        case TypeKind.Err: return '{unknown}';
    }
}
