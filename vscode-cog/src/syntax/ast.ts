import { PointRange } from '../utils';
import { stream } from '../utils/stream';
import { fromSyntaxNode } from './generated';
import { Token, TokenKind } from './token';
import { Point, SyntaxNode } from './tree';
import { TokenNodeImpl } from './treeImpl';

export abstract class AstNode implements PointRange {
    constructor(public readonly syntax: SyntaxNode) {}

    get startPosition(): Point {
        return this.syntax.startPosition;
    }

    get endPosition(): Point {
        return this.syntax.endPosition;
    }

    protected getTokensOfType<T extends TokenKind>(field: string | undefined, kinds: T[]): TokenNode<T>[] {
        const children = field
            ? this.syntax.childrenForFieldName(field)
            : this.syntax.children;
        return stream(children)
            .filter(child => child instanceof TokenNodeImpl)
            .filter(token => (kinds as string[]).includes(token.type))
            .map(token => (token as TokenNodeImpl<T>))
            .toArray();
    }

    protected getTokenOfType<T extends TokenKind>(field: string | undefined, kinds: T[]): TokenNode<T> {
        return this.getTokensOfType<T>(field, kinds)[0];
    }

    protected getAstNodesOfType<T extends AstNode>(field: string | undefined, kinds: string[]): T[] {
        const children = field
            ? this.syntax.childrenForFieldName(field)
            : this.syntax.children;
        return stream(children)
            .filter(child => kinds.includes(child.type))
            .map(child => fromSyntaxNode(child) as T)
            .toArray();
    }

    protected getAstNodeOfType<T extends AstNode>(field: string | undefined, kinds: string[]): T {
        return this.getAstNodesOfType<T>(field, kinds)[0];
    }
}

export interface TokenNode<Kind extends TokenKind = TokenKind> extends SyntaxNode {
    readonly type: Kind;
    readonly token: Token<Kind>;
}
