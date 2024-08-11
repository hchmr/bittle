import fuzzysort from 'fuzzysort';

export function fuzzySearch<T>(query: string, items: T[], { key }: { key: string }): T[] {
    const results = fuzzysort.go(query, items, {
        key,
        all: true,
    });
    return results.map((result) => result.obj);
}
