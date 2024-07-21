import { SyntaxNode } from "tree-sitter";
import { IncludeResolver } from "../IncludeResolver";
import { ParsingService } from "../parser";
import { ReactiveCache } from "../utils/reactiveCache";
import { Origin, SymbolType } from "./sym";

export type Index = {
    entries: IndexEntry[];
}

export type IndexEntry = {
    type: SymbolType;
    name: string,
    origin: Origin;
}

export class IndexingService {
    constructor(
        private cache: ReactiveCache,
        private includeResolver: IncludeResolver,
        private parsingService: ParsingService,
    ) { }

    index(path: string): Index {
        return this.cache.compute(`index:${path}`, () =>
            this.indexUncached(path)
        );
    }

    indexUncached(path: string): Index {
        const tree = this.parsingService.parse(path);
        const entries = tree.rootNode.children
            .flatMap((node: SyntaxNode) => {
                if (node.type === "include_decl") {
                    return this.visitIncludeDecl(path, node);
                } else if (node.type === "enum_decl") {
                    return this.visitEnumDecl(path, node);
                } else if (node.type === "struct_decl") {
                    return this.visitNamedDecl("struct", path, node);
                } else if (node.type === "func_decl") {
                    return this.visitNamedDecl("func", path, node);
                } else if (node.type === "global_decl") {
                    return this.visitNamedDecl("global", path, node);
                } else if (node.type === "const_decl") {
                    return this.visitNamedDecl("const", path, node);
                } else {
                    return [];
                }
            });
        return { entries };
    }

    private visitIncludeDecl(path: string, node: SyntaxNode): IndexEntry[] {
        const pathNode = node.childForFieldName("path");
        if (!pathNode) {
            return [];
        }
        const resolvedPath = this.includeResolver.resolveInclude(path, pathNode);
        if (!resolvedPath) {
            return [];
        }

        return this.index(resolvedPath).entries;
    }

    private visitEnumDecl(path: string, node: SyntaxNode): IndexEntry[] {
        return node.childrenForFieldName("body")
            ?.flatMap<IndexEntry>(memberNode => this.visitNamedDecl("const", path, memberNode))
            ?? [];
    }

    private visitNamedDecl(type: SymbolType, path: string, node: SyntaxNode): IndexEntry[] {
        const nameNode = node.childForFieldName("name");
        if (!nameNode?.text) {
            return [];
        }
        return [createIndexEntry(type, nameNode, path, node)];
    }
}

function createIndexEntry(type: SymbolType, nameNode: SyntaxNode, fileName: string, node: SyntaxNode): IndexEntry {
    return { type, name: nameNode.text, origin: { file: fileName, node, nameNode } };
}
