// Node types

import { SyntaxNode } from '../syntax';

export enum TopLevelNodeType {
    Include = "include_decl",
    Enum = "enum_decl",
    Struct = "struct_decl",
    Func = "func_decl",
    Global = "global_decl",
    Const = "const_decl"
}

export enum TypeNodeType {
    GroupedType = "grouped_type",
    NameType = "name_type",
    PointerType = "pointer_type",
    ArrayType = "array_type"
}

export enum StmtNodeType {
    BlockStmt = "block_stmt",
    LocalDecl = "local_decl",
    IfStmt = "if_stmt",
    WhileStmt = "while_stmt",
    ReturnStmt = "return_stmt",
    BreakStmt = "break_stmt",
    ContinueStmt = "continue_stmt",
    ExprStmt = "expr_stmt",
}

export enum ExprNodeType {
    GroupedExpr = "grouped_expr",
    NameExpr = "name_expr",
    SizeofExpr = "sizeof_expr",
    LiteralExpr = "literal_expr",
    BinaryExpr = "binary_expr",
    TernaryExpr = "ternary_expr",
    UnaryExpr = "unary_expr",
    CallExpr = "call_expr",
    IndexExpr = "index_expr",
    FieldExpr = "field_expr",
    CastExpr = "cast_expr"
}

export enum LiteralNodeType {
    Bool = "bool_literal",
    Number = "number_literal",
    Char = "char_literal",
    String = "string_literal",
    Null = "null_literal",
}

export function isTopLevelNode(node: SyntaxNode): boolean {
    return Object.values(<Record<string, string>>TopLevelNodeType).includes(node.type);
}

export function isTypeNode(node: SyntaxNode): boolean {
    return Object.values(<Record<string, string>>TypeNodeType).includes(node.type);
}

export function isStmtNode(node: SyntaxNode): boolean {
    return Object.values(<Record<string, string>>StmtNodeType).includes(node.type);
}

export function isExprNode(node: SyntaxNode): boolean {
    return Object.values(<Record<string, string>>ExprNodeType).includes(node.type);
}
