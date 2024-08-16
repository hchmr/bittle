//=============================================================================
//== Point

export type Point = {
    row: number;
    column: number;
};

export function pointEq(x1: Point, x2: Point): boolean {
    return x1.row === x2.row && x1.column === x2.column;
}

export function pointLe(x1: Point, x2: Point): boolean {
    return x1.row < x2.row || (x1.row === x2.row && x1.column <= x2.column);
}

export function pointLt(x1: Point, x2: Point): boolean {
    return !pointLe(x2, x1);
}

export function pointGe(x1: Point, x2: Point): boolean {
    return pointLe(x2, x1);
}

export function pointGt(x1: Point, x2: Point): boolean {
    return pointLt(x2, x1);
}

//=============================================================================
//== Range

export interface PointRange {
    startPosition: Point;
    endPosition: Point;
}

export function rangeEq(x1: PointRange, x2: PointRange): boolean {
    return pointEq(x1.startPosition, x2.startPosition) && pointEq(x1.endPosition, x2.endPosition);
}

export function rangeContains(x1: PointRange, x2: PointRange): boolean {
    return pointLe(x1.startPosition, x2.startPosition)
        && pointLe(x2.endPosition, x1.endPosition);
}

export function rangeContainsPoint(range: PointRange, point: Point): boolean {
    return pointLe(range.startPosition, point)
        && pointLe(point, range.endPosition);
}

export function isRangeEmpty(range: PointRange): boolean {
    return pointEq(range.startPosition, range.endPosition);
}
