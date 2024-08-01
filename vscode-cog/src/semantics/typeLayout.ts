import { stream } from "../utils/stream";
import { StructSym, SymKind } from "./sym";
import { Type } from "./type";

export type TypeLayout = {
    size: number;
    align: number;
}

export type TypeLayoutContext = {
    getStruct(name: string): StructSym | undefined;
}

export function typeLayout(type: Type, ctx: TypeLayoutContext): TypeLayout {
    switch (type.kind) {
        case "void":
            return { size: 0, align: 1 }
        case "bool":
            return { size: 1, align: 1 }
        case "int":
            const size = type.size! / 8
            return { size: size, align: size }
        case "pointer":
            return { size: 8, align: 8 }
        case "array":
            const elemLayout = typeLayout(type.elementType, ctx)
            return { size: elemLayout.size * type.size!, align: elemLayout.align }
        case "struct": {
            const sym = ctx.getStruct(type.qualifiedName);
            if (sym?.kind !== SymKind.Struct)
                return { size: 0, align: 1 }
            return stream(sym.fields ?? [])
                .map(field => typeLayout(field.type, ctx))
                .reduce(
                    (a, b) => ({
                        size: alignUp(a.size, b.align) + b.size,
                        align: Math.max(a.align, b.align),
                    }),
                    { size: 0, align: 1 }
                )
        }
        case "error":
            return { size: 0, align: 1 }
        default:
            const unreachable: never = type;
            throw new Error(`Unexpected type: ${unreachable}`);
    }

    function alignUp(size: number, align: number) {
        return Math.ceil(size / align) * align
    }
}
