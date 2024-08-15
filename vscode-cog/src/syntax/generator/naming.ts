import assert from 'assert';
import { stream } from '../../utils/stream';

export function pluralize(name: string): string {
    return name + 's';
}

export function capitalize(name: string): string {
    return name[0].toUpperCase() + name.slice(1);
}

export function decapitalize(name: string): string {
    return name[0].toLowerCase() + name.slice(1);
}

const symNameMap = new Map<string, string>(Object.entries({
    '_': 'Underscore',
    '-': 'Minus',
    ',': 'Comma',
    ';': 'Semicolon',
    ':': 'Colon',
    '!': 'Excl',
    '?': 'Quest',
    '.': 'Dot',
    '(': 'LPar',
    ')': 'RPar',
    '[': 'LBracket',
    ']': 'RBracket',
    '{': 'LBrace',
    '}': 'RBrace',
    '@': 'At',
    '*': 'Star',
    '/': 'Slash',
    '\\': 'Backslash',
    '&': 'Amp',
    '#': 'Hash',
    '%': 'Perc',
    '`': 'Backtick',
    '^': 'Caret',
    '+': 'Plus',
    '<': 'Lt',
    '=': 'Eq',
    '>': 'Gt',
    '|': 'Pipe',
    '~': 'Tilde',
    '$': 'Dollar',
}));

export function tokenNameToFieldName(name: string): string {
    const temp = stream(name)
        .map(c => {
            if (/\w/.test(c)) {
                return c;
            } else if (symNameMap.has(c)) {
                return symNameMap.get(c)!;
            } else {
                throw new Error(`Invalid character in token name: ${c}`);
            }
        })
        .join('')
        .replaceAll(/_(\w)/g, (_, c) => c.toUpperCase());
    return decapitalize(temp) + 'Token';
}

export function nodeNameToFieldName(name: string): string {
    assert(/^[^\W\d]\w*$/.test(name), `Invalid node name: ${name}`);
    return decapitalize(name) + 'Node';
}
