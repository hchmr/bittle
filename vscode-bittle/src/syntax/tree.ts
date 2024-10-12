import { Point } from './position';

export interface SyntaxNode {
    readonly type: string;

    readonly text: string;

    readonly startPosition: Point;
    readonly endPosition: Point;
    readonly startIndex: number;
    readonly endIndex: number;

    readonly tree: Tree;
    readonly parent: SyntaxNode | null;
    readonly children: Array<SyntaxNode>;
    readonly childCount: number;
    readonly firstChild: SyntaxNode | null;
    readonly lastChild: SyntaxNode | null;
    readonly nextSibling: SyntaxNode | null;
    readonly previousSibling: SyntaxNode | null;

    toString(): string;
    pretty(): string;

    child(index: number): SyntaxNode | null;
    childForFieldName(fieldName: string): SyntaxNode | null;
    fieldNameForChild(childIndex: number): string | null;
    childrenForFieldName(fieldName: string): Array<SyntaxNode>;

    descendantForPosition(position: Point): SyntaxNode;
    descendantForPosition(startPosition: Point, endPosition: Point): SyntaxNode;

    descendantsForPosition(position: Point): Array<SyntaxNode>;
    descendantsForPosition(startPosition: Point, endPosition: Point): Array<SyntaxNode>;

    closest(types: string | Array<string>): SyntaxNode | null;
}

export interface Tree {
    readonly text: string;
    readonly rootNode: SyntaxNode;
}
