import { Point } from './tree.js';

export type Error = {
    position: Point;
    message: string;
};

export interface ErrorSink {
    add(error: Error): void;
}
