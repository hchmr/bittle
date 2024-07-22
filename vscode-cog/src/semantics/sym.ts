import { SyntaxNode } from "tree-sitter";
import { prettyType, Type } from "./type";

export type Symbol =
    | StructSymbol
    | StructFieldSymbol
    | FuncSymbol
    | FuncParamSymbol
    | GlobalSymbol
    | LocalSymbol
    | ConstSymbol
    ;

export type SymbolType = Symbol["kind"];

type DefineSymbol<T extends { kind: string }> = T & {
    name: string;
    origins: Origin[];
}

export type StructSymbol = DefineSymbol<{
    kind: "struct";
    fields: StructFieldSymbol[] | undefined;
}>

export type StructFieldSymbol = DefineSymbol<{
    kind: "struct_field";
    type: Type;
}>

export type FuncSymbol = DefineSymbol<{
    kind: "func";
    returnType: Type;
    params: FuncParamSymbol[];
    isVariadic: boolean;
}>

export type FuncParamSymbol = DefineSymbol<{
    kind: "func_param";
    type: Type;
}>

export type GlobalSymbol = DefineSymbol<{
    kind: "global";
    type: Type;
    isExtern: boolean;
}>

export type LocalSymbol = DefineSymbol<{
    kind: "local";
    type: Type;
}>

export type ConstSymbol = DefineSymbol<{
    kind: "const";
    value: number | undefined;
}>

export type Origin = {
    file: string;
    node: SyntaxNode;
    nameNode?: SyntaxNode;
}

export function valueSymbolType(symbol: Symbol): Type {
    if (symbol.kind === "func") {
        return symbol.returnType;
    } else if (symbol.kind === "global") {
        return symbol.type;
    } else if (symbol.kind === "local") {
        return symbol.type;
    } else if (symbol.kind === "const") {
        return { kind: "int", size: 64 };
    } else if (symbol.kind === "func_param") {
        return symbol.type;
    } else {
        throw new Error(`Unreachable: ${symbol.kind}`);
    }
}

export function prettySymbol(symbol: Symbol): string {
    if (symbol.kind === "struct") {
        return `struct ${symbol.name}`;
    } else if (symbol.kind === "struct_field") {
        return `(field) ${symbol.name}: ${prettyType(symbol.type)}`;
    } else if (symbol.kind === "func") {
        const params = symbol.params.map(p => `${p.name}: ${prettyType(p.type)}`).join(", ");
        const dots = symbol.isVariadic ? symbol.params.length ? ", ..." : "..." : "";
        const returnType = prettyType(symbol.returnType);
        return `func ${symbol.name}(${params}${dots}): ${returnType}`;
    } else if (symbol.kind === "global") {
        const externModifier = symbol.isExtern ? "extern " : "";
        return `${externModifier}var ${symbol.name}: ${prettyType(symbol.type)}`;
    } else if (symbol.kind === "local") {
        return `var ${symbol.name}: ${prettyType(symbol.type)}`;
    } else if (symbol.kind === "const") {
        return `const ${symbol.name}: ${prettyType(valueSymbolType(symbol))} = ${symbol.value}`;
    } else if (symbol.kind === "func_param") {
        return `(parameter) ${symbol.name}: ${prettyType(symbol.type)}`;
    } else {
        const unreachable: never = symbol;
        return unreachable;
    }
}
