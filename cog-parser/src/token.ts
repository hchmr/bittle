import { Point } from './tree.js';

export type Token = {
    kind: TokenKind;
    lexeme: string;
    startPosition: Point;
    startIndex: number;
    leadingTrivia: string[];
    trailingTrivia: string[];
};

export type TokenKind =
    | '<eof>'
    | 'identifier'
    | 'number_literal'
    | 'string_literal'
    | 'char_literal'
    | '<error>'
    | (typeof symbols)[number]
    | (typeof keywords)[number];

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
    '~',
    '|',
    '||',
    '&',
    '&&',
    '>',
    '>>',
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
    '<=',
    '<-',
    '<<=',
    '+',
    '+=',
    '-',
    '-=',
    '->',
    '*',
    '/',
    '%',
    '^',
] as const;

export const keywords = [
    'as',
    'break',
    'const',
    'continue',
    'do',
    'else',
    'enum',
    'extern',
    'false',
    'func',
    'if',
    'include',
    'null',
    'return',
    'sizeof',
    'struct',
    'true',
    'var',
    'while',
] as const;
