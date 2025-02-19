import { SyntaxNode } from '../syntax';
import { unreachable } from '../utils';
import { ConstValue, ConstValueKind } from './const';
import { mkEnumType, mkErrorType, mkRecordType, prettyType, Type } from './type';

export enum SymKind {
    Record = 'Record',
    RecordField = 'RecordField',
    Enum = 'Enum',
    Func = 'Func',
    FuncParam = 'FuncParam',
    Global = 'Global',
    Const = 'Const',
    Local = 'Local',
}

export enum RecordKind {
    Struct = 'struct',
    Union = 'union',
}

export type Sym =
    | RecordSym
    | RecordFieldSym
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

export type RecordSym = SymBase & {
    kind: SymKind.Record;
    recordKind: RecordKind;
    base: RecordSym | undefined;
    fields: RecordFieldSym[];
    isDefined: boolean;
};

export type RecordFieldSym = SymBase & {
    kind: SymKind.RecordField;
    type: Type;
    defaultValue: ConstValue | undefined;
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
    value: ConstValue | undefined;
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
    if (sym.kind === SymKind.Record || sym.kind === SymKind.Func || sym.kind === SymKind.Global) {
        return sym.isDefined;
    } else {
        return true;
    }
}

export function symRelatedType(sym: Sym): Type {
    if (sym.kind === SymKind.Record) {
        return mkRecordType(sym);
    } else if (sym.kind === SymKind.RecordField) {
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
        return sym.value?.type ?? mkErrorType();
    } else if (sym.kind === SymKind.FuncParam) {
        return sym.type;
    } else {
        unreachable(sym);
    }
}

export function prettySym(sym: Sym): string {
    if (sym.kind === SymKind.Enum) {
        return `enum ${sym.name}`;
    } else if (sym.kind === SymKind.Record) {
        const keyword = sym.recordKind === RecordKind.Struct ? 'struct' : 'union';
        return `${keyword} ${sym.name}${prettyBase(sym)}`;
    } else if (sym.kind === SymKind.RecordField) {
        const defaultValue = sym.defaultValue !== undefined ? ` = ${prettyConstValue(sym.defaultValue)}` : '';
        return `(field) ${sym.name}: ${prettyType(sym.type)}${defaultValue}`;
    } else if (sym.kind === SymKind.Func) {
        return `func ${prettyFuncSym(sym)}`;
    } else if (sym.kind === SymKind.Global) {
        const externModifier = sym.isDefined ? '' : 'extern ';
        return `${externModifier}var ${sym.name}: ${prettyType(sym.type)}`;
    } else if (sym.kind === SymKind.Local) {
        return `var ${sym.name}: ${prettyType(sym.type)}`;
    } else if (sym.kind === SymKind.Const) {
        const value = sym.value !== undefined ? prettyConstValue(sym.value) : '{unknown}';
        return `const ${sym.name}: ${prettyType(symRelatedType(sym))} = ${value}`;
    } else if (sym.kind === SymKind.FuncParam) {
        return `(parameter) ${sym.name}: ${prettyType(sym.type)}`;
    } else {
        unreachable(sym);
    }
}

export function prettyFuncSym(sym: FuncSym): string {
    const params = sym.params.map(p => `${p.name}: ${prettyType(p.type)}`).join(', ');
    const dots = sym.isVariadic ? sym.params.length ? ', ...' : '...' : '';
    const returnType = prettyType(sym.returnType);
    return `${sym.name}(${params}${dots}): ${returnType}`;
}

export function prettyRecordWithFields(sym: RecordSym): string {
    const fields = sym.fields.map(f => `${f.name}: ${prettyType(f.type)}`).join(', ');
    return `${sym.name} { ${fields} }`;
}

function prettyBase(sym: RecordSym) {
    return sym.base ? `: ${sym.base.name}` : '';
}

function prettyConstValue(value: ConstValue): string {
    if (value.kind === ConstValueKind.Bool) {
        return value.value ? 'true' : 'false';
    } else if (value.kind === ConstValueKind.Int) {
        return value.value.toString();
    } else if (value.kind === ConstValueKind.String) {
        return JSON.stringify(value.value);
    } else {
        return unreachable(value);
    }
}
