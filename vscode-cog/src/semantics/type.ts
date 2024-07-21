export type Type =
    | VoidType
    | BoolType
    | IntType
    | PointerType
    | ArrayType
    | StructType
    | ErrorType
    ;

export type VoidType = {
    kind: "void";
}

export type BoolType = {
    kind: "bool";
}

export type IntType = {
    kind: "int";
    size: number | undefined;
}

export type PointerType = {
    kind: "pointer";
    elementType: Type;
}

export type ArrayType = {
    kind: "array";
    elementType: Type;
    size: number | undefined;
}

export type StructType = {
    kind: "struct";
    name: string;
}

export type ErrorType = {
    kind: "error";
}

//= Type merging

export function unifyTypes(t1: Type, t2: Type): Type {
    if (t1.kind === "error") {
        return t2;
    }
    if (t2.kind === "error") {
        return t1;
    }

    if (t1.kind !== t2.kind) {
        return { kind: "error" };
    }

    if (t1.kind === "int") {
        t2 = t2 as IntType;
        return {
            kind: "int",
            size: unifySize(t1.size, t2.size),
        };
    } else if (t1.kind === "pointer") {
        t2 = t2 as PointerType;
        return {
            kind: "pointer",
            elementType: unifyTypes(t1.elementType, t2.elementType),
        };
    } else if (t1.kind === "array") {
        t2 = t2 as ArrayType;
        return {
            kind: "array",
            elementType: unifyTypes(t1.elementType, t2.elementType),
            size: unifySize(t1.size, t2.size),
        };
    } else if (t1.kind === "struct") {
        t2 = t2 as StructType;
        if (t1.name !== t2.name) {
            return { kind: "error" };
        }
        return t1;
    } else {
        return t1;
    }

    function unifySize(size1: number | undefined, size2: number | undefined) {
        size1 ??= size2;
        return size1 === size2 ? size1 : undefined;
    }
}

export function typeEquals(t1: Type, t2: Type): boolean {
    if (t1.kind === "error" || t2.kind === "error") {
        return true;
    }
    if (t1.kind !== t2.kind) {
        return false;
    }
    if (t1.kind === "int") {
        t2 = t2 as IntType;
        return sizeEquals(t1.size, t2.size);
    } else if (t1.kind === "pointer") {
        t2 = t2 as PointerType;
        return typeEquals(t1.elementType, t2.elementType);
    } else if (t1.kind === "array") {
        t2 = t2 as ArrayType;
        return typeEquals(t1.elementType, t2.elementType) && sizeEquals(t1.size, t2.size);
    } else if (t1.kind === "struct") {
        t2 = t2 as StructType;
        return t1.name === t2.name;
    } else {
        return true;
    }

    function sizeEquals(size1: number | undefined, size2: number | undefined) {
        return size1 === undefined || size2 === undefined || size1 === size2;
    }
}

export function prettyType(t: Type): string {
    switch (t.kind) {
        case "void": return "Void";
        case "bool": return "Bool";
        case "int": return `Int${t.size ?? ""}`;
        case "pointer": return '*' + prettyType(t.elementType);
        case "array": return `[${prettyType(t.elementType)}; ${t.size ?? "?"}]`;
        case "struct": return t.name;
        case "error": return "{unknown}";
    }
}
