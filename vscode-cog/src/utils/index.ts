import * as vscode from 'vscode';
import { Point } from '../syntax';

//=============================================================================
//== Point utilities

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

export function fromVscPosition(position: vscode.Position): Point {
    return { row: position.line, column: position.character };
}

export function toVscPosition(point: Point): vscode.Position {
    return new vscode.Position(point.row, point.column);
}

//=============================================================================
//== Range utilities

export interface PointRange {
    startPosition: Point;
    endPosition: Point;
};

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

export function fromVscRange(range: vscode.Range): PointRange {
    return {
        startPosition: fromVscPosition(range.start),
        endPosition: fromVscPosition(range.end),
    };
}

export function toVscRange(start: Point, end: Point): vscode.Range;
export function toVscRange(range: PointRange): vscode.Range;
export function toVscRange(...args: [Point, Point] | [PointRange]): vscode.Range {
    const [start, end] = args.length === 1
        ? [args[0].startPosition, args[0].endPosition]
        : args;
    return new vscode.Range(toVscPosition(start), toVscPosition(end));
}

//=============================================================================
//== Other utilities

export type Nullish = null | undefined;

export function isCogFile(name: string) {
    return name.endsWith('.cog') || name.endsWith('.cogs');
}