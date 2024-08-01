import { nodeContains, PointRange, rangeContains, rangeContainsPoint } from '.';
import { Point, SyntaxNode, Tree } from '../syntax';

export function getIdentifierAtPosition(tree: Tree, point: Point): SyntaxNode | null {
    return getNodesAtPosition(tree, point)
        .filter(node => node.type === 'identifier')[0];
}

/**
 * If between two adjacent nodes, return the left and right nodes; otherwise, return the containing node.
 */
export function getNodesAtPosition(tree: Tree, point: Point): SyntaxNode[] {
    const matchingNode = tree.rootNode.descendantForPosition(point);

    const matchingNodes = [matchingNode];
    const adjacentNode = getAdjacentNode(matchingNode, point);
    if (adjacentNode && rangeContainsPoint(adjacentNode, point)) {
        matchingNodes.push(adjacentNode);
    }

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

// try sibling
// then try parent's sibling
// then try parent's parent's sibling
// and so on
// TODO: replace with tree API that returns the nodes adjacent to a point
function getAdjacentNode(node: SyntaxNode, point: Point): SyntaxNode | null {
    while (true) {
        if (node.nextSibling) {
            break;
        }
        if (!node.parent) {
            return null;
        }
        node = node.parent;
    }

    if (!rangeContainsPoint(node.nextSibling, point)) {
        return null;
    }
    return node.nextSibling;
}
