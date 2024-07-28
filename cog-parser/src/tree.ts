export type Point = {
    row: number;
    column: number;
};

export type Range = {
    startIndex: number;
    endIndex: number;
    startPosition: Point;
    endPosition: Point;
};

export interface SyntaxNode {
    tree: Tree;
    id: number;
    type: string;
    isNamed: boolean;
    isMissing: boolean;
    isExtra: boolean;
    hasError: boolean;
    isError: boolean;
    text: string;

    startPosition: Point;
    endPosition: Point;
    startIndex: number;
    endIndex: number;

    parent: SyntaxNode | null;
    children: Array<SyntaxNode>;
    namedChildren: Array<SyntaxNode>;
    childCount: number;
    namedChildCount: number;
    firstChild: SyntaxNode | null;
    firstNamedChild: SyntaxNode | null;
    lastChild: SyntaxNode | null;
    lastNamedChild: SyntaxNode | null;
    nextSibling: SyntaxNode | null;
    nextNamedSibling: SyntaxNode | null;
    previousSibling: SyntaxNode | null;
    previousNamedSibling: SyntaxNode | null;
    descendantCount: number;

    toString(): string;
    child(index: number): SyntaxNode | null;
    namedChild(index: number): SyntaxNode | null;
    childForFieldName(fieldName: string): SyntaxNode | null;
    fieldNameForChild(childIndex: number): string | null;
    childrenForFieldName(fieldName: string): Array<SyntaxNode>;
    firstChildForIndex(index: number): SyntaxNode | null;
    firstNamedChildForIndex(index: number): SyntaxNode | null;

    descendantForIndex(index: number): SyntaxNode;
    descendantForIndex(startIndex: number, endIndex: number): SyntaxNode;
    namedDescendantForIndex(index: number): SyntaxNode;
    namedDescendantForIndex(startIndex: number, endIndex: number): SyntaxNode;
    descendantForPosition(position: Point): SyntaxNode;
    descendantForPosition(startPosition: Point, endPosition: Point): SyntaxNode;
    namedDescendantForPosition(position: Point): SyntaxNode;
    namedDescendantForPosition(startPosition: Point, endPosition: Point): SyntaxNode;
    descendantsOfType(types: string | Array<string>, startPosition?: Point, endPosition?: Point): Array<SyntaxNode>;

    closest(types: string | Array<string>): SyntaxNode | null;
    walk(): TreeCursor;
}

export interface TreeCursor {
    nodeType: string;
    nodeText: string;
    nodeIsNamed: boolean;
    nodeIsMissing: boolean;

    startPosition: Point;
    endPosition: Point;
    startIndex: number;
    endIndex: number;

    readonly currentNode: SyntaxNode;
    readonly currentFieldName: string;
    readonly currentDepth: number;
    readonly currentDescendantIndex: number;

    reset(node: SyntaxNode): void;
    resetTo(cursor: TreeCursor): void;
    gotoParent(): boolean;
    gotoFirstChild(): boolean;
    gotoLastChild(): boolean;
    gotoFirstChildForIndex(goalIndex: number): boolean;
    gotoFirstChildForPosition(goalPosition: Point): boolean;
    gotoNextSibling(): boolean;
    gotoPreviousSibling(): boolean;
    gotoDescendant(goalDescendantIndex: number): void;
}

export interface Tree {
    readonly rootNode: SyntaxNode;
    walk(): TreeCursor;
}
