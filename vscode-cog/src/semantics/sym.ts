import assert from 'assert';
import { SyntaxNode } from '../syntax';
import { stream } from '../utils/stream';
import { mkIntType, mkStructType, prettyType, tryUnifyTypes, Type, TypeKind } from './type';

export enum SymKind {
    Struct,
    StructField,
    Func,
    FuncParam,
    Global,
    Const,
    Local,
}

export type Sym =
    | StructSym
    | StructFieldSym
    | FuncSym
    | FuncParamSym
    | GlobalSym
    | ConstSym
    | LocalSym;

type SymBase = {
    kind: SymKind;
    name: string;
    qualifiedName: string;
    origins: Origin[];
};

export type StructSym = SymBase & {
    kind: SymKind.Struct;
    fields?: StructFieldSym[];
};

export type StructFieldSym = SymBase & {
    kind: SymKind.StructField;
    type: Type;
};

export type FuncSym = SymBase & {
    kind: SymKind.Func;
    params: FuncParamSym[];
    returnType: Type;
    isVariadic: boolean;
    isDefined: boolean;
};

export type FuncParamSym = SymBase & {
    kind: SymKind.FuncParam;
    type: Type;
};

export type GlobalSym = SymBase & {
    kind: SymKind.Global;
    isDefined: boolean;
    type: Type;
};

export type ConstSym = SymBase & {
    kind: SymKind.Const;
    value: number | undefined;
};

export type LocalSym = SymBase & {
    kind: SymKind.Local;
    type: Type;
};

export type Origin = {
    file: string;
    node: SyntaxNode;
    nameNode?: SyntaxNode;
};

export function symRelatedType(sym: Sym): Type {
    if (sym.kind === SymKind.Struct) {
        return mkStructType(sym.name, sym.qualifiedName);
    } else if (sym.kind === SymKind.StructField) {
        return sym.type;
    } else if (sym.kind === SymKind.Func) {
        return sym.returnType;
    } else if (sym.kind === SymKind.Global) {
        return sym.type;
    } else if (sym.kind === SymKind.Local) {
        return sym.type;
    } else if (sym.kind === SymKind.Const) {
        return mkIntType(64);
    } else if (sym.kind === SymKind.FuncParam) {
        return sym.type;
    } else {
        const never: never = sym;
        throw new Error(`Unexpected symbol kind: ${never}`);
    }
}

export function prettySym(sym: Sym): string {
    if (sym.kind === SymKind.Struct) {
        return `struct ${sym.name}`;
    } else if (sym.kind === SymKind.StructField) {
        return `(field) ${sym.name}: ${prettyType(sym.type)}`;
    } else if (sym.kind === SymKind.Func) {
        const params = sym.params.map(p => `${p.name}: ${prettyType(p.type)}`).join(', ');
        const dots = sym.isVariadic ? sym.params.length ? ', ...' : '...' : '';
        const returnType = prettyType(sym.returnType);
        return `func ${sym.name}(${params}${dots}): ${returnType}`;
    } else if (sym.kind === SymKind.Global) {
        const externModifier = sym.isDefined ? '' : 'extern ';
        return `${externModifier}var ${sym.name}: ${prettyType(sym.type)}`;
    } else if (sym.kind === SymKind.Local) {
        return `var ${sym.name}: ${prettyType(sym.type)}`;
    } else if (sym.kind === SymKind.Const) {
        return `const ${sym.name}: ${prettyType(symRelatedType(sym)!)} = ${sym.value}`;
    } else if (sym.kind === SymKind.FuncParam) {
        return `(parameter) ${sym.name}: ${prettyType(sym.type)}`;
    } else {
        const unreachable: never = sym;
        return unreachable;
    }
}

//================================================================================
//== Symbol merging

type ErrorSignal = () => void;

export function tryMergeSym(existing: Sym, sym: Sym): [sym: Sym, err: boolean] {
    assert(existing.name === sym.name);
    assert(existing.kind === sym.kind);

    let err = false;
    const onError = () => {
        err = true;
    };

    const merged = (() => {
        switch (existing.kind) {
            case SymKind.Struct:
                return tryMergeStructSym(existing, <StructSym>sym, onError);
            case SymKind.Func:
                return tryMergeFuncSym(existing, <FuncSym>sym, onError);
            case SymKind.Global:
                return tryMergeGlobalSym(existing, <GlobalSym>sym, onError);
            case SymKind.Const:
                return tryMergeConstSym(existing, <ConstSym>sym, onError);
            case SymKind.StructField:
                return tryMergeStructFieldSym(existing, <StructFieldSym>sym, onError);
            case SymKind.FuncParam:
                return tryMergeFuncParamSym(existing, <FuncParamSym>sym, onError);
            case SymKind.Local:
                return tryMergeLocalSym(existing, <LocalSym>sym, onError);
            default: {
                const unreachable: never = existing;
                throw new Error(`Unexpected symbol kind: ${unreachable}`);
            }
        }
    })();

    return [merged, err];
}

export function tryMergeStructSym(existing: StructSym, sym: StructSym, onError: ErrorSignal): StructSym {
    return {
        kind: SymKind.Struct,
        name: existing.name,
        qualifiedName: existing.qualifiedName,
        origins: mergeOrigins(existing.origins, sym.origins),
        fields: tryMergeStructFields(existing, sym, onError),
    };

    function tryMergeStructFields(existing: StructSym, sym: StructSym, onError: ErrorSignal): StructFieldSym[] | undefined {
        if (!existing.fields || !sym.fields) {
            return existing.fields || sym.fields;
        }

        onError();
        return stream(existing.fields).concat(sym.fields)
            .groupBy(field => field.name)
            .map(([_, fields]) => fields.reduce((a, b) => tryMergeStructFieldSym(a, b, () => { })))
            .toArray();
    }
}

export function tryMergeStructFieldSym(field1: StructFieldSym, field2: StructFieldSym, onError: ErrorSignal): StructFieldSym {
    return {
        kind: SymKind.StructField,
        name: field1.name,
        qualifiedName: field1.qualifiedName,
        origins: mergeOrigins(field1.origins, field2.origins),
        type: tryUnifyTypes(field1.type, field2.type, onError),
    };
}

export function tryMergeFuncSym(existing: FuncSym, sym: FuncSym, onError: ErrorSignal): FuncSym {
    return {
        kind: SymKind.Func,
        name: existing.name,
        qualifiedName: existing.qualifiedName,
        origins: mergeOrigins(existing.origins, sym.origins),
        params: tryMergeFuncParams(existing.params, sym.params, onError),
        returnType: tryUnifyTypes(existing.returnType, sym.returnType, onError),
        isVariadic: tryMergeIsVariadic(),
        isDefined: tryMergeIsDefined(),
    };

    function tryMergeIsVariadic(): boolean {
        if (existing.isVariadic !== sym.isVariadic) {
            onError();
        }
        return existing.isVariadic || sym.isVariadic;
    }

    function tryMergeIsDefined(): boolean {
        if (existing.isDefined && sym.isDefined) {
            onError();
        }
        return existing.isDefined || sym.isDefined;
    }
}

export function tryMergeFuncParams(params1: FuncParamSym[], params2: FuncParamSym[], onError: ErrorSignal): FuncParamSym[] {
    if (params1.length !== params2.length) {
        onError();
    }
    return stream(params1).zipLongest(params2)
        .map(([p1, p2]) => p1 && p2 ? tryMergeFuncParamSym(p1, p2, onError) : p1 || p2)
        .toArray();
}

export function tryMergeFuncParamSym(param1: FuncParamSym, param2: FuncParamSym, onError: ErrorSignal): FuncParamSym {
    return {
        kind: SymKind.FuncParam,
        name: param1.name === param2.name ? param1.name : '{unknown}',
        qualifiedName: param1.qualifiedName,
        origins: mergeOrigins(param1.origins, param2.origins),
        type: tryUnifyTypes(param1.type, param2.type, onError),
    };
}

export function tryMergeGlobalSym(existing: GlobalSym, sym: GlobalSym, onError: ErrorSignal): GlobalSym {
    if (existing.isDefined && sym.isDefined) {
        onError();
    }
    return {
        kind: SymKind.Global,
        name: existing.name,
        qualifiedName: existing.qualifiedName,
        origins: mergeOrigins(existing.origins, sym.origins),
        type: tryUnifyTypes(existing.type, sym.type, onError),
        isDefined: existing.isDefined || sym.isDefined,
    };
}

export function tryMergeConstSym(existing: ConstSym, sym: ConstSym, onError: ErrorSignal): ConstSym {
    return {
        kind: SymKind.Const,
        name: existing.name,
        qualifiedName: existing.qualifiedName,
        origins: mergeOrigins(existing.origins, sym.origins),
        value: mergeValue(existing.value, sym.value),
    };

    function mergeValue(x1: number | undefined, x2: number | undefined): number | undefined {
        if (x1 !== undefined && x2 !== undefined && x1 !== x2) {
            onError();
        }
        x1 ??= x2;
        x2 ??= x1;
        return x1 === x2 ? x1 : undefined;
    }
}

export function tryMergeLocalSym(existing: LocalSym, sym: LocalSym, onError: ErrorSignal): LocalSym {
    onError();
    return {
        kind: SymKind.Local,
        name: existing.name,
        qualifiedName: existing.qualifiedName,
        origins: mergeOrigins(existing.origins, sym.origins),
        type: tryUnifyTypes(existing.type, sym.type, onError),
    };
}

// Should be good enough for now. It's only structs that add the same symbol twice.
function mergeOrigins(origins1: Origin[], origins2: Origin[]): Origin[] {
    return origins1 === origins2 ? origins1 : [...origins1, ...origins2];
}
