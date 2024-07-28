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
    readonly type: string;
    readonly isNamed: boolean;

    readonly isMissing: boolean;
    readonly isExtra: boolean;
    readonly hasError: boolean;
    readonly isError: boolean;

    readonly text: string;

    readonly startPosition: Point;
    readonly endPosition: Point;
    readonly startIndex: number;
    readonly endIndex: number;

    readonly tree: Tree;
    readonly parent: SyntaxNode | null;
    readonly children: Array<SyntaxNode>;
    readonly namedChildren: Array<SyntaxNode>;
    readonly childCount: number;
    readonly namedChildCount: number;
    readonly firstChild: SyntaxNode | null;
    readonly firstNamedChild: SyntaxNode | null;
    readonly lastChild: SyntaxNode | null;
    readonly lastNamedChild: SyntaxNode | null;
    readonly nextSibling: SyntaxNode | null;
    readonly nextNamedSibling: SyntaxNode | null;
    readonly previousSibling: SyntaxNode | null;
    readonly previousNamedSibling: SyntaxNode | null;
    // readonly descendantCount: number;

    toString(): string;
    pretty(): string;
    child(index: number): SyntaxNode | null;
    namedChild(index: number): SyntaxNode | null;
    childForFieldName(fieldName: string): SyntaxNode | null;
    fieldNameForChild(childIndex: number): string | null;
    childrenForFieldName(fieldName: string): Array<SyntaxNode>;
    firstChildForIndex(index: number): SyntaxNode | null;
    firstNamedChildForIndex(index: number): SyntaxNode | null;

    // descendantForIndex(index: number): SyntaxNode;
    // descendantForIndex(startIndex: number, endIndex: number): SyntaxNode;
    // namedDescendantForIndex(index: number): SyntaxNode;
    // namedDescendantForIndex(startIndex: number, endIndex: number): SyntaxNode;
    descendantForPosition(position: Point): SyntaxNode;
    descendantForPosition(startPosition: Point, endPosition: Point): SyntaxNode;
    namedDescendantForPosition(position: Point): SyntaxNode;
    namedDescendantForPosition(startPosition: Point, endPosition: Point): SyntaxNode;
    // descendantsOfType(types: string | Array<string>, startPosition?: Point, endPosition?: Point): Array<SyntaxNode>;

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
    // readonly currentDescendantIndex: number;

    reset(node: SyntaxNode): void;
    resetTo(cursor: TreeCursor): void;
    gotoParent(): boolean;
    gotoFirstChild(): boolean;
    gotoLastChild(): boolean;
    gotoFirstChildForIndex(goalIndex: number): boolean;
    gotoFirstChildForPosition(goalPosition: Point): boolean;
    gotoNextSibling(): boolean;
    gotoPreviousSibling(): boolean;
    // gotoDescendant(goalDescendantIndex: number): void;
}

export interface Tree {
    readonly text: string;
    readonly rootNode: SyntaxNode;
    walk(): TreeCursor;
}
