import { Point } from './tree.js';

export type Token = {
    kind: TokenKind;
    lexeme: string;
    startPosition: Point;
    leadingTrivia: string[];
    trailingTrivia: string[];
};

export type TokenKind =
    | '<eof>'
    | '<identifier>'
    | '<int>'
    | '<string>'
    | '<char>'
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
    'func',
    'if',
    'include',
    'return',
    'sizeof',
    'struct',
    'var',
    'while',
] as const;
