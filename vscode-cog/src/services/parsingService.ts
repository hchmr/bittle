import { Error, Tree } from "cog-parser";
import { parser } from "../parser";
import { ReactiveCache } from "../utils/reactiveCache";
import { VirtualFileSystem } from "../vfs";


export interface ParsingService {
    parse(path: string): Tree;
    parseErrors(path: string): Error[];
}

export class ParsingService implements ParsingService {
    constructor(private cache: ReactiveCache, private vfs: VirtualFileSystem) {}

    parse(path: string): Tree {
        return this.parseInternal(path)[0];
    }

    parseErrors(path: string): Error[] {
        return this.parseInternal(path)[1];
    }

    private parseInternal(path: string): [Tree, Error[]] {
        return this.cache.compute(`parse:${path}`, () => {
            const errors: Array<Error> = [];
            const errorSink = {
                add: (error: Error) => errors.push(error)
            };

            const content = this.vfs.readFile(path);
            if (!content) {
                throw new Error(`File not found: ${path}`);
            }

            return [parser.parse(content, errorSink), errors];
        });
    }
}
