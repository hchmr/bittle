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
