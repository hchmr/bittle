import { Error, Parser, tokenize, Tree } from '../syntax';
import { RootNode } from '../syntax/generated';
import { ReactiveCache } from '../utils/reactiveCache';
import { VirtualFileSystem } from '../vfs';

interface ParseResult {
    tree: Tree;
    errors: Error[];
}

export interface ParsingService {
    parse(path: string): Tree;
    parseAsAst(path: string): RootNode;
    parseErrors(path: string): Error[];
}

export class ParsingServiceImpl implements ParsingService {
    constructor(
        private cache: ReactiveCache,
        private vfs: VirtualFileSystem,
    ) {}

    parse(path: string): Tree {
        return this.runParser(path).tree;
    }

    parseAsAst(path: string): RootNode {
        return new RootNode(this.parse(path).rootNode);
    }

    parseErrors(path: string): Error[] {
        return this.runParser(path).errors;
    }

    private runParser(path: string): ParseResult {
        return this.cache.compute(`parse:${path}`, () =>
            this.runParserUncached(path),
        );
    }

    private runParserUncached(path: string): ParseResult {
        const text = this.vfs.readFile(path);

        const errors: Array<Error> = [];
        const errorSink = {
            add: (error: Error) => errors.push(error),
        };

        const tree = new Parser(text, tokenize(text, errorSink), errorSink).top();

        return { tree, errors };
    }
}
