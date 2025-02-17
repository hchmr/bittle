import { SyntaxNode } from '../syntax';
import { isEnumValue } from '../utils';
import { AstNodeTypes } from './generated';
import { TokenKind, tokenKinds } from './token';

export type ValuesOf<T extends Record<string, string>> = T[keyof T];

export type TopLevelNodeType = ValuesOf<typeof TopLevelNodeTypes>;
export type TypeNodeType = ValuesOf<typeof TypeNodeTypes>;
export type StmtNodeType = ValuesOf<typeof StmtNodeTypes>;
export type ExprNodeType = ValuesOf<typeof ExprNodeTypes>;
export type LiteralNodeType = ValuesOf<typeof LiteralNodeTypes>;
export type ErrorNodeType = 'Error';
export type TokenNodeType = ValuesOf<typeof TokenNodeTypes>;
export type CompositeNodeType = ValuesOf<typeof CompositeNodeTypes>;
export type NodeType = ValuesOf<typeof NodeTypes> | ErrorNodeType;

export const TopLevelNodeTypes = {
    Include: AstNodeTypes.IncludeDecl,
    Enum: AstNodeTypes.EnumDecl,
    Record: AstNodeTypes.RecordDecl,
    Func: AstNodeTypes.FuncDecl,
    Global: AstNodeTypes.GlobalDecl,
    Const: AstNodeTypes.ConstDecl,
} as const;

export const TypeNodeTypes = {
    GroupedType: AstNodeTypes.GroupedType,
    NameType: AstNodeTypes.NameType,
    PointerType: AstNodeTypes.PointerType,
    ArrayType: AstNodeTypes.ArrayType,
    NeverType: AstNodeTypes.NeverType,
    RestParamTypeNode: AstNodeTypes.RestParamType,
} as const;

export const StmtNodeTypes = {
    BlockStmt: AstNodeTypes.BlockStmt,
    LocalDecl: AstNodeTypes.LocalDecl,
    IfStmt: AstNodeTypes.IfStmt,
    WhileStmt: AstNodeTypes.WhileStmt,
    ForStmt: AstNodeTypes.ForStmt,
    ReturnStmt: AstNodeTypes.ReturnStmt,
    BreakStmt: AstNodeTypes.BreakStmt,
    ContinueStmt: AstNodeTypes.ContinueStmt,
    ExprStmt: AstNodeTypes.ExprStmt,
} as const;

export const ExprNodeTypes = {
    GroupedExpr: AstNodeTypes.GroupedExpr,
    NameExpr: AstNodeTypes.NameExpr,
    SizeofExpr: AstNodeTypes.SizeofExpr,
    LiteralExpr: AstNodeTypes.LiteralExpr,
    ArrayExpr: AstNodeTypes.ArrayExpr,
    BinaryExpr: AstNodeTypes.BinaryExpr,
    TernaryExpr: AstNodeTypes.TernaryExpr,
    UnaryExpr: AstNodeTypes.UnaryExpr,
    CallExpr: AstNodeTypes.CallExpr,
    IndexExpr: AstNodeTypes.IndexExpr,
    FieldExpr: AstNodeTypes.FieldExpr,
    CastExpr: AstNodeTypes.CastExpr,
    RecordExpr: AstNodeTypes.RecordExpr,
} as const;

export const LiteralNodeTypes = {
    Bool: AstNodeTypes.BoolLiteral,
    Number: AstNodeTypes.IntLiteral,
    Char: AstNodeTypes.CharLiteral,
    String: AstNodeTypes.StringLiteral,
    Null: AstNodeTypes.NullLiteral,
} as const;

export const CompositeNodeTypes = {
    ...AstNodeTypes,
    'Error': 'Error',
} as const;

export const TokenNodeTypes: Record<TokenKind, TokenKind> =
    Object.freeze(
        Object.fromEntries(tokenKinds.map(kind => [kind, kind])),
    ) as Record<TokenKind, TokenKind>;

export const NodeTypes = Object.freeze({
    ...CompositeNodeTypes,
    ...TokenNodeTypes,
});

export function isTopLevelNode(node: SyntaxNode): boolean {
    return isEnumValue(TopLevelNodeTypes, node.type);
}

export function isTypeNode(node: SyntaxNode): boolean {
    return isEnumValue(TypeNodeTypes, node.type);
}

export function isStmtNode(node: SyntaxNode): boolean {
    return isEnumValue(StmtNodeTypes, node.type);
}

export function isExprNode(node: SyntaxNode): boolean {
    return isEnumValue(ExprNodeTypes, node.type);
}

export function isArgNode(node: SyntaxNode): boolean {
    return node.type === CompositeNodeTypes.CallArg;
}
