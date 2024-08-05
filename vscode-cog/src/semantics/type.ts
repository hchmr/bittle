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
    kind: 'void';
};

export type BoolType = {
    kind: 'bool';
};

export type IntType = {
    kind: 'int';
    size: number | undefined;
};

export type PointerType = {
    kind: 'pointer';
    elementType: Type;
};

export type ArrayType = {
    kind: 'array';
    elementType: Type;
    size: number | undefined;
};

export type StructType = {
    kind: 'struct';
    name: string;
    qualifiedName: string;
};

export type ErrorType = {
    kind: 'error';
};

//= Type merging

export function unifyTypes(t1: Type, t2: Type): Type {
    return tryUnifyTypes(t1, t2, () => { });
}

export function tryUnifyTypes(t1: Type, t2: Type, onError: () => void): Type {
    if (typeLe(t1, t2)) {
        return t2;
    } else if (typeLe(t2, t1)) {
        return t1;
    }

    if (t1.kind !== t2.kind) {
        onError();
        return { kind: 'error' };
    }

    if (t1.kind === 'int' && t2.kind == t1.kind) {
        const size = unifySize(t1.size, t2.size, onError);
        return { kind: 'int', size: size };
    } else if (t1.kind === 'pointer' && t2.kind == t1.kind) {
        const elementType = tryUnifyTypes(t1.elementType, t2.elementType, onError);
        return { kind: 'pointer', elementType: elementType };
    } else if (t1.kind === 'array' && t2.kind == t1.kind) {
        const elementType = tryUnifyTypes(t1.elementType, t2.elementType, onError);
        const size = unifySize(t1.size, t2.size, onError);
        return { kind: 'array', elementType: elementType, size: size };
    } else if (t1.kind === 'struct' && t2.kind == t1.kind) {
        if (t1.name !== t2.name) {
            onError();
            return { kind: 'error' };
        }
        return t1;
    } else {
        return t1;
    }

    function unifySize(size1: number | undefined, size2: number | undefined, onError: () => void): number | undefined {
        if (size1 !== undefined && size2 !== undefined && size1 !== size2) {
            onError();
            return undefined;
        }
        return size1 ?? size2;
    }
}

function typeEquals(t1: Type, t2: Type): boolean {
    if (t1 === t2) {
        return true;
    }
    if (t1.kind !== t2.kind) {
        return false;
    }
    if (t1.kind === 'int') {
        t2 = t2 as IntType;
        return t1.size === t2.size;
    } else if (t1.kind === 'pointer') {
        t2 = t2 as PointerType;
        return typeEquals(t1.elementType, t2.elementType);
    } else if (t1.kind === 'array') {
        t2 = t2 as ArrayType;
        return typeEquals(t1.elementType, t2.elementType) && t1.size === t2.size;
    } else if (t1.kind === 'struct') {
        t2 = t2 as StructType;
        return t1.name === t2.name;
    } else {
        return true;
    }
}

export function isScalarType(type: Type): boolean {
    return type.kind === 'bool'
        || type.kind === 'int'
        || type.kind === 'pointer';
}

export function isValidReturnType(type: Type): boolean {
    return type.kind === 'void'
        || isScalarType(type);
}

export function typeLe(t1: Type, t2: Type): boolean {
    return typeEquals(t1, t2)
        || (t1.kind === 'error')
        || (isScalarType(t1) && t2.kind === 'bool')
        || (t1.kind === 'int' && t2.kind === 'int' && t1.size! <= t2.size!)
        || (t1.kind === 'pointer' && t2.kind === 'pointer' && t1.elementType.kind === 'void');
}

export function prettyType(t: Type): string {
    switch (t.kind) {
        case 'void': return 'Void';
        case 'bool': return 'Bool';
        case 'int': return `Int${t.size ?? ''}`;
        case 'pointer': return '*' + prettyType(t.elementType);
        case 'array': return `[${prettyType(t.elementType)}; ${t.size ?? '?'}]`;
        case 'struct': return t.name;
        case 'error': return '{unknown}';
    }
}
