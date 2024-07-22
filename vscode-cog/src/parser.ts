import Parser, { Tree } from 'tree-sitter';
import Cog from 'tree-sitter-cog';
import { ReactiveCache } from './utils/reactiveCache';
import { VirtualFileSystem } from './vfs';

export const parser = new Parser();
parser.setLanguage(Cog);

export interface ParsingService {
    parse(path: string): Tree;
}

export function createParsingService(cache: ReactiveCache, vfs: VirtualFileSystem): ParsingService {
    return {
        parse(path: string): Tree {
            return cache.compute(`parse:${path}`, () => {
                const content = vfs.readFile(path);
                if (!content) {
                    throw new Error(`File not found: ${path}`);
                }
                return parser.parse(content);
            });
        }
    };
}

export function isExprNode(node: any): boolean {
    return [
        "grouped_expr",
        "name_expr",
        "literal_expr",
        "sizeof_expr",
        "binary_expr",
        "ternary_expr",
        "unary_expr",
        "call_expr",
        "index_expr",
        "field_expr",
        "cast_expr",
    ].includes(node.type);
}

export function isTypeNode(node: any): boolean {
    return [
        "grouped_type",
        "name_type",
        "pointer_type",
        "array_type",
    ].includes(node.type);
}
