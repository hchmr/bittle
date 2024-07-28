import { Point } from "cog-parser";
import { PointRange, rangeContainsPoint } from "../utils";
import { Sym } from "./sym";


export class Scope {
    symbols: Map<string, Sym> = new Map();
    children: Scope[] = [];

    constructor(public file: string, public range: PointRange, public parent?: Scope) {
        parent?.children.push(this);
    }

    add(sym: Sym) {
        this.symbols.set(sym.name, sym);
    }

    lookup(name: string): Sym | undefined {
        return this.symbols.get(name) ?? this.parent?.lookup(name);
    }

    get(name: string): Sym | undefined {
        return this.symbols.get(name);
    }

    findScopeForPosition(file: string, position: Point): Scope | undefined {
        if (file !== this.file || !rangeContainsPoint(this.range, position))
            return;

        for (const child of this.children) {
            const scope = child.findScopeForPosition(file, position);
            if (scope) {
                return scope;
            }
        }

        return this;
    }
}
