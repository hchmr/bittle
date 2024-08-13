import { stream } from '../utils/stream';
import { StructSym, SymKind } from './sym';
import { Type, TypeKind } from './type';

export type TypeLayout = {
    size: number;
    align: number;
};

export type TypeLayoutContext = {
    getStruct(name: string): StructSym | undefined;
};

export function typeLayout(type: Type, ctx: TypeLayoutContext): TypeLayout | undefined {
    switch (type.kind) {
        case TypeKind.Void: {
            return undefined;
        }
        case TypeKind.Bool: {
            return { size: 1, align: 1 };
        }
        case TypeKind.Int: {
            const byteCount = type.size! / 8;
            return { size: byteCount, align: byteCount };
        }
        case TypeKind.Ptr: {
            return { size: 8, align: 8 };
        }
        case TypeKind.Arr: {
            const elemLayout = typeLayout(type.elemType, ctx);
            return elemLayout && { size: elemLayout.size * type.size!, align: elemLayout.align };
        }
        case TypeKind.Struct: {
            const sym = ctx.getStruct(type.sym.qualifiedName);
            if (sym?.kind !== SymKind.Struct) {
                return undefined;
            }
            if (!sym.fields || sym.fields.length === 0) {
                return undefined;
            }
            return stream(sym.fields)
                .map(field => typeLayout(field.type, ctx))
                .reduce<TypeLayout | undefined>(
                    (a, b) => a && b && ({
                        size: alignUp(a.size, b.align) + b.size,
                        align: Math.max(a.align, b.align),
                    }),
                    { size: 0, align: 0 },
                );
        }
        case TypeKind.Never:
        case TypeKind.Err: {
            return undefined;
        }
        default: {
            const unreachable: never = type;
            throw new Error(`Unexpected type: ${unreachable}`);
        }
    }

    function alignUp(size: number, align: number) {
        return Math.ceil(size / align) * align;
    }
}
