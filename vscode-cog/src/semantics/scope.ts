import { Point, PointRange, rangeContainsPoint } from '../syntax';

export class Scope {
    symbols: Map<string, string> = new Map();
    children: Scope[] = [];

    constructor(public file: string, public range: PointRange, public parent?: Scope) {
        parent?.children.push(this);
    }

    add(name: string, qname: string) {
        this.symbols.set(name, qname);
    }

    lookup(name: string): string | undefined {
        return this.symbols.get(name) ?? this.parent?.lookup(name);
    }

    get(name: string): string | undefined {
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
