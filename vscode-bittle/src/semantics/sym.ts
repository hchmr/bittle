import { SyntaxNode } from '../syntax';
import { mkEnumType, mkIntType, mkStructType, prettyType, Type } from './type';

export enum SymKind {
    Struct = 'Struct',
    StructField = 'StructField',
    Enum = 'Enum',
    Func = 'Func',
    FuncParam = 'FuncParam',
    Global = 'Global',
    Const = 'Const',
    Local = 'Local',
}

export type Sym =
    | StructSym
    | StructFieldSym
    | EnumSym
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

export type EnumSym = SymBase & {
    kind: SymKind.Enum;
    size: number;
};

export type StructSym = SymBase & {
    kind: SymKind.Struct;
    base: StructSym | undefined;
    fields: StructFieldSym[];
    isDefined: boolean;
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
    type: Type;
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
    isForwardDecl: boolean;
};

export function isDefined(sym: Sym): boolean {
    if (sym.kind === SymKind.Struct || sym.kind === SymKind.Func || sym.kind === SymKind.Global) {
        return sym.isDefined;
    } else {
        return true;
    }
}

export function symRelatedType(sym: Sym): Type {
    if (sym.kind === SymKind.Struct) {
        return mkStructType(sym);
    } else if (sym.kind === SymKind.StructField) {
        return sym.type;
    } else if (sym.kind === SymKind.Enum) {
        return mkEnumType(sym);
    } else if (sym.kind === SymKind.Func) {
        return sym.returnType;
    } else if (sym.kind === SymKind.Global) {
        return sym.type;
    } else if (sym.kind === SymKind.Local) {
        return sym.type;
    } else if (sym.kind === SymKind.Const) {
        return sym.type!;
    } else if (sym.kind === SymKind.FuncParam) {
        return sym.type;
    } else {
        const never: never = sym;
        throw new Error(`Unexpected symbol kind: ${never}`);
    }
}

export function prettySym(sym: Sym): string {
    if (sym.kind === SymKind.Enum) {
        return `enum ${sym.name}`;
    } else if (sym.kind === SymKind.Struct) {
        return `struct ${sym.name}${prettyBase(sym)}`;
    } else if (sym.kind === SymKind.StructField) {
        return `(field) ${sym.name}: ${prettyType(sym.type)}`;
    } else if (sym.kind === SymKind.Func) {
        return `func ${prettyCallableSym(sym)}`;
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

export function prettyCallableSym(sym: FuncSym | StructSym): string {
    if (sym.kind === SymKind.Func) {
        const params = sym.params.map(p => `${p.name}: ${prettyType(p.type)}`).join(', ');
        const dots = sym.isVariadic ? sym.params.length ? ', ...' : '...' : '';
        const returnType = prettyType(sym.returnType);
        return `${sym.name}(${params}${dots}): ${returnType}`;
    } else if (sym.kind === SymKind.Struct) {
        const params = sym.fields.map(f => `${f.name}: ${prettyType(f.type)}`).join(', ') || '';
        return `${sym.name}(${params})`;
    } else {
        const unreachable: never = sym;
        return unreachable;
    }
}

function prettyBase(sym: StructSym) {
    return sym.base ? `: ${sym.base.name}` : '';
}
