import { unreachable } from '../utils';
import { stream } from '../utils/stream';
import { EnumSym, RecordKind, RecordSym, TypeParamSym } from './sym';

export type Type =
    | VoidType
    | BoolType
    | IntType
    | PointerType
    | ArrayType
    | EnumType
    | RecordType
    | TypeParamType
    | NeverType
    | RestParamType
    | ErrorType;

export enum TypeKind {
    Void = 'Void',
    Bool = 'Bool',
    Int = 'Int',
    Ptr = 'Ptr',
    Arr = 'Arr',
    Enum = 'Enum',
    Record = 'Record',
    TypeParam = 'TypeParam',
    Never = 'Never',
    RestParam = 'RestParam',
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
    isMut: boolean;
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

export type RecordType = Readonly<{
    kind: TypeKind.Record;
    sym: RecordSym;
    args: readonly Type[];
}>;

export type TypeParamType = Readonly<{
    kind: TypeKind.TypeParam;
    sym: TypeParamSym;
}>;

export type NeverType = Readonly<{
    kind: TypeKind.Never;
}>;

export type RestParamType = Readonly<{
    kind: TypeKind.RestParam;
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

const REST_PARAM_TYPE: RestParamType = { kind: TypeKind.RestParam };

const ERROR_TYPE: ErrorType = { kind: TypeKind.Err };

const POINTER_TYPES = new WeakMap<Type, PointerType>();

const MUT_POINTER_TYPES = new WeakMap<Type, PointerType>();

const ENUM_TYPES = new WeakMap<EnumSym, EnumType>();

const RECORD_TYPES = new WeakMap<RecordSym, RecordType>();

const TYPE_PARAM_TYPES = new WeakMap<TypeParamSym, TypeParamType>();

export function mkVoidType(): Type {
    return VOID_TYPE;
}

export function mkBoolType(): BoolType {
    return BOOL_TYPE;
}

export function mkIntType(size: number | undefined): IntType {
    switch (size) {
        case 8: return INT8_TYPE;
        case 16: return INT16_TYPE;
        case 32: return INT32_TYPE;
        case 64: return INT64_TYPE;
        default: return INT_UNKNOWN_TYPE;
    }
}

export function mkPointerType(pointeeType: Type, isMut: boolean): PointerType {
    const cache = isMut ? MUT_POINTER_TYPES : POINTER_TYPES;
    let ptrType = cache.get(pointeeType);
    if (ptrType === undefined) {
        ptrType = { kind: TypeKind.Ptr, pointeeType, isMut };
        cache.set(pointeeType, ptrType);
    }
    return ptrType;
}

export function mkArrayType(elemType: Type, size: number | undefined): Type {
    return { kind: TypeKind.Arr, elemType, size };
}

export function mkNeverType(): Type {
    return NEVER_TYPE;
}

export function mkRestParamType(): Type {
    return REST_PARAM_TYPE;
}

export function mkEnumType(sym: EnumSym): EnumType {
    let enumType = ENUM_TYPES.get(sym);
    if (!enumType) {
        enumType = { kind: TypeKind.Enum, sym };
        ENUM_TYPES.set(sym, enumType);
    }
    return enumType;
}

export function mkNonGenericRecordType(sym: RecordSym): RecordType {
    let recordType = RECORD_TYPES.get(sym);
    if (!recordType) {
        recordType = { kind: TypeKind.Record, sym, args: [] };
        RECORD_TYPES.set(sym, recordType);
    }
    return recordType;
}

export function mkRecordType(sym: RecordSym, args: readonly Type[]): RecordType {
    if (args.length !== sym.typeParams.length) {
        throw new Error('Type argument count mismatch.');
    }
    if (args.length === 0) {
        return mkNonGenericRecordType(sym);
    }
    return { kind: TypeKind.Record, sym, args };
}

export function mkTypeParamType(sym: TypeParamSym): TypeParamType {
    let typeParamType = TYPE_PARAM_TYPES.get(sym);
    if (!typeParamType) {
        typeParamType = { kind: TypeKind.TypeParam, sym };
        TYPE_PARAM_TYPES.set(sym, typeParamType);
    }
    return typeParamType;
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
        case TypeKind.Record: {
            const sym = type.sym;
            if (!sym.isDefined) {
                return undefined;
            }
            const a = stream(sym.fields)
                .map(field => typeLayout(field.type))
                .reduce<TypeLayout | undefined>(
                    sym.recordKind === 'struct'
                        ? (a, b) => a && b && {
                                size: alignUp(a.size, b.align) + b.size,
                                align: Math.max(a.align, b.align),
                            }
                        : (a, b) => a && b && {
                                size: Math.max(a.size, b.size),
                                align: Math.max(a.align, b.align),
                            },
                    { size: 0, align: 0 },
                );
            return a && {
                size: alignUp(a.size, a.align),
                align: a.align,
            };
        }
        case TypeKind.RestParam: {
            return { size: 32, align: 8 };
        }
        case TypeKind.TypeParam:
        case TypeKind.Never:
        case TypeKind.Err: {
            return undefined;
        }
        default: {
            unreachable(type);
        }
    }

    function alignUp(size: number, align: number) {
        return Math.ceil(size / align) * align;
    }
}

//= Type merging

export function tryUnifyTypes(t1: Type, t2: Type, onError: () => void): Type {
    if (typeEq(t1, t2)) {
        return t1;
    }
    if (t1.kind === TypeKind.Err) {
        return t2;
    }
    if (t2.kind === TypeKind.Err) {
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
        const isMut = tryUnifyMutability(t1.isMut, t2.isMut, onError);
        const pointeeType = tryUnifyTypes(t1.pointeeType, t2.pointeeType, onError);
        return mkPointerType(pointeeType, isMut);
    } else if (t1.kind === TypeKind.Arr && t2.kind === t1.kind) {
        const elemType = tryUnifyTypes(t1.elemType, t2.elemType, onError);
        const size = unifySize(t1.size, t2.size, onError);
        return mkArrayType(elemType, size);
    } else if ((t1.kind === TypeKind.Enum || t1.kind === TypeKind.Record) && t2.kind === t1.kind) {
        if (t1.sym.qualifiedName !== t2.sym.qualifiedName) {
            onError();
            return mkErrorType();
        }
        return t1;
    } else if (t1.kind === TypeKind.TypeParam && t2.kind === TypeKind.TypeParam) {
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

    function tryUnifyMutability(isMut1: boolean, isMut2: boolean, onError: () => void): boolean {
        if (isMut1 !== isMut2) {
            onError();
        }
        return isMut1 || isMut2;
    }
}

export function unifyTypes(t1: Type, t2: Type): Type {
    return tryUnifyTypes(t1, t2, () => {
        // Ignore errors
    });
}

export function tryUnifyTypesWithCoercion(t1: Type, t2: Type, onError: () => void): Type {
    if (canCoerce(t2, t1)) {
        return t1;
    }
    if (canCoerce(t1, t2)) {
        return t2;
    }
    return tryUnifyTypes(t1, t2, onError);
}

export function unifyTypesWithCoercion(t1: Type, t2: Type): Type {
    return tryUnifyTypesWithCoercion(t1, t2, () => {
        // Ignore errors
    });
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
        return t1.isMut === t2.isMut
            && typeEq(t1.pointeeType, t2.pointeeType);
    } else if (t1.kind === TypeKind.Arr) {
        t2 = t2 as ArrayType;
        return typeEq(t1.elemType, t2.elemType) && t1.size === t2.size;
    } else if (t1.kind === TypeKind.Enum || t1.kind === TypeKind.Record) {
        t2 = t2 as EnumType | RecordType;
        return t1.sym.qualifiedName === t2.sym.qualifiedName;
    } else if (t1.kind === TypeKind.TypeParam) {
        t2 = t2 as TypeParamType;
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

export function isSizedType(type: Type): boolean {
    return typeLayout(type) !== undefined;
}

export function isValidReturnType(type: Type): boolean {
    return type.kind === TypeKind.Void
        || type.kind === TypeKind.Never
        || isSizedType(type);
}

export function canCoerce(src: Type, dst: Type): boolean {
    return typeEq(src, dst)
        || canCoerceWithCast(src, dst)
        || canCoerceToUnion(src, dst);
}

function canCoerceWithCast(src: Type, dst: Type): boolean {
    return typeImplicitlyCastable(src, dst);
}

function canCoerceToUnion(src: Type, dst: Type): boolean {
    if (dst.kind !== TypeKind.Record || dst.sym.recordKind !== RecordKind.Union) {
        return false;
    }
    return dst.sym.fields.some(f => typeEq(f.type, src));
}

export function typeImplicitlyCastable(src: Type, dst: Type): boolean {
    if (src.kind === TypeKind.Never || src.kind === TypeKind.Err) {
        return true;
    }

    if (dst.kind === TypeKind.Bool) {
        return isScalarType(src);
    } else if (dst.kind === TypeKind.Int) {
        return (src.kind === TypeKind.Int && src.size! <= dst.size!)
            || (src.kind === TypeKind.Enum && src.sym.size <= dst.size!);
    } else if (src.kind === TypeKind.Ptr && dst.kind === TypeKind.Ptr) {
        return pointerTypeLe(src, dst);
    } else {
        return false;
    }
}

export function typeCastable(src: Type, dst: Type): boolean {
    if (typeImplicitlyCastable(src, dst)) {
        return true;
    }

    if (dst.kind === TypeKind.Int) {
        return isScalarType(src);
    } else if (dst.kind === TypeKind.Ptr && src.kind === TypeKind.Int) {
        return src.size === 64;
    } else if (dst.kind === TypeKind.Ptr && src.kind === TypeKind.Ptr) {
        return src.pointeeType.kind === TypeKind.Void
            || dst.pointeeType.kind === TypeKind.Void
            || !(!src.isMut && dst.isMut);
    } else if (dst.kind === TypeKind.Enum) {
        return src.kind === TypeKind.Int
            || src.kind === TypeKind.Enum;
    } else {
        return false;
    }
}

function recordLe(s1: RecordSym, s2: RecordSym): boolean {
    if (s1.qualifiedName === s2.qualifiedName) {
        return true;
    }
    if (!s1.base) {
        return false;
    }
    return recordLe(s1.base, s2);
}

function pointeeTypeLe(t1: Type, t2: Type): boolean {
    return t1.kind === TypeKind.Never
        || t2.kind === TypeKind.Void
        || typeEq(t1, t2)
        || (t1.kind === TypeKind.Record && t2.kind === TypeKind.Record && recordLe(t1.sym, t2.sym));
}

function pointerTypeLe(t1: PointerType, t2: PointerType): boolean {
    return !t2.isMut && pointeeTypeLe(t1.pointeeType, t2.pointeeType)
        || t1.isMut && t2.isMut && (
            t1.pointeeType.kind === TypeKind.Never
            || t2.pointeeType.kind === TypeKind.Void
            || typeEq(t1.pointeeType, t2.pointeeType)
        );
}

//================================================================================
//== Type substitution

export type SubstCtx = Map<TypeParamSym, Type>;

export function createEmptySubstCtx(): SubstCtx {
    return new Map();
}

export function createSubstCtx(params: TypeParamSym[], args: readonly Type[]): SubstCtx {
    if (params.length !== args.length) {
        throw new Error('Parameter and argument count mismatch in substitution context.');
    }
    const map = new Map<TypeParamSym, Type>();
    for (let i = 0; i < params.length; i++) {
        map.set(params[i], args[i]);
    }
    return map;
}

export function createSubstCtxFromRecordType(recordType: RecordType): SubstCtx {
    return createSubstCtx(recordType.sym.typeParams, recordType.args);
}

export function typeSubst(ctx: SubstCtx, type: Type): Type {
    switch (type.kind) {
        case TypeKind.TypeParam: {
            return ctx.get(type.sym) ?? type;
        }
        case TypeKind.Ptr: {
            return mkPointerType(typeSubst(ctx, type.pointeeType), type.isMut);
        }
        case TypeKind.Arr: {
            return mkArrayType(typeSubst(ctx, type.elemType), type.size);
        }
        case TypeKind.Record: {
            const newArgs = type.args.map(arg => typeSubst(ctx, arg));
            return mkRecordType(type.sym, newArgs);
        }
        case TypeKind.Enum:
        case TypeKind.Bool:
        case TypeKind.Int:
        case TypeKind.Void:
        case TypeKind.Never:
        case TypeKind.RestParam:
        case TypeKind.Err: {
            return type;
        }
        default: {
            unreachable(type);
        }
    }
}

export function containsTypeParam(type: Type, params: TypeParamSym[]): boolean {
    switch (type.kind) {
        case TypeKind.TypeParam: {
            return params.includes(type.sym);
        }
        case TypeKind.Ptr: {
            return containsTypeParam(type.pointeeType, params);
        }
        case TypeKind.Arr: {
            return containsTypeParam(type.elemType, params);
        }
        case TypeKind.Record:
        case TypeKind.Enum:
        case TypeKind.Bool:
        case TypeKind.Int:
        case TypeKind.Void:
        case TypeKind.Never:
        case TypeKind.RestParam:
        case TypeKind.Err: {
            return false;
        }
        default: {
            unreachable(type);
        }
    }
}

//================================================================================
//== Type inference

export type InferCtx = {
    params: TypeParamSym[];
    args: (Type | undefined)[];
};

export function createInferCtx(params: TypeParamSym[]): InferCtx {
    return {
        params,
        args: Array(params.length).fill(undefined),
    };
}

export function tryAddInferenceConstraint(ctx: InferCtx, expected: Type, actual: Type): boolean {
    if (expected.kind === TypeKind.Err) {
        return true;
    }
    if (expected.kind === TypeKind.TypeParam) {
        const index = ctx.params.indexOf(expected.sym);
        if (index === -1) {
            return false;
        }
        const existing = ctx.args[index];
        if (existing && existing.kind !== TypeKind.Err) {
            return tryAddInferenceConstraint(ctx, existing, actual);
        } else {
            ctx.args[index] = actual;
            return true;
        }
    }
    if (expected.kind !== actual.kind) {
        return false;
    }
    switch (expected.kind) {
        case TypeKind.Ptr: {
            actual = actual as PointerType;
            return tryAddInferenceConstraint(ctx, expected.pointeeType, actual.pointeeType);
        }
        case TypeKind.Arr: {
            actual = actual as ArrayType;
            return tryAddInferenceConstraint(ctx, expected.elemType, actual.elemType);
        }
        case TypeKind.Int: {
            actual = actual as IntType;
            return expected.size === actual.size;
        }
        case TypeKind.Record: {
            actual = actual as RecordType;
            if (expected.sym !== actual.sym) {
                return false;
            }
            for (const [arg, param] of stream(expected.args).zipLongest(actual.args)) {
                if (!arg || !param || !tryAddInferenceConstraint(ctx, arg, param)) {
                    return false;
                }
            }
            return true;
        }
        case TypeKind.Enum: {
            actual = actual as EnumType;
            return expected.sym === actual.sym;
        }
        case TypeKind.Bool:
        case TypeKind.Void:
        case TypeKind.Never:
        case TypeKind.RestParam: {
            return true;
        }
        default: {
            unreachable(expected);
        }
    }
}

export function tryFinishInference(ctx: InferCtx): boolean {
    for (let i = 0; i < ctx.params.length; i++) {
        const arg = ctx.args[i];
        if (!arg) {
            return false;
        }
        if (containsTypeParam(arg, ctx.params)) {
            return false;
        }
    }
    return true;
}

//================================================================================
//== Type printing

export function prettyType(t: Type): string {
    switch (t.kind) {
        case TypeKind.Void: return 'Void';
        case TypeKind.Bool: return 'Bool';
        case TypeKind.Int: return `Int${t.size ?? ''}`;
        case TypeKind.Ptr: return '*' + (t.isMut ? 'mut ' : '') + prettyType(t.pointeeType);
        case TypeKind.Arr: return `[${prettyType(t.elemType)}; ${t.size ?? '?'}]`;
        case TypeKind.Record: return t.sym.name + prettyTypeArgs(t.args);
        case TypeKind.Enum:
        case TypeKind.TypeParam: return t.sym.name;
        case TypeKind.Never: return '!';
        case TypeKind.RestParam: return '...';
        case TypeKind.Err: return '{unknown}';
    }
}

function prettyTypeArgs(args: readonly Type[]): string {
    if (args.length === 0) {
        return '';
    }
    return '<' + args.map(prettyType).join(', ') + '>';
}
