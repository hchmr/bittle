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
