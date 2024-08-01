import { TokenKind } from "./token";

export enum CompositeNodeKind {
    // Root
    Root = 'root',
    // Top-level declarations
    IncludeDecl = 'include_decl',
    EnumDecl = 'enum_decl',
    EnumBody = 'enum_body',
    EnumMember = 'enum_member',
    StructDecl = 'struct_decl',
    StructBody = 'struct_body',
    StructMember = 'struct_member',
    FuncDecl = 'func_decl',
    FuncParam = 'param_decl',
    GlobalDecl = 'global_decl',
    ConstDecl = 'const_decl',
    // Statements
    BlockStmt = 'block_stmt',
    VarStmt = 'local_decl',
    IfStmt = 'if_stmt',
    WhileStmt = 'while_stmt',
    ReturnStmt = 'return_stmt',
    BreakStmt = 'break_stmt',
    ContinueStmt = 'continue_stmt',
    ExprStmt = 'expr_stmt',
    // Expressions
    GroupExpr = 'grouped_expr',
    NameExpr = 'name_expr',
    LiteralExpr = 'literal_expr',
    UnaryExpr = 'unary_expr',
    BinaryExpr = 'binary_expr',
    TernaryExpr = 'ternary_expr',
    CallExpr = 'call_expr',
    IndexExpr = 'index_expr',
    FieldExpr = 'field_expr',
    CastExpr = 'cast_expr',
    SizeofExpr = 'sizeof_expr',
    // Types
    GroupType = 'grouped_type',
    NameType = 'name_type',
    PointerType = 'pointer_type',
    ArrayType = 'array_type',
    // Literals
    IntLiteral = 'number_literal',
    StringLiteral = 'string_literal',
    CharLiteral = 'char_literal',
    BoolLiteral = 'bool_literal',
    NullLiteral = 'null_literal',
    // Error
    Error = 'error',
}

// TODO: Temporary measure to match the tree-sitter grammar
export const namedTokenKinds: { [key in TokenKind]?: string } = Object.freeze({
    'true': 'bool_literal',
    'false': 'bool_literal',
    'char_literal': 'char_literal',
    'identifier': 'identifier',
    'null': 'null_literal',
    'number_literal': 'number_literal',
    'string_literal': 'string_literal',
    '...': 'variadic_param',
});
