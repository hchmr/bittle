import util from 'util';
import { stream } from '../utils/stream';
import { Point, pointGt, pointLt, PointRange, rangeContains } from './position';
import { Token, TokenKind } from './token.js';
import { ClosestNodes, SyntaxNode, Tree } from './tree.js';

export abstract class SyntaxNodeImpl implements SyntaxNode {
    private _type: string;
    private _startPosition: Point;
    private _startIndex: number;
    private _tree: Tree;
    private _parent: SyntaxNodeImpl | null = null;
    private _children: { field?: string; node: SyntaxNodeImpl }[] = [];

    constructor(
        type: string,
        startPosition: Point,
        startIndex: number,
        tree: Tree,
        children?: { field?: string; node: SyntaxNodeImpl }[],
    ) {
        this._type = type;
        this._startPosition = startPosition;
        this._startIndex = startIndex;
        this._tree = tree;
        if (children) {
            this._children = children;
            for (const child of children) {
                child.node._parent = this;
            }
        }
    }

    get type(): string {
        return this._type;
    }

    get text(): string {
        return this.tree.text.slice(this.startIndex, this.endIndex);
    }

    get startPosition(): Point {
        return this._startPosition;
    }

    get endPosition(): Point {
        if (this.childCount === 0) {
            return this.startPosition;
        } else {
            return this.lastChild!.endPosition;
        }
    }

    get startIndex(): number {
        return this._startIndex;
    }

    get endIndex(): number {
        if (this.childCount === 0) {
            return this.startIndex;
        } else {
            return this.lastChild!.endIndex;
        }
    }

    get tree(): Tree {
        return this._tree;
    }

    get parent(): SyntaxNode | null {
        return this._parent;
    }

    get children(): SyntaxNode[] {
        return this._children.map(child => child.node);
    }

    get childCount(): number {
        return this._children.length;
    }

    get firstChild(): SyntaxNode | null {
        return this._children[0]?.node ?? null;
    }

    get lastChild(): SyntaxNode | null {
        return this._children[this.childCount - 1]?.node ?? null;
    }

    get nextSibling(): SyntaxNode | null {
        return this.parent?.children[this.parent.children.indexOf(this) + 1] ?? null;
    }

    get previousSibling(): SyntaxNode | null {
        return this.parent?.children[this.parent.children.indexOf(this) - 1] ?? null;
    }

    [util.inspect.custom]() {
        return {
            type: this.type,
            childCount: this.childCount,
            startPosition: this.startPosition,
        };
    }

    toString(): string {
        let text = '(' + this.type;
        if (this.childCount > 0) {
            text += ' ' + this.children.map(child => child.toString()).join(' ');
        }
        return text + ')';
    }

    pretty(level = 0): string {
        let text = '';
        text += indent(level);
        text += this.type;
        text += prettyPosition(this.startPosition);
        text += '\n';
        for (const child of this._children) {
            text += child.node.pretty(level + 1);
        }
        return text;
    }

    child(index: number): SyntaxNode | null {
        return this._children[index]?.node ?? null;
    }

    childForFieldName(fieldName: string): SyntaxNode | null {
        return this._children.find(child => child.field === fieldName)?.node ?? null;
    }

    fieldNameForChild(childIndex: number): string | null {
        return this._children[childIndex]?.field ?? null;
    }

    childrenForFieldName(fieldName: string): SyntaxNode[] {
        return this._children.filter(child => child.field === fieldName).map(child => child.node);
    }

    descendantForPosition(startPosition: Point, endPosition?: Point): SyntaxNode {
        const searchRange: PointRange = { startPosition, endPosition: endPosition ?? startPosition };
        return (function search(node: SyntaxNodeImpl): SyntaxNode {
            return stream(node._children)
                .filter(child => rangeContains(child.node, searchRange))
                .map(child => search(child.node))
                .first() ?? node;
        })(this);
    }

    descendantsForPosition(startPosition: Point, endPosition?: Point): SyntaxNode[] {
        const searchRange: PointRange = { startPosition, endPosition: endPosition ?? startPosition };
        return Array.from(
            (function search(node: SyntaxNodeImpl): Iterable<SyntaxNode> {
                return stream(node._children)
                    .filter(child => rangeContains(child.node, searchRange))
                    .flatMap(child => search(child.node))
                    .defaultIfEmpty(node);
            })(this),
        );
    }

    closestDescendantsForPosition(position: Point): ClosestNodes {
        if (!this.childCount) {
            return { left: this, right: this };
        }

        const { left, right } = this.closestChildrenForPosition(position);

        if (right && !left) {
            // The position is before the first child.
            return right.closestDescendantsForPosition(position);
        } else if (left && left === right) {
            // The position is inside a child
            return left.closestDescendantsForPosition(position);
        } else if (left && !right) {
            // The position is after the last child.
            return left.closestDescendantsForPosition(position);
        } else if (left && right) {
            // The position is between two children.
            const leftDescendants = left.closestDescendantsForPosition(position);
            const rightDescendants = right.closestDescendantsForPosition(position);
            return {
                left: leftDescendants.left!,
                right: rightDescendants.right!,
            };
        } else {
            throw new Error('Unreachable');
        }
    }

    closestChildrenForPosition(position: Point): ClosestNodes {
        if (!this.childCount) {
            return { left: this, right: this };
        }

        const leftIdx = this._children.findLastIndex(child => pointLt(child.node.startPosition, position));
        if (leftIdx === -1) {
            // The position is before the first child.
            return { left: undefined, right: this._children[0].node };
        } else if (pointGt(this._children[leftIdx].node.endPosition, position)) {
            // The position is inside a child.
            return { left: this._children[leftIdx].node, right: this._children[leftIdx].node };
        } else if (leftIdx === this.childCount - 1) {
            // The position is after the last child.
            return { left: this._children[leftIdx].node, right: undefined };
        } else {
            // The position is between two children.
            const rightIdx = leftIdx + 1;
            return {
                left: this._children[leftIdx].node,
                right: this._children[rightIdx].node,
            };
        }
    }

    closest(types: string | string[]): SyntaxNode | null {
        if (typeof types === 'string') {
            types = [types];
        }
        return types.includes(this.type)
            ? this
            : this.parent?.closest(types) ?? null;
    }
}

export class CompositeNodeImpl extends SyntaxNodeImpl {
}

export class TokenNodeImpl<Kind extends TokenKind> extends SyntaxNodeImpl {
    private _token: Token;

    constructor(
        tree: Tree,
        public token: Token<Kind>,
    ) {
        const type = token.kind;
        super(type, token.startPosition, token.startIndex, tree);
        this._token = token;
    }

    override get type(): Kind {
        return super.type as Kind;
    }

    override get endPosition(): Point {
        const startPosition = this._token.startPosition;
        const length = this._token.lexeme.length;
        return {
            row: startPosition.row,
            column: startPosition.column + length,
        };
    }

    override get endIndex(): number {
        return this.startIndex + this._token.lexeme.length;
    }

    override pretty(level: number = 0): string {
        let text = '';
        text += indent(level);
        text += JSON.stringify(this.text);
        text += prettyPosition(this.startPosition);
        text += '\n';
        return text;
    }
}

export class TreeImpl implements Tree {
    constructor(
        public text: string,
        public rootNode: SyntaxNode,
    ) {
        this.rootNode = rootNode;
    }
}

function prettyPosition(pos: Point): string {
    return `@${pos.row + 1}:${pos.column + 1}`;
}

function indent(level: number) {
    return '  '.repeat(level);
}

function* rev<T>(source: Iterable<T>): Iterable<T> {
    const array = Array.from(source);
    for (let i = array.length; i-- > 0;) {
        yield array[i - 1];
    }
}
