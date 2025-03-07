import path from 'path';
import { SyntaxNode } from '../syntax';
import { parseString } from '../utils/literalParsing';
import { VirtualFileSystem } from './vfs';

export class IncludeResolver {
    constructor(private vfs: VirtualFileSystem) { }

    resolveInclude(filePath: string, arg: string | SyntaxNode): string | undefined {
        const pathValue =
            typeof arg === 'string'
                ? arg
                : parseString(arg.text);
        if (!pathValue) {
            return;
        }
        const includePath = path.resolve(path.dirname(filePath), pathValue);
        if (!this.vfs.exists(includePath)) {
            return;
        }
        return includePath;
    }
}
