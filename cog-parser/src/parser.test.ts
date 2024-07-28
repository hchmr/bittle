import { expect, test } from 'vitest'
import { ErrorSink, Parser } from './parser.js';
import { tokenize } from './lexer.js';
import { reconstructText, prettySyntaxTree, SyntaxNode } from './nodes.js';
import { Position } from './token.js';

type SyntaxError = { pos: Position, message: string };

function parse(text: string): [SyntaxNode, SyntaxError[]] {
    const errors: SyntaxError[] = [];


    const parser = new Parser(
        tokenize(text),
        <ErrorSink>{
            add(pos, message: string) {
                errors.push({ pos, message });
            }
        }
    );

    const tree = parser.top();

    return [tree, errors];
}

const good = `
struct Point {
    x: Int,
    y: Int,
}
func sqr_dst(p1: *Point, p2: *Point): Int {
    var dx = p2.x - p1.x;
    var dy = p2.y - p1.y;
    return dx * dx + dy * dy;
}
`

const bad = `
func add(a: Int, b: Int): Int {

func maine( {
    print("Helo wolrdn\\n");
`

test('parser:good', () => {
    const [tree, errors] = parse(good);
    expect(errors).toStrictEqual([]);
});

test('parser:bad', () => {
    const [tree, errors] = parse(bad);
    expect(errors).toMatchSnapshot();
});

test('reconstructText:good', () => {
    const [tree, _errors] = parse(good);
    expect(reconstructText(tree)).toEqual(good);
})

test('reconstructText:bad', () => {
    const [tree, _errors] = parse(bad);
    expect(reconstructText(tree)).toEqual(bad);
});

test('prettySyntaxTree:good', () => {
    const [tree, _errors] = parse(good);
    expect(prettySyntaxTree(tree)).toMatchSnapshot();
})

test('prettySyntaxTree:bad', () => {
    const [tree, _errors] = parse(bad);
    expect(prettySyntaxTree(tree)).toMatchSnapshot();
})
