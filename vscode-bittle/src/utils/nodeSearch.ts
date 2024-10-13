import { Point, pointEq, pointLe, rangeContains, SyntaxNode, Tree } from '../syntax';
import { NodeTypes } from '../syntax/nodeTypes';

export function getIdentifierAtPosition(tree: Tree, point: Point): SyntaxNode | null {
    return tree.rootNode.descendantsForPosition(point)
        .find(node => node.type === NodeTypes.identifier) ?? null;
}

export function nodeStartsAt(position: Point, node: SyntaxNode): boolean {
    return pointEq(node.startPosition, position);
}

export function nodeEndsAt(position: Point, node: SyntaxNode): boolean {
    return pointEq(node.endPosition, position);
}

export function countPrecedingCommas(argsNodes: SyntaxNode[], treePosition: Point) {
    return argsNodes
        .filter((argNode) =>
            argNode.type == ',' && pointLe(argNode.endPosition, treePosition),
        )
        .length;
}
