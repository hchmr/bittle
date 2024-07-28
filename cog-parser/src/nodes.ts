
//=========================================================================
//== Syntax nodes

import { Position, Token, TokenKind } from "./token.js";

export type SyntaxNode =
    | LeafNode
    | CompositeNode;

export type LeafNode =
    | TokenNode
    | MissingTokenNode;

export type CompositeNode = {
    nodeKind: CompositeNodeKind;
    children: SyntaxNodeChild[];
    startPosition: Position;
};

export type SyntaxNodeChild = {
    field?: string;
    node: SyntaxNode;
};

export type TokenNode = {
    token: Token;
};

export type MissingTokenNode = {
    missing: TokenKind;
    position: Position;
}

export enum CompositeNodeKind {
    // Root
    Root = 'Root',
    // Top-level declarations
    IncludeDecl = 'IncludeDecl',
    EnumDecl = 'EnumDecl',
    EnumMember = 'EnumMember',
    StructDecl = 'StructDecl',
    StructMember = 'StructMember',
    FuncDecl = 'FuncDecl',
    FuncParam = 'FuncParam',
    GlobalDecl = 'GlobalDecl',
    ConstDecl = 'ConstDecl',
    // Statements
    BlockStmt = 'BlockStmt',
    VarStmt = 'VarStmt',
    IfStmt = 'IfStmt',
    WhileStmt = 'WhileStmt',
    ReturnStmt = 'ReturnStmt',
    BreakStmt = 'BreakStmt',
    ContinueStmt = 'ContinueStmt',
    ExprStmt = 'ExprStmt',
    // Expressions
    GroupExpr = 'GroupExpr',
    NameExpr = 'NameExpr',
    LiteralExpr = 'LiteralExpr',
    UnaryExpr = 'UnaryExpr',
    BinaryExpr = 'BinaryExpr',
    TernaryExpr = 'TernaryExpr',
    CallExpr = 'CallExpr',
    IndexExpr = 'IndexExpr',
    FieldExpr = 'FieldExpr',
    CastExpr = 'CastExpr',
    SizeofExpr = 'SizeofExpr',
    // Types
    GroupType = 'GroupType',
    NameType = 'NameType',
    PointerType = 'PointerType',
    ArrayType = 'ArrayType',
    // Literals
    IntLiteral = 'IntLiteral',
    StringLiteral = 'StringLiteral',
    CharLiteral = 'CharLiteral',
    // Error
    Error = 'Error',
}

//=========================================================================
//== Utility functions

export function isCompositeNode(node: SyntaxNode): node is CompositeNode {
    if ('nodeKind' in node) {
        assertType<CompositeNodeKind>(node.nodeKind);
        return true;
    } else {
        return false;
    }
}

export function isTokenNode(node: SyntaxNode): node is TokenNode {
    if ('token' in node) {
        assertType<TokenNode>(node);
        return true;
    } else {
        return false;
    }
}

export function isMissingTokenNode(node: SyntaxNode): node is MissingTokenNode {
    if ('missing' in node) {
        assertType<MissingTokenNode>(node);
        return true;
    } else {
        return false;
    }
}

function assertType<T>(_: T): void {
}

export function prettySyntaxTree(node: SyntaxNode): string {
    let text = '';
    (function go(node: SyntaxNode, level: number = 0) {
        if (isCompositeNode(node)) {
            text += indent(level);
            text += node.nodeKind;
            text += prettyPosition(node.startPosition);
            text += '\n';
            for (const child of node.children) {
                go(child.node, level + 1);
            }
        } else if (isTokenNode(node)) {
            text += indent(level);
            text += JSON.stringify(node.token.lexeme);
            text += prettyPosition(node.token.position);
            text += '\n';
        } else if (isMissingTokenNode(node)) {
            text += indent(level);
            text += 'MISSING ' + JSON.stringify(node.missing);
            text += prettyPosition(node.position);
            text += '\n';
        } else {
            const never: never = node;
            throw new Error(`Unreachable`, never);
        }
    })(node);
    return text;

    function prettyPosition(pos: Position) {
        return `@${pos.row + 1}:${pos.col + 1}`;
    }

    function indent(level: number) {
        return '  '.repeat(level);
    }
}

export function reconstructText(node: SyntaxNode): string {
    if (isCompositeNode(node)) {
        return node.children
            .map(child => reconstructText(child.node))
            .join('');
    } else if (isTokenNode(node)) {
        let text = '';
        text += node.token.leadingTrivia.join('');
        text += node.token.lexeme;
        text += node.token.trailingTrivia.join('');
        return text;
    } else if (isMissingTokenNode(node)) {
        return '';
    } else {
        const never: never = node;
        throw new Error(`Unreachable`, never);
    }
}
