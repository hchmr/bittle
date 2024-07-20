import { Point, SyntaxNode, Tree } from "tree-sitter";
import { nodeContains, PointRange, rangeContains } from ".";

/**
 * If between two nodes, return the left and right nodes; otherwise, return the containing node.
 */
export function getNodesAtPosition(tree: Tree, rightPoint: Point): SyntaxNode[] {
    let points = [rightPoint];
    if (rightPoint.column > 0) {
        const leftPoint = { ...rightPoint, column: rightPoint.column - 1 };
        points.unshift(leftPoint);
    }

    let matchingNodes = points
        .map(point => tree.rootNode.descendantForPosition(point));

    if (matchingNodes.length < 2) {
        return matchingNodes;
    }

    const [leftNode, rightNode] = matchingNodes;
    if (nodeContains(leftNode, rightNode)) {
        return [rightNode];
    } else if (nodeContains(rightNode, leftNode)) {
        return [leftNode];
    } else {
        return [leftNode, rightNode];
    }
}

/**
 * Returns the node that contains the range, and optionally the node that exactly matches the range.
 */
export function getNodeAtRange(tree: Tree, range: PointRange) {
    const node = tree.rootNode.descendantForPosition(range.startPosition, range.endPosition);

    return {
        approximateMatch: node,
        exactMatch: rangeContains(range, node) ? node : null,
    };
}
