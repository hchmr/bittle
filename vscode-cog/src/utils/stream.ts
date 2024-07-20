export interface Stream<T> extends Iterable<T> {
    concat<U>(other: Iterable<U>): Stream<T | U>;
    map<U>(f: (x: T) => U): Stream<U>;
    flatMap<U>(f: (x: T) => Iterable<U>): Stream<U>;
    filter(p: (x: T) => boolean): Stream<T>;
    groupBy<K>(f: (x: T) => K): Stream<[K, T[]]>;
    reduce<U>(f: (acc: U, x: T) => U, initial: U): U;
    some(p: (x: T) => boolean): boolean;
    every(p: (x: T) => boolean): boolean;
    toArray(): T[];
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
    map<U>(f: (x: T) => U): Stream<U> {
        return new StreamImpl((function* (source) {
            for (const x of source) {
                yield f(x);
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
    filter(p: (x: T) => boolean): Stream<T> {
        return new StreamImpl((function* (source) {
            for (const x of source) {
                if (p(x)) {
                    yield x;
                }
            }
        })(this.source));
    }
    groupBy<K>(f: (x: T) => K): Stream<[K, T[]]> {
        return new StreamImpl({
            [Symbol.iterator]: () => {
                const groups = new Map<K, T[]>();
                for (const x of this.source) {
                    const key = f(x);
                    if (!groups.has(key)) {
                        groups.set(key, []);
                    }
                    groups.get(key)!.push(x);
                }
                return groups.entries();
            }
        });
    }
    reduce<U>(f: (acc: U, x: T) => U, initial: U): U {
        let acc = initial;
        for (const x of this.source) {
            acc = f(acc, x);
        }
        return acc;
    }
    some(p: (x: T) => boolean): boolean {
        return this.reduce((acc, x) => acc || p(x), false);
    }
    every(p: (x: T) => boolean): boolean {
        return this.reduce((acc, x) => acc && p(x), true);
    }
    toArray(): T[] {
        return Array.from(this.source);
    }
    [Symbol.iterator](): Iterator<T> {
        return this.source[Symbol.iterator]();
    }
}
