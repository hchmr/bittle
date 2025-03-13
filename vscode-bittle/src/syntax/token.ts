import { Point } from './position';

export interface Token<Kind extends TokenKind = TokenKind> {
    kind: Kind;
    lexeme: string;
    startPosition: Point;
    startIndex: number;
    leadingTrivia: string[];
    trailingTrivia: string[];
};

export type TokenKind = (typeof tokenKinds)[number];

export const symbols = [
    '(',
    ')',
    '{',
    '}',
    '[',
    ']',
    ':',
    ';',
    '.',
    ',',
    '...',
    '..=',
    '..<',
    '@',
    '~',
    '|',
    '|=',
    '||',
    '&',
    '&=',
    '&&',
    '>',
    '>>',
    '>>=',
    '>=',
    '>>=',
    '=',
    '==',
    '=>',
    '!',
    '!=',
    '?',
    '<',
    '<<',
    '<<=',
    '<=',
    '<-',
    '<<=',
    '+',
    '+=',
    '+=',
    '-',
    '-=',
    '-=',
    '->',
    '*',
    '*=',
    '/',
    '/=',
    '%',
    '%=',
    '^',
    '^=',
] as const;

export const keywords = [
    'as',
    'break',
    'case',
    'const',
    'continue',
    'do',
    'else',
    'enum',
    'extern',
    'false',
    'for',
    'func',
    'if',
    'is',
    'include',
    'match',
    'mut',
    'null',
    'return',
    'sizeof',
    'struct',
    'true',
    'typeof',
    'union',
    'var',
    'while',
    '_',
] as const;

export const tokenKinds = [
    '<eof>',
    'identifier',
    'number_literal',
    'string_literal',
    'char_literal',
    '<error>',
    ...symbols,
    ...keywords,
] as const;
