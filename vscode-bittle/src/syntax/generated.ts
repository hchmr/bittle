/* eslint-disable @stylistic/lines-between-class-members */
import { AstNode, TokenNode } from './ast';
import { SyntaxNode } from './tree';

//==============================================================================
//== Node types

export enum AstNodeTypes {
    Root = 'Root',
    IncludeDecl = 'IncludeDecl',
    EnumDecl = 'EnumDecl',
    EnumBody = 'EnumBody',
    EnumMember = 'EnumMember',
    RecordDecl = 'RecordDecl',
    RecordBody = 'RecordBody',
    Field = 'Field',
    FuncDecl = 'FuncDecl',
    FuncParamList = 'FuncParamList',
    NormalFuncParam = 'NormalFuncParam',
    RestFuncParam = 'RestFuncParam',
    GlobalDecl = 'GlobalDecl',
    ConstDecl = 'ConstDecl',
    GroupedType = 'GroupedType',
    NameType = 'NameType',
    PointerType = 'PointerType',
    ArrayType = 'ArrayType',
    NeverType = 'NeverType',
    RestParamType = 'RestParamType',
    BlockStmt = 'BlockStmt',
    LocalDecl = 'LocalDecl',
    IfStmt = 'IfStmt',
    WhileStmt = 'WhileStmt',
    ForStmt = 'ForStmt',
    ReturnStmt = 'ReturnStmt',
    BreakStmt = 'BreakStmt',
    ContinueStmt = 'ContinueStmt',
    ExprStmt = 'ExprStmt',
    GroupedExpr = 'GroupedExpr',
    NameExpr = 'NameExpr',
    SizeofExpr = 'SizeofExpr',
    LiteralExpr = 'LiteralExpr',
    ArrayExpr = 'ArrayExpr',
    CallExpr = 'CallExpr',
    CallArgList = 'CallArgList',
    CallArg = 'CallArg',
    BinaryExpr = 'BinaryExpr',
    UnaryExpr = 'UnaryExpr',
    TernaryExpr = 'TernaryExpr',
    IndexExpr = 'IndexExpr',
    FieldExpr = 'FieldExpr',
    CastExpr = 'CastExpr',
    RecordExpr = 'RecordExpr',
    FieldInitList = 'FieldInitList',
    FieldInit = 'FieldInit',
    BoolLiteral = 'BoolLiteral',
    NullLiteral = 'NullLiteral',
    IntLiteral = 'IntLiteral',
    CharLiteral = 'CharLiteral',
    StringLiteral = 'StringLiteral',
}

export type AstNodeType = AstNodeTypes[keyof AstNodeTypes];

export class RootNode extends AstNode {
    get declNodes(): DeclNode[] {
        return this.getAstNodesOfType<DeclNode>(undefined, ['IncludeDecl', 'EnumDecl', 'RecordDecl', 'FuncDecl', 'GlobalDecl', 'ConstDecl']);
    }
}
export class IncludeDeclNode extends AstNode {
    get includeToken(): TokenNode<'include'> | undefined {
        return this.getTokenOfType(undefined, ['include']);
    }
    get path(): TokenNode<'string_literal'> | undefined {
        return this.getTokenOfType('path', ['string_literal']);
    }
    get semicolonToken(): TokenNode<';'> | undefined {
        return this.getTokenOfType(undefined, [';']);
    }
}
export class EnumDeclNode extends AstNode {
    get enumToken(): TokenNode<'enum'> | undefined {
        return this.getTokenOfType(undefined, ['enum']);
    }
    get name(): TokenNode<'identifier'> | undefined {
        return this.getTokenOfType('name', ['identifier']);
    }
    get body(): EnumBodyNode | undefined {
        return this.getAstNodeOfType<EnumBodyNode>('body', ['EnumBody']);
    }
}
export class EnumBodyNode extends AstNode {
    get lBraceToken(): TokenNode<'{'> | undefined {
        return this.getTokenOfType(undefined, ['{']);
    }
    get enumMemberNodes(): EnumMemberNode[] {
        return this.getAstNodesOfType<EnumMemberNode>(undefined, ['EnumMember']);
    }
    get rBraceToken(): TokenNode<'}'> | undefined {
        return this.getTokenOfType(undefined, ['}']);
    }
}
export class EnumMemberNode extends AstNode {
    get name(): TokenNode<'identifier'> | undefined {
        return this.getTokenOfType('name', ['identifier']);
    }
    get eqToken(): TokenNode<'='> | undefined {
        return this.getTokenOfType(undefined, ['=']);
    }
    get value(): ExprNode | undefined {
        return this.getAstNodeOfType<ExprNode>('value', ['GroupedExpr', 'NameExpr', 'SizeofExpr', 'LiteralExpr', 'ArrayExpr', 'CallExpr', 'RecordExpr', 'BinaryExpr', 'TernaryExpr', 'UnaryExpr', 'IndexExpr', 'FieldExpr', 'CastExpr']);
    }
    get semicolonToken(): TokenNode<';'> | undefined {
        return this.getTokenOfType(undefined, [';']);
    }
}
export class RecordDeclNode extends AstNode {
    get structToken(): TokenNode<'struct'> | undefined {
        return this.getTokenOfType(undefined, ['struct']);
    }
    get unionToken(): TokenNode<'union'> | undefined {
        return this.getTokenOfType(undefined, ['union']);
    }
    get name(): TokenNode<'identifier'> | undefined {
        return this.getTokenOfType('name', ['identifier']);
    }
    get colonToken(): TokenNode<':'> | undefined {
        return this.getTokenOfType(undefined, [':']);
    }
    get base(): TypeNode | undefined {
        return this.getAstNodeOfType<TypeNode>('base', ['GroupedType', 'NameType', 'PointerType', 'ArrayType', 'NeverType', 'RestParamType']);
    }
    get body(): RecordBodyNode | undefined {
        return this.getAstNodeOfType<RecordBodyNode>('body', ['RecordBody']);
    }
}
export class RecordBodyNode extends AstNode {
    get lBraceToken(): TokenNode<'{'> | undefined {
        return this.getTokenOfType(undefined, ['{']);
    }
    get fieldNodes(): FieldNode[] {
        return this.getAstNodesOfType<FieldNode>(undefined, ['Field']);
    }
    get rBraceToken(): TokenNode<'}'> | undefined {
        return this.getTokenOfType(undefined, ['}']);
    }
}
export class FieldNode extends AstNode {
    get name(): TokenNode<'identifier'> | undefined {
        return this.getTokenOfType('name', ['identifier']);
    }
    get colonToken(): TokenNode<':'> | undefined {
        return this.getTokenOfType(undefined, [':']);
    }
    get type(): TypeNode | undefined {
        return this.getAstNodeOfType<TypeNode>('type', ['GroupedType', 'NameType', 'PointerType', 'ArrayType', 'NeverType', 'RestParamType']);
    }
    get eqToken(): TokenNode<'='> | undefined {
        return this.getTokenOfType(undefined, ['=']);
    }
    get value(): ExprNode | undefined {
        return this.getAstNodeOfType<ExprNode>('value', ['GroupedExpr', 'NameExpr', 'SizeofExpr', 'LiteralExpr', 'ArrayExpr', 'CallExpr', 'RecordExpr', 'BinaryExpr', 'TernaryExpr', 'UnaryExpr', 'IndexExpr', 'FieldExpr', 'CastExpr']);
    }
}
export class FuncDeclNode extends AstNode {
    get funcToken(): TokenNode<'func'> | undefined {
        return this.getTokenOfType(undefined, ['func']);
    }
    get name(): TokenNode<'identifier'> | undefined {
        return this.getTokenOfType('name', ['identifier']);
    }
    get params(): FuncParamListNode | undefined {
        return this.getAstNodeOfType<FuncParamListNode>('params', ['FuncParamList']);
    }
    get colonToken(): TokenNode<':'> | undefined {
        return this.getTokenOfType(undefined, [':']);
    }
    get returnType(): TypeNode | undefined {
        return this.getAstNodeOfType<TypeNode>('returnType', ['GroupedType', 'NameType', 'PointerType', 'ArrayType', 'NeverType', 'RestParamType']);
    }
    get body(): BlockStmtNode | undefined {
        return this.getAstNodeOfType<BlockStmtNode>('body', ['BlockStmt']);
    }
    get semicolonToken(): TokenNode<';'> | undefined {
        return this.getTokenOfType(undefined, [';']);
    }
}
export class FuncParamListNode extends AstNode {
    get lParToken(): TokenNode<'('> | undefined {
        return this.getTokenOfType(undefined, ['(']);
    }
    get funcParamNodes(): FuncParamNode[] {
        return this.getAstNodesOfType<FuncParamNode>(undefined, ['NormalFuncParam', 'RestFuncParam']);
    }
    get rParToken(): TokenNode<')'> | undefined {
        return this.getTokenOfType(undefined, [')']);
    }
}
export class NormalFuncParamNode extends AstNode {
    get name(): TokenNode<'identifier'> | undefined {
        return this.getTokenOfType('name', ['identifier']);
    }
    get colonToken(): TokenNode<':'> | undefined {
        return this.getTokenOfType(undefined, [':']);
    }
    get type(): TypeNode | undefined {
        return this.getAstNodeOfType<TypeNode>('type', ['GroupedType', 'NameType', 'PointerType', 'ArrayType', 'NeverType', 'RestParamType']);
    }
    get eqToken(): TokenNode<'='> | undefined {
        return this.getTokenOfType(undefined, ['=']);
    }
    get value(): ExprNode | undefined {
        return this.getAstNodeOfType<ExprNode>('value', ['GroupedExpr', 'NameExpr', 'SizeofExpr', 'LiteralExpr', 'ArrayExpr', 'CallExpr', 'RecordExpr', 'BinaryExpr', 'TernaryExpr', 'UnaryExpr', 'IndexExpr', 'FieldExpr', 'CastExpr']);
    }
}
export class RestFuncParamNode extends AstNode {
    get dotDotDotToken(): TokenNode<'...'> | undefined {
        return this.getTokenOfType(undefined, ['...']);
    }
    get name(): TokenNode<'identifier'> | undefined {
        return this.getTokenOfType('name', ['identifier']);
    }
}
export class GlobalDeclNode extends AstNode {
    get externToken(): TokenNode<'extern'> | undefined {
        return this.getTokenOfType(undefined, ['extern']);
    }
    get varToken(): TokenNode<'var'> | undefined {
        return this.getTokenOfType(undefined, ['var']);
    }
    get name(): TokenNode<'identifier'> | undefined {
        return this.getTokenOfType('name', ['identifier']);
    }
    get colonToken(): TokenNode<':'> | undefined {
        return this.getTokenOfType(undefined, [':']);
    }
    get type(): TypeNode | undefined {
        return this.getAstNodeOfType<TypeNode>('type', ['GroupedType', 'NameType', 'PointerType', 'ArrayType', 'NeverType', 'RestParamType']);
    }
    get semicolonToken(): TokenNode<';'> | undefined {
        return this.getTokenOfType(undefined, [';']);
    }
}
export class ConstDeclNode extends AstNode {
    get constToken(): TokenNode<'const'> | undefined {
        return this.getTokenOfType(undefined, ['const']);
    }
    get name(): TokenNode<'identifier'> | undefined {
        return this.getTokenOfType('name', ['identifier']);
    }
    get colonToken(): TokenNode<':'> | undefined {
        return this.getTokenOfType(undefined, [':']);
    }
    get type(): TypeNode | undefined {
        return this.getAstNodeOfType<TypeNode>('type', ['GroupedType', 'NameType', 'PointerType', 'ArrayType', 'NeverType', 'RestParamType']);
    }
    get eqToken(): TokenNode<'='> | undefined {
        return this.getTokenOfType(undefined, ['=']);
    }
    get value(): ExprNode | undefined {
        return this.getAstNodeOfType<ExprNode>('value', ['GroupedExpr', 'NameExpr', 'SizeofExpr', 'LiteralExpr', 'ArrayExpr', 'CallExpr', 'RecordExpr', 'BinaryExpr', 'TernaryExpr', 'UnaryExpr', 'IndexExpr', 'FieldExpr', 'CastExpr']);
    }
    get semicolonToken(): TokenNode<';'> | undefined {
        return this.getTokenOfType(undefined, [';']);
    }
}
export class GroupedTypeNode extends AstNode {
    get lParToken(): TokenNode<'('> | undefined {
        return this.getTokenOfType(undefined, ['(']);
    }
    get type(): TypeNode | undefined {
        return this.getAstNodeOfType<TypeNode>('type', ['GroupedType', 'NameType', 'PointerType', 'ArrayType', 'NeverType', 'RestParamType']);
    }
    get rParToken(): TokenNode<')'> | undefined {
        return this.getTokenOfType(undefined, [')']);
    }
}
export class NameTypeNode extends AstNode {
    get identifierToken(): TokenNode<'identifier'> | undefined {
        return this.getTokenOfType(undefined, ['identifier']);
    }
}
export class PointerTypeNode extends AstNode {
    get starToken(): TokenNode<'*'> | undefined {
        return this.getTokenOfType(undefined, ['*']);
    }
    get pointee(): TypeNode | undefined {
        return this.getAstNodeOfType<TypeNode>('pointee', ['GroupedType', 'NameType', 'PointerType', 'ArrayType', 'NeverType', 'RestParamType']);
    }
}
export class ArrayTypeNode extends AstNode {
    get lBracketToken(): TokenNode<'['> | undefined {
        return this.getTokenOfType(undefined, ['[']);
    }
    get size(): ExprNode | undefined {
        return this.getAstNodeOfType<ExprNode>('size', ['GroupedExpr', 'NameExpr', 'SizeofExpr', 'LiteralExpr', 'ArrayExpr', 'CallExpr', 'RecordExpr', 'BinaryExpr', 'TernaryExpr', 'UnaryExpr', 'IndexExpr', 'FieldExpr', 'CastExpr']);
    }
    get semicolonToken(): TokenNode<';'> | undefined {
        return this.getTokenOfType(undefined, [';']);
    }
    get type(): TypeNode | undefined {
        return this.getAstNodeOfType<TypeNode>('type', ['GroupedType', 'NameType', 'PointerType', 'ArrayType', 'NeverType', 'RestParamType']);
    }
    get rBracketToken(): TokenNode<']'> | undefined {
        return this.getTokenOfType(undefined, [']']);
    }
}
export class NeverTypeNode extends AstNode {
    get exclToken(): TokenNode<'!'> | undefined {
        return this.getTokenOfType(undefined, ['!']);
    }
}
export class RestParamTypeNode extends AstNode {
    get dotDotDotToken(): TokenNode<'...'> | undefined {
        return this.getTokenOfType(undefined, ['...']);
    }
}
export class BlockStmtNode extends AstNode {
    get lBraceToken(): TokenNode<'{'> | undefined {
        return this.getTokenOfType(undefined, ['{']);
    }
    get stmtNodes(): StmtNode[] {
        return this.getAstNodesOfType<StmtNode>(undefined, ['BlockStmt', 'LocalDecl', 'IfStmt', 'WhileStmt', 'ForStmt', 'ReturnStmt', 'BreakStmt', 'ContinueStmt', 'ExprStmt']);
    }
    get rBraceToken(): TokenNode<'}'> | undefined {
        return this.getTokenOfType(undefined, ['}']);
    }
}
export class LocalDeclNode extends AstNode {
    get varToken(): TokenNode<'var'> | undefined {
        return this.getTokenOfType(undefined, ['var']);
    }
    get name(): TokenNode<'identifier'> | undefined {
        return this.getTokenOfType('name', ['identifier']);
    }
    get colonToken(): TokenNode<':'> | undefined {
        return this.getTokenOfType(undefined, [':']);
    }
    get type(): TypeNode | undefined {
        return this.getAstNodeOfType<TypeNode>('type', ['GroupedType', 'NameType', 'PointerType', 'ArrayType', 'NeverType', 'RestParamType']);
    }
    get eqToken(): TokenNode<'='> | undefined {
        return this.getTokenOfType(undefined, ['=']);
    }
    get value(): ExprNode | undefined {
        return this.getAstNodeOfType<ExprNode>('value', ['GroupedExpr', 'NameExpr', 'SizeofExpr', 'LiteralExpr', 'ArrayExpr', 'CallExpr', 'RecordExpr', 'BinaryExpr', 'TernaryExpr', 'UnaryExpr', 'IndexExpr', 'FieldExpr', 'CastExpr']);
    }
    get semicolonToken(): TokenNode<';'> | undefined {
        return this.getTokenOfType(undefined, [';']);
    }
}
export class IfStmtNode extends AstNode {
    get ifToken(): TokenNode<'if'> | undefined {
        return this.getTokenOfType(undefined, ['if']);
    }
    get lParToken(): TokenNode<'('> | undefined {
        return this.getTokenOfType(undefined, ['(']);
    }
    get cond(): ExprNode | undefined {
        return this.getAstNodeOfType<ExprNode>('cond', ['GroupedExpr', 'NameExpr', 'SizeofExpr', 'LiteralExpr', 'ArrayExpr', 'CallExpr', 'RecordExpr', 'BinaryExpr', 'TernaryExpr', 'UnaryExpr', 'IndexExpr', 'FieldExpr', 'CastExpr']);
    }
    get rParToken(): TokenNode<')'> | undefined {
        return this.getTokenOfType(undefined, [')']);
    }
    get then(): StmtNode | undefined {
        return this.getAstNodeOfType<StmtNode>('then', ['BlockStmt', 'LocalDecl', 'IfStmt', 'WhileStmt', 'ForStmt', 'ReturnStmt', 'BreakStmt', 'ContinueStmt', 'ExprStmt']);
    }
    get elseToken(): TokenNode<'else'> | undefined {
        return this.getTokenOfType(undefined, ['else']);
    }
    get else(): StmtNode | undefined {
        return this.getAstNodeOfType<StmtNode>('else', ['BlockStmt', 'LocalDecl', 'IfStmt', 'WhileStmt', 'ForStmt', 'ReturnStmt', 'BreakStmt', 'ContinueStmt', 'ExprStmt']);
    }
}
export class WhileStmtNode extends AstNode {
    get whileToken(): TokenNode<'while'> | undefined {
        return this.getTokenOfType(undefined, ['while']);
    }
    get lParToken(): TokenNode<'('> | undefined {
        return this.getTokenOfType(undefined, ['(']);
    }
    get cond(): ExprNode | undefined {
        return this.getAstNodeOfType<ExprNode>('cond', ['GroupedExpr', 'NameExpr', 'SizeofExpr', 'LiteralExpr', 'ArrayExpr', 'CallExpr', 'RecordExpr', 'BinaryExpr', 'TernaryExpr', 'UnaryExpr', 'IndexExpr', 'FieldExpr', 'CastExpr']);
    }
    get rParToken(): TokenNode<')'> | undefined {
        return this.getTokenOfType(undefined, [')']);
    }
    get body(): StmtNode | undefined {
        return this.getAstNodeOfType<StmtNode>('body', ['BlockStmt', 'LocalDecl', 'IfStmt', 'WhileStmt', 'ForStmt', 'ReturnStmt', 'BreakStmt', 'ContinueStmt', 'ExprStmt']);
    }
}
export class ForStmtNode extends AstNode {
    get forToken(): TokenNode<'for'> | undefined {
        return this.getTokenOfType(undefined, ['for']);
    }
    get lParToken(): TokenNode<'('> | undefined {
        return this.getTokenOfType(undefined, ['(']);
    }
    get init(): StmtNode | undefined {
        return this.getAstNodeOfType<StmtNode>('init', ['BlockStmt', 'LocalDecl', 'IfStmt', 'WhileStmt', 'ForStmt', 'ReturnStmt', 'BreakStmt', 'ContinueStmt', 'ExprStmt']);
    }
    get semicolonToken(): TokenNode<';'> | undefined {
        return this.getTokenOfType(undefined, [';']);
    }
    get cond(): ExprNode | undefined {
        return this.getAstNodeOfType<ExprNode>('cond', ['GroupedExpr', 'NameExpr', 'SizeofExpr', 'LiteralExpr', 'ArrayExpr', 'CallExpr', 'RecordExpr', 'BinaryExpr', 'TernaryExpr', 'UnaryExpr', 'IndexExpr', 'FieldExpr', 'CastExpr']);
    }
    get step(): ExprNode | undefined {
        return this.getAstNodeOfType<ExprNode>('step', ['GroupedExpr', 'NameExpr', 'SizeofExpr', 'LiteralExpr', 'ArrayExpr', 'CallExpr', 'RecordExpr', 'BinaryExpr', 'TernaryExpr', 'UnaryExpr', 'IndexExpr', 'FieldExpr', 'CastExpr']);
    }
    get rParToken(): TokenNode<')'> | undefined {
        return this.getTokenOfType(undefined, [')']);
    }
    get body(): StmtNode | undefined {
        return this.getAstNodeOfType<StmtNode>('body', ['BlockStmt', 'LocalDecl', 'IfStmt', 'WhileStmt', 'ForStmt', 'ReturnStmt', 'BreakStmt', 'ContinueStmt', 'ExprStmt']);
    }
}
export class ReturnStmtNode extends AstNode {
    get returnToken(): TokenNode<'return'> | undefined {
        return this.getTokenOfType(undefined, ['return']);
    }
    get value(): ExprNode | undefined {
        return this.getAstNodeOfType<ExprNode>('value', ['GroupedExpr', 'NameExpr', 'SizeofExpr', 'LiteralExpr', 'ArrayExpr', 'CallExpr', 'RecordExpr', 'BinaryExpr', 'TernaryExpr', 'UnaryExpr', 'IndexExpr', 'FieldExpr', 'CastExpr']);
    }
    get semicolonToken(): TokenNode<';'> | undefined {
        return this.getTokenOfType(undefined, [';']);
    }
}
export class BreakStmtNode extends AstNode {
    get breakToken(): TokenNode<'break'> | undefined {
        return this.getTokenOfType(undefined, ['break']);
    }
    get semicolonToken(): TokenNode<';'> | undefined {
        return this.getTokenOfType(undefined, [';']);
    }
}
export class ContinueStmtNode extends AstNode {
    get continueToken(): TokenNode<'continue'> | undefined {
        return this.getTokenOfType(undefined, ['continue']);
    }
    get semicolonToken(): TokenNode<';'> | undefined {
        return this.getTokenOfType(undefined, [';']);
    }
}
export class ExprStmtNode extends AstNode {
    get expr(): ExprNode | undefined {
        return this.getAstNodeOfType<ExprNode>('expr', ['GroupedExpr', 'NameExpr', 'SizeofExpr', 'LiteralExpr', 'ArrayExpr', 'CallExpr', 'RecordExpr', 'BinaryExpr', 'TernaryExpr', 'UnaryExpr', 'IndexExpr', 'FieldExpr', 'CastExpr']);
    }
    get semicolonToken(): TokenNode<';'> | undefined {
        return this.getTokenOfType(undefined, [';']);
    }
}
export class GroupedExprNode extends AstNode {
    get lParToken(): TokenNode<'('> | undefined {
        return this.getTokenOfType(undefined, ['(']);
    }
    get exprNode(): ExprNode | undefined {
        return this.getAstNodeOfType<ExprNode>(undefined, ['GroupedExpr', 'NameExpr', 'SizeofExpr', 'LiteralExpr', 'ArrayExpr', 'CallExpr', 'RecordExpr', 'BinaryExpr', 'TernaryExpr', 'UnaryExpr', 'IndexExpr', 'FieldExpr', 'CastExpr']);
    }
    get rParToken(): TokenNode<')'> | undefined {
        return this.getTokenOfType(undefined, [')']);
    }
}
export class NameExprNode extends AstNode {
    get identifierToken(): TokenNode<'identifier'> | undefined {
        return this.getTokenOfType(undefined, ['identifier']);
    }
}
export class SizeofExprNode extends AstNode {
    get sizeofToken(): TokenNode<'sizeof'> | undefined {
        return this.getTokenOfType(undefined, ['sizeof']);
    }
    get lParToken(): TokenNode<'('> | undefined {
        return this.getTokenOfType(undefined, ['(']);
    }
    get type(): TypeNode | undefined {
        return this.getAstNodeOfType<TypeNode>('type', ['GroupedType', 'NameType', 'PointerType', 'ArrayType', 'NeverType', 'RestParamType']);
    }
    get rParToken(): TokenNode<')'> | undefined {
        return this.getTokenOfType(undefined, [')']);
    }
}
export class LiteralExprNode extends AstNode {
    get literalNode(): LiteralNode | undefined {
        return this.getAstNodeOfType<LiteralNode>(undefined, ['BoolLiteral', 'NullLiteral', 'IntLiteral', 'CharLiteral', 'StringLiteral']);
    }
}
export class ArrayExprNode extends AstNode {
    get lBracketToken(): TokenNode<'['> | undefined {
        return this.getTokenOfType(undefined, ['[']);
    }
    get exprNodes(): ExprNode[] {
        return this.getAstNodesOfType<ExprNode>(undefined, ['GroupedExpr', 'NameExpr', 'SizeofExpr', 'LiteralExpr', 'ArrayExpr', 'CallExpr', 'RecordExpr', 'BinaryExpr', 'TernaryExpr', 'UnaryExpr', 'IndexExpr', 'FieldExpr', 'CastExpr']);
    }
    get rBracketToken(): TokenNode<']'> | undefined {
        return this.getTokenOfType(undefined, [']']);
    }
}
export class CallExprNode extends AstNode {
    get callee(): ExprNode | undefined {
        return this.getAstNodeOfType<ExprNode>('callee', ['GroupedExpr', 'NameExpr', 'SizeofExpr', 'LiteralExpr', 'ArrayExpr', 'CallExpr', 'RecordExpr', 'BinaryExpr', 'TernaryExpr', 'UnaryExpr', 'IndexExpr', 'FieldExpr', 'CastExpr']);
    }
    get args(): CallArgListNode | undefined {
        return this.getAstNodeOfType<CallArgListNode>('args', ['CallArgList']);
    }
}
export class CallArgListNode extends AstNode {
    get lParToken(): TokenNode<'('> | undefined {
        return this.getTokenOfType(undefined, ['(']);
    }
    get callArgNodes(): CallArgNode[] {
        return this.getAstNodesOfType<CallArgNode>(undefined, ['CallArg']);
    }
    get rParToken(): TokenNode<')'> | undefined {
        return this.getTokenOfType(undefined, [')']);
    }
}
export class CallArgNode extends AstNode {
    get label(): TokenNode<'identifier'> | undefined {
        return this.getTokenOfType('label', ['identifier']);
    }
    get colonToken(): TokenNode<':'> | undefined {
        return this.getTokenOfType(undefined, [':']);
    }
    get value(): ExprNode | undefined {
        return this.getAstNodeOfType<ExprNode>('value', ['GroupedExpr', 'NameExpr', 'SizeofExpr', 'LiteralExpr', 'ArrayExpr', 'CallExpr', 'RecordExpr', 'BinaryExpr', 'TernaryExpr', 'UnaryExpr', 'IndexExpr', 'FieldExpr', 'CastExpr']);
    }
}
export class BinaryExprNode extends AstNode {
    get left(): ExprNode | undefined {
        return this.getAstNodeOfType<ExprNode>('left', ['GroupedExpr', 'NameExpr', 'SizeofExpr', 'LiteralExpr', 'ArrayExpr', 'CallExpr', 'RecordExpr', 'BinaryExpr', 'TernaryExpr', 'UnaryExpr', 'IndexExpr', 'FieldExpr', 'CastExpr']);
    }
    get op(): TokenNode<'=' | '|=' | '^=' | '&=' | '<<=' | '>>=' | '+=' | '-=' | '*=' | '/=' | '%=' | '||' | '&&' | '|' | '^' | '&' | '==' | '!=' | '<' | '>' | '<=' | '>=' | '<<' | '>>' | '+' | '-' | '*' | '/' | '%'> | undefined {
        return this.getTokenOfType('op', ['=', '|=', '^=', '&=', '<<=', '>>=', '+=', '-=', '*=', '/=', '%=', '||', '&&', '|', '^', '&', '==', '!=', '<', '>', '<=', '>=', '<<', '>>', '+', '-', '*', '/', '%']);
    }
    get right(): ExprNode | undefined {
        return this.getAstNodeOfType<ExprNode>('right', ['GroupedExpr', 'NameExpr', 'SizeofExpr', 'LiteralExpr', 'ArrayExpr', 'CallExpr', 'RecordExpr', 'BinaryExpr', 'TernaryExpr', 'UnaryExpr', 'IndexExpr', 'FieldExpr', 'CastExpr']);
    }
}
export class UnaryExprNode extends AstNode {
    get op(): TokenNode<'!' | '-' | '~' | '*' | '&'> | undefined {
        return this.getTokenOfType('op', ['!', '-', '~', '*', '&']);
    }
    get right(): ExprNode | undefined {
        return this.getAstNodeOfType<ExprNode>('right', ['GroupedExpr', 'NameExpr', 'SizeofExpr', 'LiteralExpr', 'ArrayExpr', 'CallExpr', 'RecordExpr', 'BinaryExpr', 'TernaryExpr', 'UnaryExpr', 'IndexExpr', 'FieldExpr', 'CastExpr']);
    }
}
export class TernaryExprNode extends AstNode {
    get cond(): ExprNode | undefined {
        return this.getAstNodeOfType<ExprNode>('cond', ['GroupedExpr', 'NameExpr', 'SizeofExpr', 'LiteralExpr', 'ArrayExpr', 'CallExpr', 'RecordExpr', 'BinaryExpr', 'TernaryExpr', 'UnaryExpr', 'IndexExpr', 'FieldExpr', 'CastExpr']);
    }
    get questToken(): TokenNode<'?'> | undefined {
        return this.getTokenOfType(undefined, ['?']);
    }
    get then(): ExprNode | undefined {
        return this.getAstNodeOfType<ExprNode>('then', ['GroupedExpr', 'NameExpr', 'SizeofExpr', 'LiteralExpr', 'ArrayExpr', 'CallExpr', 'RecordExpr', 'BinaryExpr', 'TernaryExpr', 'UnaryExpr', 'IndexExpr', 'FieldExpr', 'CastExpr']);
    }
    get colonToken(): TokenNode<':'> | undefined {
        return this.getTokenOfType(undefined, [':']);
    }
    get else(): ExprNode | undefined {
        return this.getAstNodeOfType<ExprNode>('else', ['GroupedExpr', 'NameExpr', 'SizeofExpr', 'LiteralExpr', 'ArrayExpr', 'CallExpr', 'RecordExpr', 'BinaryExpr', 'TernaryExpr', 'UnaryExpr', 'IndexExpr', 'FieldExpr', 'CastExpr']);
    }
}
export class IndexExprNode extends AstNode {
    get indexee(): ExprNode | undefined {
        return this.getAstNodeOfType<ExprNode>('indexee', ['GroupedExpr', 'NameExpr', 'SizeofExpr', 'LiteralExpr', 'ArrayExpr', 'CallExpr', 'RecordExpr', 'BinaryExpr', 'TernaryExpr', 'UnaryExpr', 'IndexExpr', 'FieldExpr', 'CastExpr']);
    }
    get lBracketToken(): TokenNode<'['> | undefined {
        return this.getTokenOfType(undefined, ['[']);
    }
    get index(): ExprNode | undefined {
        return this.getAstNodeOfType<ExprNode>('index', ['GroupedExpr', 'NameExpr', 'SizeofExpr', 'LiteralExpr', 'ArrayExpr', 'CallExpr', 'RecordExpr', 'BinaryExpr', 'TernaryExpr', 'UnaryExpr', 'IndexExpr', 'FieldExpr', 'CastExpr']);
    }
    get rBracketToken(): TokenNode<']'> | undefined {
        return this.getTokenOfType(undefined, [']']);
    }
}
export class FieldExprNode extends AstNode {
    get left(): ExprNode | undefined {
        return this.getAstNodeOfType<ExprNode>('left', ['GroupedExpr', 'NameExpr', 'SizeofExpr', 'LiteralExpr', 'ArrayExpr', 'CallExpr', 'RecordExpr', 'BinaryExpr', 'TernaryExpr', 'UnaryExpr', 'IndexExpr', 'FieldExpr', 'CastExpr']);
    }
    get dotToken(): TokenNode<'.'> | undefined {
        return this.getTokenOfType(undefined, ['.']);
    }
    get name(): TokenNode<'identifier'> | undefined {
        return this.getTokenOfType('name', ['identifier']);
    }
}
export class CastExprNode extends AstNode {
    get expr(): ExprNode | undefined {
        return this.getAstNodeOfType<ExprNode>('expr', ['GroupedExpr', 'NameExpr', 'SizeofExpr', 'LiteralExpr', 'ArrayExpr', 'CallExpr', 'RecordExpr', 'BinaryExpr', 'TernaryExpr', 'UnaryExpr', 'IndexExpr', 'FieldExpr', 'CastExpr']);
    }
    get asToken(): TokenNode<'as'> | undefined {
        return this.getTokenOfType(undefined, ['as']);
    }
    get type(): TypeNode | undefined {
        return this.getAstNodeOfType<TypeNode>('type', ['GroupedType', 'NameType', 'PointerType', 'ArrayType', 'NeverType', 'RestParamType']);
    }
}
export class RecordExprNode extends AstNode {
    get name(): TokenNode<'identifier'> | undefined {
        return this.getTokenOfType('name', ['identifier']);
    }
    get fields(): FieldInitListNode | undefined {
        return this.getAstNodeOfType<FieldInitListNode>('fields', ['FieldInitList']);
    }
}
export class FieldInitListNode extends AstNode {
    get lBraceToken(): TokenNode<'{'> | undefined {
        return this.getTokenOfType(undefined, ['{']);
    }
    get fieldInitNodes(): FieldInitNode[] {
        return this.getAstNodesOfType<FieldInitNode>(undefined, ['FieldInit']);
    }
    get rBraceToken(): TokenNode<'}'> | undefined {
        return this.getTokenOfType(undefined, ['}']);
    }
}
export class FieldInitNode extends AstNode {
    get name(): TokenNode<'identifier'> | undefined {
        return this.getTokenOfType('name', ['identifier']);
    }
    get colonToken(): TokenNode<':'> | undefined {
        return this.getTokenOfType(undefined, [':']);
    }
    get value(): ExprNode | undefined {
        return this.getAstNodeOfType<ExprNode>('value', ['GroupedExpr', 'NameExpr', 'SizeofExpr', 'LiteralExpr', 'ArrayExpr', 'CallExpr', 'RecordExpr', 'BinaryExpr', 'TernaryExpr', 'UnaryExpr', 'IndexExpr', 'FieldExpr', 'CastExpr']);
    }
}
export class BoolLiteralNode extends AstNode {
    get trueToken(): TokenNode<'true'> | undefined {
        return this.getTokenOfType(undefined, ['true']);
    }
    get falseToken(): TokenNode<'false'> | undefined {
        return this.getTokenOfType(undefined, ['false']);
    }
}
export class NullLiteralNode extends AstNode {
    get nullToken(): TokenNode<'null'> | undefined {
        return this.getTokenOfType(undefined, ['null']);
    }
}
export class IntLiteralNode extends AstNode {
    get numberLiteralToken(): TokenNode<'number_literal'> | undefined {
        return this.getTokenOfType(undefined, ['number_literal']);
    }
}
export class CharLiteralNode extends AstNode {
    get charLiteralToken(): TokenNode<'char_literal'> | undefined {
        return this.getTokenOfType(undefined, ['char_literal']);
    }
}
export class StringLiteralNode extends AstNode {
    get stringLiteralToken(): TokenNode<'string_literal'> | undefined {
        return this.getTokenOfType(undefined, ['string_literal']);
    }
}
//==============================================================================
//== Union types

export enum DeclNodeTypes {
    IncludeDecl = 'IncludeDecl',
    EnumDecl = 'EnumDecl',
    RecordDecl = 'RecordDecl',
    FuncDecl = 'FuncDecl',
    GlobalDecl = 'GlobalDecl',
    ConstDecl = 'ConstDecl',
};

export type DeclNode =
    | IncludeDeclNode
    | EnumDeclNode
    | RecordDeclNode
    | FuncDeclNode
    | GlobalDeclNode
    | ConstDeclNode;

export enum FuncParamNodeTypes {
    NormalFuncParam = 'NormalFuncParam',
    RestFuncParam = 'RestFuncParam',
};

export type FuncParamNode =
    | NormalFuncParamNode
    | RestFuncParamNode;

export enum TypeNodeTypes {
    GroupedType = 'GroupedType',
    NameType = 'NameType',
    PointerType = 'PointerType',
    ArrayType = 'ArrayType',
    NeverType = 'NeverType',
    RestParamType = 'RestParamType',
};

export type TypeNode =
    | GroupedTypeNode
    | NameTypeNode
    | PointerTypeNode
    | ArrayTypeNode
    | NeverTypeNode
    | RestParamTypeNode;

export enum StmtNodeTypes {
    BlockStmt = 'BlockStmt',
    LocalDecl = 'LocalDecl',
    IfStmt = 'IfStmt',
    WhileStmt = 'WhileStmt',
    ForStmt = 'ForStmt',
    ReturnStmt = 'ReturnStmt',
    BreakStmt = 'BreakStmt',
    ContinueStmt = 'ContinueStmt',
    ExprStmt = 'ExprStmt',
};

export type StmtNode =
    | BlockStmtNode
    | LocalDeclNode
    | IfStmtNode
    | WhileStmtNode
    | ForStmtNode
    | ReturnStmtNode
    | BreakStmtNode
    | ContinueStmtNode
    | ExprStmtNode;

export enum ExprNodeTypes {
    GroupedExpr = 'GroupedExpr',
    NameExpr = 'NameExpr',
    SizeofExpr = 'SizeofExpr',
    LiteralExpr = 'LiteralExpr',
    ArrayExpr = 'ArrayExpr',
    CallExpr = 'CallExpr',
    RecordExpr = 'RecordExpr',
    BinaryExpr = 'BinaryExpr',
    TernaryExpr = 'TernaryExpr',
    UnaryExpr = 'UnaryExpr',
    IndexExpr = 'IndexExpr',
    FieldExpr = 'FieldExpr',
    CastExpr = 'CastExpr',
};

export type ExprNode =
    | GroupedExprNode
    | NameExprNode
    | SizeofExprNode
    | LiteralExprNode
    | ArrayExprNode
    | CallExprNode
    | RecordExprNode
    | BinaryExprNode
    | TernaryExprNode
    | UnaryExprNode
    | IndexExprNode
    | FieldExprNode
    | CastExprNode;

export enum LiteralNodeTypes {
    BoolLiteral = 'BoolLiteral',
    NullLiteral = 'NullLiteral',
    IntLiteral = 'IntLiteral',
    CharLiteral = 'CharLiteral',
    StringLiteral = 'StringLiteral',
};

export type LiteralNode =
    | BoolLiteralNode
    | NullLiteralNode
    | IntLiteralNode
    | CharLiteralNode
    | StringLiteralNode;

export function fromSyntaxNode(syntax: SyntaxNode): AstNode {
    switch (syntax.type) {
        case AstNodeTypes.Root: return new RootNode(syntax);
        case AstNodeTypes.IncludeDecl: return new IncludeDeclNode(syntax);
        case AstNodeTypes.EnumDecl: return new EnumDeclNode(syntax);
        case AstNodeTypes.EnumBody: return new EnumBodyNode(syntax);
        case AstNodeTypes.EnumMember: return new EnumMemberNode(syntax);
        case AstNodeTypes.RecordDecl: return new RecordDeclNode(syntax);
        case AstNodeTypes.RecordBody: return new RecordBodyNode(syntax);
        case AstNodeTypes.Field: return new FieldNode(syntax);
        case AstNodeTypes.FuncDecl: return new FuncDeclNode(syntax);
        case AstNodeTypes.FuncParamList: return new FuncParamListNode(syntax);
        case AstNodeTypes.NormalFuncParam: return new NormalFuncParamNode(syntax);
        case AstNodeTypes.RestFuncParam: return new RestFuncParamNode(syntax);
        case AstNodeTypes.GlobalDecl: return new GlobalDeclNode(syntax);
        case AstNodeTypes.ConstDecl: return new ConstDeclNode(syntax);
        case AstNodeTypes.GroupedType: return new GroupedTypeNode(syntax);
        case AstNodeTypes.NameType: return new NameTypeNode(syntax);
        case AstNodeTypes.PointerType: return new PointerTypeNode(syntax);
        case AstNodeTypes.ArrayType: return new ArrayTypeNode(syntax);
        case AstNodeTypes.NeverType: return new NeverTypeNode(syntax);
        case AstNodeTypes.RestParamType: return new RestParamTypeNode(syntax);
        case AstNodeTypes.BlockStmt: return new BlockStmtNode(syntax);
        case AstNodeTypes.LocalDecl: return new LocalDeclNode(syntax);
        case AstNodeTypes.IfStmt: return new IfStmtNode(syntax);
        case AstNodeTypes.WhileStmt: return new WhileStmtNode(syntax);
        case AstNodeTypes.ForStmt: return new ForStmtNode(syntax);
        case AstNodeTypes.ReturnStmt: return new ReturnStmtNode(syntax);
        case AstNodeTypes.BreakStmt: return new BreakStmtNode(syntax);
        case AstNodeTypes.ContinueStmt: return new ContinueStmtNode(syntax);
        case AstNodeTypes.ExprStmt: return new ExprStmtNode(syntax);
        case AstNodeTypes.GroupedExpr: return new GroupedExprNode(syntax);
        case AstNodeTypes.NameExpr: return new NameExprNode(syntax);
        case AstNodeTypes.SizeofExpr: return new SizeofExprNode(syntax);
        case AstNodeTypes.LiteralExpr: return new LiteralExprNode(syntax);
        case AstNodeTypes.ArrayExpr: return new ArrayExprNode(syntax);
        case AstNodeTypes.CallExpr: return new CallExprNode(syntax);
        case AstNodeTypes.CallArgList: return new CallArgListNode(syntax);
        case AstNodeTypes.CallArg: return new CallArgNode(syntax);
        case AstNodeTypes.BinaryExpr: return new BinaryExprNode(syntax);
        case AstNodeTypes.UnaryExpr: return new UnaryExprNode(syntax);
        case AstNodeTypes.TernaryExpr: return new TernaryExprNode(syntax);
        case AstNodeTypes.IndexExpr: return new IndexExprNode(syntax);
        case AstNodeTypes.FieldExpr: return new FieldExprNode(syntax);
        case AstNodeTypes.CastExpr: return new CastExprNode(syntax);
        case AstNodeTypes.RecordExpr: return new RecordExprNode(syntax);
        case AstNodeTypes.FieldInitList: return new FieldInitListNode(syntax);
        case AstNodeTypes.FieldInit: return new FieldInitNode(syntax);
        case AstNodeTypes.BoolLiteral: return new BoolLiteralNode(syntax);
        case AstNodeTypes.NullLiteral: return new NullLiteralNode(syntax);
        case AstNodeTypes.IntLiteral: return new IntLiteralNode(syntax);
        case AstNodeTypes.CharLiteral: return new CharLiteralNode(syntax);
        case AstNodeTypes.StringLiteral: return new StringLiteralNode(syntax);
        default: throw new Error('Unknown node type: ' + syntax.type);
    }
}
