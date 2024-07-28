import assert from 'assert';
import { Point } from './tree.js';

export class CharCursor {
    private _row: number = 0;
    private _col: number = 0;
    private _index: number = 0;

    constructor(private text: string) { }

    get cc() {
        assert(!this.isEof);
        return this.text[this._index];
    }

    get isEof(): boolean {
        return this._index >= this.text.length;
    }

    get pos(): Point {
        return { row: this._row, column: this._col, index: this._index };
    }

    isAt(test: string | RegExp) {
        if (typeof test === 'string') {
            const str: string = test;
            return this.text.startsWith(str, this._index);
        } else {
            const regex: RegExp = test;
            assert(regex.flags.includes('y'));
            regex.lastIndex = this._index;
            return regex.test(this.text);
        }
    }

    bump() {
        let pc = this.cc;
        this._index++;
        if (pc === '\r' && this.cc === '\n') {
            pc = this.cc;
            this._index++;
        }
        if (pc === '\n') {
            this._row++;
            this._col = 0;
        } else {
            this._col++;
        }
    }
}
