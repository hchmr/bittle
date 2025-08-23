export interface Stream<T> extends Iterable<T> {
    concat<U>(other: Iterable<U>): Stream<T | U>;
    map<U>(f: (x: T, i: number) => U): Stream<U>;
    flatMap<U>(f: (x: T) => Iterable<U>): Stream<U>;
    filter<S extends T>(p: (x: T, i: number) => x is S): Stream<S>;
    filter(p: (x: T, i: number) => unknown): Stream<T>;
    groupBy<K>(f: (x: T) => K): Stream<[K, T[]]>;
    groupBy<K, V>(f: (x: T) => K, g: (x: T) => V): Stream<[K, V[]]>;
    sort(compareFn?: (a: T, b: T) => number): Stream<T>;
    distinct(): Stream<T>;
    distinctBy(f: (x: T) => unknown): Stream<T>;
    filterMap<U>(f: (x: T) => U | undefined): Stream<U>;
    zip<U>(other: Iterable<U>): Stream<[T, U]>;
    zipLongest<U>(other: Iterable<U>): Stream<[T, U] | [undefined, U] | [T, undefined]>;
    defaultIfEmpty(defaultValue: T): Stream<T>;
    reduce<U>(f: (acc: U, x: T, i: number) => U, initial: U): U;
    reduce(f: (acc: T, x: T) => T): T;
    find(p: (x: T) => unknown): T | undefined;
    findLast(p: (x: T) => unknown): T | undefined;
    some(p: (x: T) => unknown): boolean;
    every(p: (x: T) => unknown): boolean;
    isEmpty(): boolean;
    first(): T | undefined;
    last(): T | undefined;
    toArray(): T[];
    toSet(): Set<T>;
    join(separator: string): string;
    forEach(f: (x: T) => void): void;
}

export function stream<T>(iterable: Iterable<T>): Stream<T> {
    return new StreamImpl(iterable);
}

class StreamImpl<T> implements Stream<T> {
    constructor(private source: Iterable<T>) { }
    concat<U>(other: Iterable<U>): Stream<T | U> {
        return new StreamImpl((function* (source1, source2) {
            yield* source1;
            yield* source2;
        })(this.source, other));
    }

    map<U>(f: (x: T, i: number) => U): Stream<U> {
        return new StreamImpl((function* (source) {
            let i = 0;
            for (const x of source) {
                yield f(x, i++);
            }
        })(this.source));
    }

    flatMap<U>(f: (x: T) => Iterable<U>): Stream<U> {
        return new StreamImpl((function* (source) {
            for (const x of source) {
                yield* f(x);
            }
        })(this.source));
    }

    filter<S extends T>(p: (x: T, i: number) => x is S): Stream<S>;
    filter(p: (x: T, i: number) => unknown): Stream<T> {
        return new StreamImpl((function* (source) {
            let i = 0;
            for (const x of source) {
                if (p(x, i)) {
                    yield x;
                }
                i++;
            }
        })(this.source));
    }

    groupBy<K>(f: (x: T) => K): Stream<[K, T[]]>;
    groupBy<K, V>(f: (x: T) => K, g: (x: T) => V): Stream<[K, V[]]>;
    groupBy<K, V>(f: (x: T) => K, g?: (x: T) => V): Stream<[K, V[]]> {
        g ??= x => x as unknown as V;
        return new StreamImpl({
            [Symbol.iterator]: () => {
                const groups = new Map<K, V[]>();
                for (const x of this.source) {
                    const key = f(x);
                    if (!groups.has(key)) {
                        groups.set(key, []);
                    }
                    groups.get(key)!.push(g(x));
                }
                return groups.entries();
            },
        });
    }

    sort(compareFn?: (a: T, b: T) => number): Stream<T> {
        return new StreamImpl(this.toArray().sort(compareFn));
    }

    distinct(): Stream<T> {
        return this.distinctBy(x => x);
    }

    distinctBy(f: (x: T) => unknown): Stream<T> {
        return new StreamImpl((function* (source) {
            const set = new Set<unknown>();
            for (const x of source) {
                const key = f(x);
                if (!set.has(key)) {
                    set.add(key);
                    yield x;
                }
            }
        })(this.source));
    }

    filterMap<U>(f: (x: T) => U | undefined): Stream<U> {
        return this.map(f).filter(x => x !== undefined);
    }

    zip<U>(other: Iterable<U>): Stream<[T, U]> {
        return new StreamImpl((function* (source1, source2) {
            const iterator1 = source1[Symbol.iterator]();
            const iterator2 = source2[Symbol.iterator]();
            while (true) {
                const { done: done1, value: value1 } = iterator1.next();
                const { done: done2, value: value2 } = iterator2.next();
                if (done1 || done2) {
                    break;
                }
                yield [value1, value2] as [T, U];
            }
        })(this.source, other));
    }

    zipLongest<U>(other: Iterable<U>): Stream<[T, U] | [undefined, U] | [T, undefined]> {
        return new StreamImpl((function* (source1, source2) {
            const iterator1 = source1[Symbol.iterator]();
            const iterator2 = source2[Symbol.iterator]();
            while (true) {
                const { done: done1, value: value1 } = iterator1.next();
                const { done: done2, value: value2 } = iterator2.next();
                if (done1 && done2) {
                    break;
                }
                yield [done1 ? undefined : value1, done2 ? undefined : value2] as
                    [T, U] | [undefined, U] | [T, undefined];
            }
        })(this.source, other));
    }

    defaultIfEmpty(defaultValue: T): Stream<T> {
        return new StreamImpl((function* (source) {
            let isEmpty = true;
            for (const x of source) {
                isEmpty = false;
                yield x;
            }
            if (isEmpty) {
                yield defaultValue;
            }
        })(this.source));
    }

    reduce(f: (acc: T, x: T) => T): T;
    reduce<U>(f: (acc: U, x: T, i: number) => U, initial: U): U;
    reduce<U>(f: (acc: U, x: T, i: number) => U, initial?: U): U {
        let source = this.source;
        if (arguments.length === 1) {
            [initial, source] = uncons(this.source) as unknown as [U, Iterable<T>];
        }

        let acc: U = initial!;
        let i = 0;
        for (const x of source) {
            acc = f(acc, x, i++);
        }
        return acc;
    }

    find(p: (x: T) => unknown): T | undefined {
        for (const x of this.source) {
            if (p(x)) {
                return x;
            }
        }
        return undefined;
    }

    findLast(p: (x: T) => unknown): T | undefined {
        let last: T | undefined;
        for (const x of this.source) {
            if (p(x)) {
                last = x;
            }
        }
        return last;
    }

    some(p: (x: T) => unknown): boolean {
        for (const x of this.source) {
            if (p(x)) {
                return true;
            }
        }
        return false;
    }

    every(p: (x: T) => unknown): boolean {
        return !this.some(x => !p(x));
    }

    isEmpty(): boolean {
        return !this.some(() => true);
    }

    first(): T | undefined {
        return this.find(() => true);
    }

    last(): T | undefined {
        return this.findLast(() => true);
    }

    toArray(): T[] {
        return Array.from(this.source);
    }

    toSet(): Set<T> {
        return new Set(this.source);
    }

    join(separator: string): string {
        return this.reduce((acc, x, i) => acc + (i !== 0 ? separator : '') + x, '');
    }

    forEach(f: (x: T) => void): void {
        for (const x of this.source) {
            f(x);
        }
    }

    [Symbol.iterator](): Iterator<T> {
        return this.source[Symbol.iterator]();
    }
}

function uncons<T>(source: Iterable<T>): [T, Iterable<T>] {
    const iterator = source[Symbol.iterator]();
    const { value } = iterator.next();
    return [
        value,
        { [Symbol.iterator]: () => iterator },
    ];
}
