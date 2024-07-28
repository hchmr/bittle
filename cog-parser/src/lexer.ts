import assert from 'assert';
import { keywords, Position, symbols, Token, TokenKind } from './token.js';
import { CharCursor } from './charCursor.js';

export function* tokenize(text: string) {
    const lexer = new Lexer(text);
    while (true) {
        yield lexer.scanToken();
    }
}

export class Lexer {
    private startPos!: Position;
    private cursor: CharCursor;
    private trivia: string[] = [];

    constructor(private text: string) {
        this.cursor = new CharCursor(text);
    }

    private get cc() {
        return this.cursor.cc;
    }

    private get pos() {
        return this.cursor.pos;
    }

    private get isEof() {
        return this.cursor.isEof;
    }

    private get lexeme(): string {
        return this.text.slice(this.startPos.index, this.pos.index);
    }

    private isAt(str: string | RegExp) {
        return this.cursor.isAt(str);
    }

    private bump(count = 1) {
        for (let i = 0; i < count; i++) {
            this.cursor.bump();
        }
    }

    private makeToken(kind: TokenKind, lexeme?: string): Token {
        lexeme ??= this.lexeme;

        // Leading trivia
        const leadingTrivia = this.trivia;
        this.trivia = [];

        this.skipTralingTrivia();

        // Trailing trivia
        const trailingTrivia = this.trivia;
        this.trivia = [];

        return {
            kind,
            lexeme,
            position: this.startPos,
            leadingTrivia,
            trailingTrivia,
        };
    }

    scanToken(): Token {
        if (this.isEof) {
            return this.makeToken('<eof>', '');
        }

        let token: Token | undefined;

        while (!token) {
            this.startPos = this.pos;
            const scanner = Lexer.table(this.cc);
            token = scanner.call(this);
        }

        return token;
    }

    private skipTralingTrivia() {
        const tokenRow = this.pos.row;

        // Trailing trivia
        while (
            this.pos.row === tokenRow
            && !this.isEof
            && (this.isAt('//') || this.isAt('/*') || /\s/.test(this.cc))
        ) {
            this.startPos = this.pos;
            this.skipSingleTrivia();
        }
    }

    private skipSingleTrivia(): undefined {
        if (this.isAt('//')) {
            this.skipLineComment();
        } else if (this.isAt('/*')) {
            this.skipBlockComment();
        } else if (/\s/.test(this.cc)) {
            this.skipWhitespace();
        } else {
            throw new Error('Invalid trivia');
        }
    }

    // Skips whitespace characters on the current line
    private skipWhitespace(): undefined {
        assert(this.isAt(/\s/y));

        while (!this.isEof && /[^\S\n]/.test(this.cc)) {
            this.bump();
        }
        if (!this.isEof && this.cc === '\n') {
            this.bump();
        }

        this.trivia.push(this.lexeme);
    }

    private skipLineComment() {
        assert(this.isAt('//'));
        this.bump();
        this.bump();
        while (!this.isEof && this.cc !== '\n') {
            this.bump();
        }
        this.trivia.push(this.lexeme);
    }

    private skipBlockComment() {
        assert(this.isAt('/*'));
        this.bump();
        this.bump();
        while (!this.isEof && !this.isAt('*/')) {
            this.bump();
        }
        if (!this.isEof) {
            this.bump();
            this.bump();
        } else {
            console.error(this.pos, 'Unterminated block comment');
        }
        this.trivia.push(this.lexeme);
    }

    private scanSlash() {
        if (this.isAt('//') || this.isAt('/*')) {
            return this.skipSingleTrivia();
        } else {
            return this.scanSymbol();
        }
    }

    private scanString() {
        this.bump();
        while (!this.isEof && this.cc !== '"') {
            this.scanCharPart();
        }
        if (this.isEof) {
            console.error(this.pos, 'Unterminated string literal');
        }
        this.bump();
        return this.makeToken('<string>');
    }

    private scanChar() {
        this.bump();
        if (!this.isEof) {
            if (this.cc !== '\'') {
                this.scanCharPart();
            }
            if (this.cc === '\'') {
                this.bump();
            } else {
                console.error(this.pos, 'Invalid character literal');
            }
        } else {
            console.error(this.pos, 'Unterminated character literal');
        }
        return this.makeToken('<char>');
    }

    private scanCharPart() {
        if (this.cc === '\\') {
            this.bump();
        }
        this.bump();
    }

    private scanNumber() {
        while (!this.isEof && /\d/.test(this.cc)) {
            this.bump();
        }
        return this.makeToken('<int>');
    }

    private scanWord() {
        while (!this.isEof && /\w/.test(this.cc)) {
            this.bump();
        }
        const kind = Lexer.isKeyword(this.lexeme) ? this.lexeme : '<identifier>';
        return this.makeToken(kind);
    }

    private scanSymbol() {
        for (const symbol of Lexer.symbols) {
            if (this.isAt(symbol)) {
                this.bump(symbol.length);
                return this.makeToken(symbol);
            }
        }
    }

    private scanUnknown() {
        console.error(this.pos, 'Unknown character');
        this.bump();
        return this.makeToken('<error>');
    }

    static table = buildLookupTable(
        [
            createRule(/\s/, Lexer.prototype.skipWhitespace),
            createRule('/', Lexer.prototype.scanSlash),
            createRule('"', Lexer.prototype.scanString),
            createRule('\'', Lexer.prototype.scanChar),
            createRule(/[0-9]/, Lexer.prototype.scanNumber),
            createRule(/[^\W\d]/, Lexer.prototype.scanWord),
            createRule(new Set(symbols.flatMap(s => s)), Lexer.prototype.scanSymbol),
        ],
        Lexer.prototype.scanUnknown,
    );

    static keywords = Object.freeze(new Set<string>(keywords));

    static symbols = Object.freeze(symbols.toSorted((a, b) => b.length - a.length));

    static isKeyword(lexeme: string): lexeme is typeof keywords[number] {
        return Lexer.keywords.has(lexeme);
    }
}

function buildLookupTable<Self>(
    rules: {
        filter: RegExp | string | Set<string>;
        scanner: (this: Self) => Token | undefined;
    }[],
    fallback: (this: Self) => Token,
): (char: string) => (this: Self) => Token | undefined {
    const table = new Array(128).fill(null);
    for (let i = 0; i < 128; i++) {
        const char = String.fromCharCode(i);
        for (const { filter, scanner } of rules) {
            let test: (char: string) => boolean;
            if (filter instanceof RegExp) {
                test = (char: string) => filter.test(char);
            } else if (typeof filter === 'string') {
                test = (char: string) => char === filter;
            } else if (filter instanceof Set) {
                test = (char: string) => filter.has(char);
            } else {
                const never: never = filter;
                throw never;
            }

            if (test(char)) {
                table[i] = scanner;
                break;
            }
        }
    }

    return (char: string) => table[char.charCodeAt(0)] ?? fallback;
}

function createRule<Self>(
    filter: RegExp | string | Set<string>,
    scanner: (this: Self) => Token | undefined,
) {
    return { filter, scanner };
}
