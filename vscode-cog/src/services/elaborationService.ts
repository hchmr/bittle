import { SyntaxNode } from '../syntax';
import { ElaborationError, Elaborator, ElaboratorResult, SymReference } from "../semantics/elaborator";
import { StructFieldSym, Sym, SymKind } from "../semantics/sym";
import { Type } from "../semantics/type";
import { typeLayout, TypeLayout } from "../semantics/typeLayout";
import { Stream, stream } from "../utils/stream";
import { IncludeResolver } from "./IncludeResolver";
import { ParsingService } from './parsingService';
import { ReactiveCache } from "../utils/reactiveCache";

export class ElaborationService {
    constructor(
        private parsingService: ParsingService,
        private includeResolver: IncludeResolver,
        private cache: ReactiveCache,
    ) { }

    getErrors(path: string): ElaborationError[] {
        return this.elaborateFile(path).errors;
    }

    getSymbolsAtNode(path: string, node: SyntaxNode): Stream<Sym> {
        const module = this.elaborateFile(path);
        const innerScope = module.scope.findScopeForPosition(path, node.startPosition);
        if (!innerScope) {
            return stream([]);
        }
        return stream(function* go(scope): Iterable<Sym> {
            if (!scope) {
                return;
            }
            yield* stream(scope.symbols.values()).map(qname => module.symbols.get(qname)!);
            yield* go(scope.parent!);
        }(innerScope))
    }

    resolveSymbol(path: string, nameNode: SyntaxNode): Sym | undefined {
        if (isFieldName(nameNode)) {
            return this.resolveFieldName(path, nameNode);
        } else if (isTypeName(nameNode)) {
            return this.resolveTypeName(path, nameNode);
        } else if (isValueName(nameNode)) {
            return this.resolveValueName(path, nameNode);
        } else {
            return;
        }
    }

    private resolveTypeName(path: string, nameNode: SyntaxNode): Sym | undefined {
        return this.resolveName(path, nameNode);
    }

    private resolveValueName(path: string, nameNode: SyntaxNode): Sym | undefined {
        return this.resolveName(path, nameNode);
    }

    private resolveFieldName(path: string, nameNode: SyntaxNode): StructFieldSym | undefined {
        const module = this.elaborateFile(path);
        const qname = module.nodeSymMap.get(nameNode);
        if (!qname) {
            return;
        }
        const sym = module.symbols.get(qname)!;
        if (sym.kind !== SymKind.StructField) {
            return;
        }
        return sym;
    }

    public resolveName(path: string, nameNode: SyntaxNode): Sym | undefined {
        const module = this.elaborateFile(path);
        const qname = module.nodeSymMap.get(nameNode);
        if (!qname) {
            return;
        }
        return module.symbols.get(qname)!;
    }

    public getSymbol(path: string, qualifiedName: string): Sym | undefined {
        const module = this.elaborateFile(path);
        return module.symbols.get(qualifiedName);
    }

    inferType(path: string, exprNode: SyntaxNode): Type {
        const module = this.elaborateFile(path);
        return module.nodeTypeMap.get(exprNode) ?? { kind: "error" };
    }

    evalType(path: string, node: SyntaxNode): Type {
        const module = this.elaborateFile(path);
        return module.nodeTypeMap.get(node) ?? { kind: "error" };
    }

    getLayout(path: string, type: Type): TypeLayout {
        const module = this.elaborateFile(path);
        return typeLayout(type, {
            getStruct: name => {
                const sym = module.symbols.get(name);
                if (!sym || sym.kind !== SymKind.Struct)
                    return;
                return sym;
            }
        });
    }

    public references(path: string, qname: string): SymReference[] {
        const module = this.elaborateFile(path);
        return module.references.get(qname) ?? [];
    }

    private elaborateFile(path: string): ElaboratorResult {
        return this.cache.compute('elaborationService:elaborateFile:' + path, () =>
            new Elaborator(this.parsingService, this.includeResolver, path).run()
        );
    }
}

//================================================================================
//= Helpers

function isFieldName(nameNode: SyntaxNode): boolean {
    return nameNode.parent!.type === "field_expr"
}

function isTypeName(nameNode: SyntaxNode): boolean {
    return nameNode.parent!.type === "name_type" || nameNode.parent!.type === "struct_decl";
}

function isValueName(nameNode: SyntaxNode): boolean {
    return [
        "enum_member",
        "struct_decl",
        "struct_member",
        "func_decl",
        "param_decl",
        "global_decl",
        "const_decl",
        "local_decl",
        "name_expr",
    ].includes(nameNode.parent!.type);
}
