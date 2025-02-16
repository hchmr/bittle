import { stream } from './stream';

export type Nullish = null | undefined;

export function identity<T>(value: T): T {
    return value;
}

export function isEnumValue<T extends Record<string, unknown>>(enumObj: T, value: unknown): value is T[keyof T] {
    return Object.values(enumObj).includes(value);
}

export function unreachable(value: never): never {
    throw new Error(`Unreachable code reached: ${value}`);
}

export function isBittleFile(name: string) {
    return name.endsWith('.btl') || name.endsWith('.btls');
}

export function countLeadingSpaces(text: string): number {
    return text.match(/^ */)![0].length;
}

export function dedent(text: string): string {
    const lines = text.split('\n');
    const minIndent = stream(lines).map(countLeadingSpaces).reduce((a, b) => Math.min(a, b), Infinity);
    return lines.map(line => line.slice(minIndent)).join('\n');
}
