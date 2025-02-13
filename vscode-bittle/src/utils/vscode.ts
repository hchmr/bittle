import * as vscode from 'vscode';
import { Point, PointRange } from '../syntax';

//=============================================================================
//== Position conversion

export function fromVscPosition(position: vscode.Position): Point {
    return { row: position.line, column: position.character };
}

export function toVscPosition(point: Point): vscode.Position {
    return new vscode.Position(point.row, point.column);
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
