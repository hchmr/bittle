import assert from 'assert';

export class CharCursor {
    private row: number = 0;
    private col: number = 0;
    private index: number = 0;
    constructor(private text: string) { }

    get cc() {
        assert(!this.isEof);
        return this.text[this.index];
    }

    bump() {
        let pc = this.cc;
        this.index++;
        if (pc === '\r' && this.cc === '\n') {
            pc = this.cc;
            this.index++;
        }
        if (pc === '\n') {
            this.row++;
            this.col = 0;
        } else {
            this.col++;
        }
    }

    get isEof() {
        return this.index >= this.text.length;
    }

    get pos() {
        return { row: this.row, col: this.col, index: this.index };
    }

    isAt(test: string | RegExp) {
        if (typeof test === 'string') {
            const str: string = test;
            return this.text.startsWith(str, this.index);
        } else {
            const regex: RegExp = test;
            assert(regex.flags.includes('y'));
            regex.lastIndex = this.index;
            return regex.test(this.text);
        }
    }
}
