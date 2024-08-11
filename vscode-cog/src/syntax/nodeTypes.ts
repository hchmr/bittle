import { SyntaxNode } from '../syntax';
import { TokenKind, tokenKinds } from './token';

export type ValuesOf<T extends Record<string, string>> = T[keyof T];

export type TopLevelNodeType = ValuesOf<typeof TopLevelNodeTypes>;
export type TypeNodeType = ValuesOf<typeof TypeNodeTypes>;
export type StmtNodeType = ValuesOf<typeof StmtNodeTypes>;
export type ExprNodeType = ValuesOf<typeof ExprNodeTypes>;
export type LiteralNodeType = ValuesOf<typeof LiteralNodeTypes>;
export type ErrorNodeType = typeof NodeTypes.Error;
export type TokenNodeType = ValuesOf<typeof TokenNodeTypes>;
export type CompositeNodeType = ValuesOf<typeof CompositeNodeTypes>;
export type NodeType = ValuesOf<typeof NodeTypes>;

export const TopLevelNodeTypes = {
    Include: 'include_decl',
    Enum: 'enum_decl',
    Struct: 'struct_decl',
    Func: 'func_decl',
    Global: 'global_decl',
    Const: 'const_decl',
} as const;

export const TypeNodeTypes = {
    GroupedType: 'grouped_type',
    NameType: 'name_type',
    PointerType: 'pointer_type',
    ArrayType: 'array_type',
    NeverType: 'never_type',
} as const;

export const StmtNodeTypes = {
    BlockStmt: 'block_stmt',
    LocalDecl: 'local_decl',
    IfStmt: 'if_stmt',
    WhileStmt: 'while_stmt',
    ForStmt: 'for_stmt',
    ReturnStmt: 'return_stmt',
    BreakStmt: 'break_stmt',
    ContinueStmt: 'continue_stmt',
    ExprStmt: 'expr_stmt',
} as const;

export const ExprNodeTypes = {
    GroupedExpr: 'grouped_expr',
    NameExpr: 'name_expr',
    SizeofExpr: 'sizeof_expr',
    LiteralExpr: 'literal_expr',
    BinaryExpr: 'binary_expr',
    TernaryExpr: 'ternary_expr',
    UnaryExpr: 'unary_expr',
    CallExpr: 'call_expr',
    IndexExpr: 'index_expr',
    FieldExpr: 'field_expr',
    CastExpr: 'cast_expr',
} as const;

export const LiteralNodeTypes = {
    Bool: 'bool_literal',
    Number: 'number_literal',
    Char: 'char_literal',
    String: 'string_literal',
    Null: 'null_literal',
} as const;

export const CompositeNodeTypes = {
    // Root
    Root: 'root',
    // Top-level declarations
    IncludeDecl: TopLevelNodeTypes.Include,
    EnumDecl: TopLevelNodeTypes.Enum,
    EnumBody: 'enum_body',
    EnumMember: 'enum_member',
    StructDecl: TopLevelNodeTypes.Struct,
    StructBody: 'struct_body',
    StructMember: 'struct_member',
    FuncDecl: TopLevelNodeTypes.Func,
    FuncParam: 'param_decl',
    VariadicParam: 'variadic_param',
    GlobalDecl: TopLevelNodeTypes.Global,
    ConstDecl: TopLevelNodeTypes.Const,
    // Statements
    ...StmtNodeTypes,
    // Expressions
    ...ExprNodeTypes,
    CallArgList: 'call_arg_list',
    CallArg: 'call_arg',
    // Types
    ...TypeNodeTypes,
    // Literals
    IntLiteral: LiteralNodeTypes.Number,
    CharLiteral: LiteralNodeTypes.Char,
    StringLiteral: LiteralNodeTypes.String,
    BoolLiteral: LiteralNodeTypes.Bool,
    NullLiteral: LiteralNodeTypes.Null,
    // Error
    Error: 'error',
} as const;

export const TokenNodeTypes: Record<TokenKind, TokenKind>
    = <Record<TokenKind, TokenKind>>Object.freeze(
        Object.fromEntries(tokenKinds.map(kind => [kind, kind])),
    );

export const NodeTypes = Object.freeze({
    ...CompositeNodeTypes,
    ...TokenNodeTypes,
});

// TODO: Temporary measure to match the tree-sitter grammar
export const NamedTokenKinds: Partial<Record<TokenKind, NodeType>>
 = Object.freeze({
     'true': LiteralNodeTypes.Bool,
     'false': LiteralNodeTypes.Bool,
     'char_literal': LiteralNodeTypes.Char,
     'identifier': TokenNodeTypes['identifier'],
     'null': LiteralNodeTypes.Null,
     'number_literal': LiteralNodeTypes.Number,
     'string_literal': LiteralNodeTypes.String,
     '...': CompositeNodeTypes.VariadicParam,
 });

export function isTopLevelNode(node: SyntaxNode): boolean {
    return Object.values(<Record<string, string>>TopLevelNodeTypes).includes(node.type);
}

export function isTypeNode(node: SyntaxNode): boolean {
    return Object.values(<Record<string, string>>TypeNodeTypes).includes(node.type);
}

export function isStmtNode(node: SyntaxNode): boolean {
    return Object.values(<Record<string, string>>StmtNodeTypes).includes(node.type);
}

export function isExprNode(node: SyntaxNode): boolean {
    return Object.values(<Record<string, string>>ExprNodeTypes).includes(node.type);
}

export function isArgNode(node: SyntaxNode): boolean {
    return node.type === CompositeNodeTypes.CallArg;
}
