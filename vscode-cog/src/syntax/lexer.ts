import assert from 'assert';
import { CharCursor } from './charCursor.js';
import { keywords, symbols, Token, TokenKind } from './token.js';
import { Point } from './tree.js';
import { ErrorSink } from './ErrorSink.js';

export function* tokenize(text: string, errorSink: ErrorSink): Generator<Token, Token> {
    const lexer = new Lexer(text, errorSink);
    while (true) {
        yield lexer.scanToken();
    }
}

export class Lexer {
    private startPos!: Point;
    private startIndex!: number;
    private cursor: CharCursor;
    private trivia: string[] = [];

    constructor(private text: string, private errors: ErrorSink) {
        this.cursor = new CharCursor(text);
    }

    private get cc() {
        return this.cursor.cc;
    }

    private get pos() {
        return this.cursor.pos;
    }

    private get index() {
        return this.cursor.index;
    }

    private get isEof() {
        return this.cursor.isEof;
    }

    private get lexeme(): string {
        return this.text.slice(this.startIndex, this.index);
    }

    private isAt(str: string | RegExp) {
        return this.cursor.isAt(str);
    }

    private bump(count = 1) {
        for (let i = 0; i < count; i++) {
            this.cursor.bump();
        }
    }

    private addError(position: Point, message: string) {
        this.errors.add({ position, message });
    }

    private makeToken(kind: TokenKind, lexeme?: string): Token {
        const startPosition = this.startPos;
        const startIndex = this.startIndex;
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
            startPosition,
            startIndex,
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
            this.startIndex = this.index;
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
            this.startIndex = this.index;
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
            this.addError(this.pos, 'Unterminated block comment');
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
        assert(this.isAt('"'));
        this.bump();
        while (!this.isEof && this.cc !== '"') {
            this.scanCharPart();
        }
        if (this.isEof) {
            this.addError(this.pos, 'Unterminated string literal');
        }
        this.bump();
        return this.makeToken('string_literal');
    }

    private scanChar() {
        assert(this.isAt('\''));
        this.bump();

        if (!this.isEof) {
            if (!this.isAt('\'')) {
                this.scanCharPart();
                if (this.isAt('\'')) {
                    this.bump();
                } else {
                    this.addError(this.pos, 'Unterminated character literal');
                }
            } else {
                this.addError(this.pos, 'Empty character literal');
            }
        } else {
            this.addError(this.pos, 'Unterminated character literal');
        }

        return this.makeToken('char_literal');
    }

    private scanCharPart() {
        assert(!this.isEof);

        if (this.isAt('\\')) {
            this.bump();
            if (this.isEof) {
                this.addError(this.pos, 'Unterminated escape sequence');
            } else {
                this.bump();
            }
        } else {
            this.bump();
        }
    }

    private scanNumber() {
        while (!this.isEof && /\d/.test(this.cc)) {
            this.bump();
        }
        return this.makeToken('number_literal');
    }

    private scanWord() {
        while (!this.isEof && /\w/.test(this.cc)) {
            this.bump();
        }
        const kind = Lexer.isKeyword(this.lexeme) ? this.lexeme : 'identifier';
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
        this.addError(this.pos, 'Unknown character');
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
                throw new Error(`Invalid filter: ${never}`);
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
