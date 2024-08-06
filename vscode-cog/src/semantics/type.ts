export type Type =
    | VoidType
    | BoolType
    | IntType
    | PointerType
    | ArrayType
    | StructType
    | ErrorType;

export enum TypeKind {
    Void = 'Void',
    Bool = 'Bool',
    Int = 'Int',
    Ptr = 'Ptr',
    Arr = 'Arr',
    Struct = 'Struct',
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

export type StructType = Readonly<{
    kind: TypeKind.Struct;
    name: string;
    qualifiedName: string;
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

const ERROR_TYPE: ErrorType = { kind: TypeKind.Err };

const POINTER_TYPES = new WeakMap<Type, PointerType>();

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

export function mkStructType(name: string, qualifiedName: string): Type {
    return { kind: TypeKind.Struct, name, qualifiedName };
}

export function mkErrorType(): Type {
    return ERROR_TYPE;
}

//= Type merging

export function unifyTypes(t1: Type, t2: Type): Type {
    return tryUnifyTypes(t1, t2, () => {
    });
}

export function tryUnifyTypes(t1: Type, t2: Type, onError: () => void): Type {
    if (typeLe(t1, t2)) {
        return t2;
    } else if (typeLe(t2, t1)) {
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
    } else if (t1.kind === TypeKind.Struct && t2.kind === t1.kind) {
        if (t1.name !== t2.name) {
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

function typeEquals(t1: Type, t2: Type): boolean {
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
        return typeEquals(t1.pointeeType, t2.pointeeType);
    } else if (t1.kind === TypeKind.Arr) {
        t2 = t2 as ArrayType;
        return typeEquals(t1.elemType, t2.elemType) && t1.size === t2.size;
    } else if (t1.kind === TypeKind.Struct) {
        t2 = t2 as StructType;
        return t1.name === t2.name;
    } else {
        return true;
    }
}

export function isScalarType(type: Type): boolean {
    return type.kind === TypeKind.Bool
        || type.kind === TypeKind.Int
        || type.kind === TypeKind.Ptr;
}

export function isValidReturnType(type: Type): boolean {
    return type.kind === TypeKind.Void
        || isScalarType(type);
}

export function typeLe(t1: Type, t2: Type): boolean {
    return typeEquals(t1, t2)
        || (t1.kind === TypeKind.Err)
        || (isScalarType(t1) && t2.kind === TypeKind.Bool)
        || (t1.kind === TypeKind.Int && t2.kind === TypeKind.Int && t1.size! <= t2.size!)
        || (t1.kind === TypeKind.Ptr && t2.kind === TypeKind.Ptr && t1.pointeeType.kind === TypeKind.Void);
}

export function prettyType(t: Type): string {
    switch (t.kind) {
        case TypeKind.Void: return 'Void';
        case TypeKind.Bool: return 'Bool';
        case TypeKind.Int: return `Int${t.size ?? ''}`;
        case TypeKind.Ptr: return '*' + prettyType(t.pointeeType);
        case TypeKind.Arr: return `[${prettyType(t.elemType)}; ${t.size ?? '?'}]`;
        case TypeKind.Struct: return t.name;
        case TypeKind.Err: return '{unknown}';
    }
}
