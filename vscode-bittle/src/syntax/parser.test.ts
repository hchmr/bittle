import { expect, test } from 'vitest';
import { Error, ErrorSink } from './errorSink.js';
import { tokenize } from './lexer.js';
import { Parser } from './parser.js';
import { Tree } from './tree.js';

function parse(text: string): [Tree, Error[]] {
    const errors: Error[] = [];

    const errorSink: ErrorSink = {
        add(error: Error) {
            errors.push(error);
        },
    };

    const tokenizer = tokenize(text, errorSink);

    const parser = new Parser(text, tokenizer, errorSink);

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
`;

const bad = `
func add(a: Int, b: Int): Int {

func maine( {
    print("Helo wolrdn\\n");
`;

test('parser:good', () => {
    const [tree, errors] = parse(good);
    expect(errors).toStrictEqual([]);
});

test('parser:bad', () => {
    const [tree, errors] = parse(bad);
    expect(errors).toMatchSnapshot();
});

test('prettySyntaxTree:good', () => {
    const [tree, _errors] = parse(good);
    expect(tree.rootNode.pretty()).toMatchSnapshot();
});

test('prettySyntaxTree:bad', () => {
    const [tree, _errors] = parse(bad);
    expect(tree.rootNode.pretty()).toMatchSnapshot();
});
