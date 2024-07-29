import { Token, TokenKind } from '../token.js';
import assert from 'assert';
import util from 'util';
import { Point, SyntaxNode, Tree, TreeCursor } from '../tree.js';

export function pointEqual(a: Point, b: Point): boolean {
    return a.row === b.row && a.column === b.column;
}

export function pointGte(a: Point, b: Point): boolean {
    return a.row > b.row || (a.row === b.row && a.column >= b.column);
}

export function pointLte(a: Point, b: Point): boolean {
    return pointGte(b, a);
}

export abstract class SyntaxNodeImpl implements SyntaxNode {
    private _type: string;
    private _isNamed: boolean;
    private _startPosition: Point;
    private _startIndex: number;
    private _tree: Tree;
    private _parent: SyntaxNodeImpl | null = null;
    private _children: Array<{ field?: string; node: SyntaxNodeImpl }> = [];

    constructor(
        type: string,
        isNamed: boolean,
        startPosition: Point,
        startIndex: number,
        tree: Tree,
        children?: Array<{ field?: string; node: SyntaxNodeImpl }>,
    ) {
        this._type = type;
        this._isNamed = isNamed;
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

    get isNamed(): boolean {
        return this._isNamed;
    }

    get isMissing(): boolean {
        return false;
    }

    get isExtra(): boolean {
        return false;
    }

    get hasError(): boolean {
        return this.children.some(child => child.hasError);
    }

    get isError(): boolean {
        return false;
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

    get children(): Array<SyntaxNode> {
        return this._children.map(child => child.node);
    }

    get namedChildren(): Array<SyntaxNode> {
        return this._children.filter(child => child.node.isNamed).map(child => child.node);
    }

    get childCount(): number {
        return this._children.length;
    }

    get namedChildCount(): number {
        return this._children.filter(child => child.node.isNamed).length;
    }

    get firstChild(): SyntaxNode | null {
        return this._children[0]?.node ?? null;
    }

    get lastChild(): SyntaxNode | null {
        return this._children[this.childCount - 1]?.node ?? null;
    }

    get firstNamedChild(): SyntaxNode | null {
        return this.namedChildren[0] ?? null;
    }

    get lastNamedChild(): SyntaxNode | null {
        return this.namedChildren[this.namedChildren.length - 1] ?? null;
    }

    get nextSibling(): SyntaxNode | null {
        return this.parent?.children[this.parent.children.indexOf(this) + 1] ?? null;
    }

    get previousSibling(): SyntaxNode | null {
        return this.parent?.children[this.parent.children.indexOf(this) - 1] ?? null;
    }

    get nextNamedSibling(): SyntaxNode | null {
        return this.parent?.namedChildren[this.parent.namedChildren.indexOf(this) + 1] ?? null;
    }

    get previousNamedSibling(): SyntaxNode | null {
        return this.parent?.namedChildren[this.parent.namedChildren.indexOf(this) - 1] ?? null;
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

    namedChild(index: number): SyntaxNode | null {
        return this.namedChildren[index] ?? null;
    }

    childForFieldName(fieldName: string): SyntaxNode | null {
        return this._children.find(child => child.field === fieldName)?.node ?? null;
    }

    fieldNameForChild(childIndex: number): string | null {
        return this._children[childIndex]?.field ?? null;
    }

    childrenForFieldName(fieldName: string): Array<SyntaxNode> {
        return this._children.filter(child => child.field === fieldName).map(child => child.node);
    }

    firstChildForIndex(index: number): SyntaxNode | null {
        return this._children.find(child => child.node.startIndex >= index)?.node ?? null;
    }

    firstNamedChildForIndex(index: number): SyntaxNode | null {
        return this.namedChildren.find(child => child.startIndex >= index) ?? null;
    }

    descendantForPosition(position: Point): SyntaxNode;
    descendantForPosition(startPosition: Point, endPosition: Point): SyntaxNode;
    descendantForPosition(startPosition: Point, endPosition?: Point): SyntaxNode {
        endPosition ??= startPosition;
        return (function search(node: SyntaxNodeImpl): SyntaxNode | null {
            if (!pointLte(node.startPosition, startPosition) || !pointLte(endPosition, node.endPosition)) {
                return null;
            }
            for (const child of node._children) {
                const node = search(child.node);
                if (node) {
                    return node;
                }
            }
            return node;
        })(this) || this;
    }

    namedDescendantForPosition(position: Point): SyntaxNode;
    namedDescendantForPosition(startPosition: Point, endPosition: Point): SyntaxNode;
    namedDescendantForPosition(startPosition: unknown, endPosition?: unknown): SyntaxNode {
        const descendant = this.descendantForPosition(startPosition as Point, endPosition as Point);
        return (function namedParent(node: SyntaxNode): SyntaxNode {
            if (node.isNamed) {
                return node;
            }
            return namedParent(node.parent!);
        })(descendant);
    }

    closest(types: string | Array<string>): SyntaxNode | null {
        if (typeof types === 'string') {
            types = [types];
        }
        return types.includes(this.type)
            ? this
            : this.parent?.closest(types)
            ?? null;
    }

    walk(): TreeCursor {
        return new TreeCursorImpl(this);
    }
}

export class CompositeNodeImpl extends SyntaxNodeImpl {
    constructor(
        type: string,
        isNamed: boolean,
        startPosition: Point,
        startIndex: number,
        tree: Tree,
        children?: Array<{ field?: string; node: SyntaxNodeImpl }>,
    ) {
        super(type, isNamed, startPosition, startIndex, tree, children);
    }
}

export class TokenNodeImpl extends SyntaxNodeImpl {
    private _token: Token;

    constructor(
        tree: Tree,
        token: Token,
        overrideType?: string,
    ) {
        const type = overrideType ?? token.kind;
        const isNamed = !!overrideType;
        super(type, isNamed, token.startPosition, token.startIndex, tree);
        this._token = token;
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

    override pretty(level: number): string {
        let text = '';
        text += indent(level);
        text += JSON.stringify(this.text);
        text += prettyPosition(this.startPosition);
        text += '\n';
        return text;
    }
}

export class MissingTokenNodeImpl extends SyntaxNodeImpl {
    constructor(
        kind: TokenKind,
        startPosition: Point,
        startIndex: number,
        tree: Tree,
    ) {
        super(kind, false, startPosition, startIndex, tree);
    }

    override get isMissing(): boolean {
        return true;
    }

    override pretty(level: number): string {
        let text = '';
        text += indent(level);
        text += 'MISSING ' + JSON.stringify(this.type);
        text += prettyPosition(this.startPosition);
        text += '\n';
        return text;
    }
}

export class TreeCursorImpl implements TreeCursor {
    private root: SyntaxNode;
    private node: SyntaxNode;
    private depth: number;

    constructor(root: SyntaxNode) {
        this.root = root;
        this.node = root;
        this.depth = 0;
    }

    get nodeType(): string {
        return this.node.type;
    }

    get nodeText(): string {
        return this.node.text;
    }

    get nodeIsNamed(): boolean {
        return this.node.isNamed;
    }

    get nodeIsMissing(): boolean {
        return this.node.isMissing;
    }

    get startPosition(): Point {
        return this.node.startPosition;
    }

    get endPosition(): Point {
        return this.node.endPosition;
    }

    get startIndex(): number {
        return this.node.startIndex;
    }

    get endIndex(): number {
        return this.node.endIndex;
    }

    get currentNode(): SyntaxNode {
        return this.node;
    }

    get currentFieldName(): string {
        const index = this.node.parent?.children.indexOf(this.node) ?? -1;
        return this.node.parent?.fieldNameForChild(index) ?? '';
    }

    get currentDepth(): number {
        return this.depth;
    }

    reset(node: SyntaxNode): void {
        this.root = node;
        this.node = node;
        this.depth = 0;
    }

    resetTo(cursor: TreeCursor): void {
        this.reset(cursor.currentNode);
    }

    gotoParent(): boolean {
        if (this.node === this.root) {
            return false;
        }

        const parent = this.node.parent;
        assert(parent);
        this.node = parent;

        assert(this.depth > 0);
        this.depth--;
        return true;
    }

    gotoFirstChild(): boolean {
        return this.gotoChild(0);
    }

    gotoLastChild(): boolean {
        return this.gotoChild(this.node.childCount - 1);
    }

    gotoFirstChildForIndex(goalIndex: number): boolean {
        const index = this.node.children.findIndex(child => child.startIndex >= goalIndex);
        return this.gotoChild(index);
    }

    gotoFirstChildForPosition(goalPosition: Point): boolean {
        const index = this.node.children.findIndex(child => pointGte(child.startPosition, goalPosition));
        return this.gotoChild(index);
    }

    gotoNextSibling(): boolean {
        return this.gotoSibling(1);
    }

    gotoPreviousSibling(): boolean {
        return this.gotoSibling(-1);
    }

    private gotoChild(index: number): boolean {
        if (index < 0 || index >= this.node.childCount) {
            return false;
        }
        this.node = this.node.child(index)!;
        this.depth++;
        return true;
    }

    private gotoSibling(offset: number): boolean {
        if (this.node === this.root) {
            return false;
        }

        const parent = this.node.parent;
        assert(parent);

        const index = parent.children.indexOf(this.node);
        assert(index !== -1);
        const siblingIndex = index + offset;
        if (siblingIndex < 0 || siblingIndex >= parent.childCount) {
            return false;
        }
        this.node = parent.child(siblingIndex)!;
        return true;
    }
}

export class TreeImpl implements Tree {
    constructor(
        public text: string,
        public rootNode: SyntaxNode,
    ) {
        this.rootNode = rootNode;
    }

    walk(): TreeCursor {
        return new TreeCursorImpl(this.rootNode);
    }
}

function prettyPosition(pos: Point): string {
    return `@${pos.row + 1}:${pos.column + 1}`;
}

function indent(level: number) {
    return '  '.repeat(level);
}
