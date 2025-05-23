import {
    choice, createGrammar, label, optional, repeat, Rule, sepBy1, sepEndBy, seq, terminal,
} from './grammar/core';

function commaSep(rule: Rule): Rule {
    return sepEndBy(rule, ',');
}

export const grammar = createGrammar({
    Root: $ => repeat($.Decl),

    Decl: $ => choice(
        $.IncludeDecl,
        $.ModuleNameDecl,
        $.ImportDecl,
        $.EnumDecl,
        $.RecordDecl,
        $.FuncDecl,
        $.GlobalDecl,
        $.ConstDecl,
    ),

    IncludeDecl: $ => seq(
        'include',
        label('path', 'string_literal'),
        ';',
    ),

    ModuleNameDecl: $ => seq(
        'module',
        label('name', 'identifier'),
        ';',
    ),

    ImportDecl: $ => seq(
        'import',
        label('path', 'string_literal'),
        ';',
    ),

    EnumDecl: $ => seq(
        'enum',
        label('name', 'identifier'),
        label('body', $.EnumBody),
    ),

    EnumBody: $ => seq(
        '{',
        commaSep($.EnumMember),
        '}',
    ),

    EnumMember: $ => seq(
        optional(
            label('name', 'identifier'),
        ),
        optional(seq(
            '=',
            label('value', $.Expr),
        )),
        ';',
    ),

    RecordDecl: $ => seq(
        choice('struct', 'union'),
        label('name', 'identifier'),
        optional(seq(
            ':',
            label('base', $.Type),
        )),
        label('body', $.RecordBody),
    ),

    RecordBody: $ => seq(
        '{',
        commaSep($.Field),
        '}',
    ),

    Field: $ => seq(
        label('name', 'identifier'),
        optional(seq(
            ':',
            label('type', $.Type),
        )),
        optional(seq(
            '=',
            label('value', $.Expr),
        )),
    ),

    FuncDecl: $ => seq(
        'func',
        label('name', 'identifier'),
        label('params', $.FuncParamList),
        optional(seq(
            ':',
            label('returnType', $.Type),
        )),
        choice(
            label('body', $.BlockStmt),
            ';',
        ),
    ),

    FuncParamList: $ => seq(
        '(',
        commaSep($.FuncParam),
        ')',
    ),

    FuncParam: $ => choice(
        $.NormalFuncParam,
        $.RestFuncParam,
    ),

    NormalFuncParam: $ => seq(
        label('name', 'identifier'),
        ':',
        label('type', $.Type),
        optional(seq(
            '=',
            label('value', $.Expr),
        )),
    ),

    RestFuncParam: $ => seq(
        '...',
        optional(
            label('name', 'identifier'),
        ),
    ),

    GlobalDecl: $ => seq(
        optional('extern'),
        'var',
        label('name', 'identifier'),
        optional(seq(
            ':',
            label('type', $.Type),
        )),
        ';',
    ),

    ConstDecl: $ => seq(
        'const',
        label('name', 'identifier'),
        optional(seq(
            ':',
            label('type', $.Type),
        )),
        '=',
        label('value', $.Expr),
        ';',
    ),

    Type: $ => choice(
        $.GroupedType,
        $.NameType,
        $.PointerType,
        $.ArrayType,
        $.TypeofType,
        $.NeverType,
        $.RestParamType,
    ),

    GroupedType: $ => seq(
        '(',
        label('type', $.Type),
        ')',
    ),

    NameType: $ => terminal('identifier'),

    PointerType: $ => seq(
        '*',
        optional('mut'),
        label('pointee', $.Type),
    ),

    ArrayType: $ => seq(
        '[',
        label('size', $.Expr),
        ';',
        label('type', $.Type),
        ']',
    ),

    TypeofType: $ => seq(
        'typeof',
        '(',
        label('expr', $.Expr),
        ')',
    ),

    NeverType: $ => terminal('!'),

    RestParamType: $ => seq(
        '...',
    ),

    Stmt: $ => choice(
        $.BlockStmt,
        $.ConstDecl,
        $.LocalDecl,
        $.IfStmt,
        $.MatchStmt,
        $.WhileStmt,
        $.ForStmt,
        $.ReturnStmt,
        $.BreakStmt,
        $.ContinueStmt,
        $.ExprStmt,
    ),

    BlockStmt: $ => seq(
        '{',
        repeat($.Stmt),
        '}',
    ),

    LocalDecl: $ => seq(
        'var',
        label('name', 'identifier'),
        optional(seq(
            ':',
            label('type', $.Type),
        )),
        optional(seq(
            '=',
            label('value', $.Expr),
        )),
        ';',
    ),

    IfStmt: $ => seq(
        'if',
        '(',
        label('cond', $.Expr),
        ')',
        label('then', $.Stmt),
        optional(seq(
            'else',
            label('else', $.Stmt),
        )),
    ),

    MatchStmt: $ => seq(
        'match',
        '(',
        label('value', $.Expr),
        ')',
        label('body', $.MatchBody),
    ),

    MatchBody: $ => seq(
        '{',
        repeat($.MatchCase),
        '}',
    ),

    MatchCase: $ => seq(
        'case',
        label('pattern', $.Pattern),
        optional(seq(
            'if',
            label('guard', $.Expr),
        )),
        ':',
        label('body', $.Stmt),
    ),

    WhileStmt: $ => seq(
        'while',
        '(',
        label('cond', $.Expr),
        ')',
        label('body', $.Stmt),
    ),

    ForStmt: $ => seq(
        'for',
        '(',
        choice(
            label('init', $.Stmt),
            ';',
        ),
        optional(label('cond', $.Expr)),
        ';',
        optional(label('step', $.Expr)),
        ')',
        label('body', $.Stmt),
    ),

    ReturnStmt: $ => seq(
        'return',
        optional(label('value', $.Expr)),
        ';',
    ),

    BreakStmt: $ => seq('break', ';'),

    ContinueStmt: $ => seq('continue', ';'),

    ExprStmt: $ => seq(
        label('expr', $.Expr),
        ';',
    ),

    Expr: $ => choice(
        $.GroupedExpr,
        $.NameExpr,
        $.SizeofExpr,
        $.LiteralExpr,
        $.ArrayExpr,
        $.CallExpr,
        $.RecordExpr,
        $.BinaryExpr,
        $.TernaryExpr,
        $.IsExpr,
        $.UnaryExpr,
        $.IndexExpr,
        $.FieldExpr,
        $.CastExpr,
    ),

    GroupedExpr: $ => seq(
        '(',
        $.Expr,
        ')',
    ),

    NameExpr: $ => terminal('identifier'),

    SizeofExpr: $ => seq(
        'sizeof',
        '(',
        label('type', $.Type),
        ')',
    ),

    LiteralExpr: $ => $.Literal,

    ArrayExpr: $ => seq(
        '[',
        commaSep($.Expr),
        ']',
    ),

    CallExpr: $ => seq(
        label('callee', $.Expr),
        label('args', $.CallArgList),
    ),

    CallArgList: $ => seq(
        '(',
        commaSep($.CallArg),
        ')',
    ),

    CallArg: $ => seq(
        optional(seq(
            label('label', 'identifier'),
            ':',
        )),
        label('value', $.Expr),
    ),

    BinaryExpr: $ => seq(
        label('left', $.Expr),
        label('op', choice('=', '|=', '^=', '&=', '<<=', '>>=', '+=', '-=', '*=', '/=', '%=', '||', '&&', '|', '^', '&', '==', '!=', '<', '>', '<=', '>=', '<<', '>>', '+', '-', '*', '/', '%')),
        label('right', $.Expr),
    ),

    UnaryExpr: $ => seq(
        label('op', choice('!', '-', '~', '*', '&')),
        label('right', $.Expr),
    ),

    TernaryExpr: $ => seq(
        label('cond', $.Expr),
        '?',
        label('then', $.Expr),
        ':',
        label('else', $.Expr),
    ),

    IsExpr: $ => seq(
        label('expr', $.Expr),
        'is',
        label('pattern', $.Pattern),
    ),

    IndexExpr: $ => seq(
        label('indexee', $.Expr),
        '[',
        label('index', $.Expr),
        ']',
    ),

    FieldExpr: $ => seq(
        label('left', $.Expr),
        '.',
        label('name', 'identifier'),
    ),

    CastExpr: $ => seq(
        label('expr', $.Expr),
        'as',
        label('type', $.Type),
    ),

    RecordExpr: $ => seq(
        label('name', 'identifier'),
        label('fields', $.FieldInitList),
    ),

    FieldInitList: $ => seq(
        '{',
        commaSep($.FieldInit),
        '}',
    ),

    FieldInit: $ => seq(
        optional(seq(
            label('name', 'identifier'),
            ':',
        )),
        label('value', $.Expr),
    ),

    Pattern: $ => choice(
        $.GroupedPattern,
        $.LiteralPattern,
        $.NamePattern,
        $.WildcardPattern,
        $.VarPattern,
        $.RangePattern,
        $.OrPattern,
    ),

    GroupedPattern: $ => seq(
        '(',
        label('pattern', $.Pattern),
        ')',
    ),

    LiteralPattern: $ => $.Literal,

    NamePattern: $ => terminal('identifier'),

    WildcardPattern: $ => terminal('_'),

    VarPattern: $ => seq(
        label('name', 'identifier'),
        '@',
        label('pattern', $.Pattern),
    ),

    RangePattern: $ => seq(
        optional(
            label('lower', $.Expr),
        ),
        '...',
        optional(
            label('upper', $.Expr),
        ),
    ),

    OrPattern: $ => sepBy1($.Pattern, '|'),

    Literal: $ => choice(
        $.BoolLiteral,
        $.NullLiteral,
        $.IntLiteral,
        $.CharLiteral,
        $.StringLiteral,
    ),

    BoolLiteral: $ => choice('true', 'false'),

    NullLiteral: $ => terminal('null'),

    IntLiteral: $ => terminal('number_literal'),

    CharLiteral: $ => terminal('char_literal'),

    StringLiteral: $ => terminal('string_literal'),
});
