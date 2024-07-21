export interface Stream<T> extends Iterable<T> {
    concat<U>(other: Iterable<U>): Stream<T | U>;
    map<U>(f: (x: T) => U): Stream<U>;
    flatMap<U>(f: (x: T) => Iterable<U>): Stream<U>;
    filter<S extends T>(p: (x: T) => x is S): Stream<S>;
    filter(p: (x: T) => unknown): Stream<T>;
    groupBy<K>(f: (x: T) => K): Stream<[K, T[]]>;
    reduce<U>(f: (acc: U, x: T) => U, initial: U): U;
    reduce(f: (acc: T, x: T) => T): T;
    find(p: (x: T) => unknown): T | undefined;
    some(p: (x: T) => unknown): boolean;
    every(p: (x: T) => unknown): boolean;
    filterMap<U>(f: (x: T) => U | undefined): Stream<U>;
    zip<U>(other: Iterable<U>): Stream<[T, U]>;
    zipLongest<U>(other: Iterable<U>): Stream<[T, U] | [undefined, U] | [T, undefined]>;
    isEmpty(): boolean;
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
    filter<S extends T>(p: (x: T) => x is S): Stream<S>;
    filter(p: (x: T) => unknown): Stream<T> {
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
    reduce(f: (acc: T, x: T) => T): T;
    reduce<U>(f: (acc: U, x: T) => U, initial: U): U;
    reduce<U>(f: (acc: U, x: T) => U, initial?: U): U {
        let source = this.source;
        if (arguments.length === 1) {
            [initial, source] = uncons(this.source) as unknown as [U, Iterable<T>];
        }

        let acc: U = initial!;
        for (const x of source) {
            acc = f(acc, x);
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
    isEmpty(): boolean {
        return !this.some(() => true);
    }
    toArray(): T[] {
        return Array.from(this.source);
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
        { [Symbol.iterator]: () => iterator }
    ];
}
