import path from 'path';
import { SyntaxNode } from '../syntax';
import { parseString } from '../utils/literalParsing';
import { VirtualFileSystem } from './vfs';

export class PathResolver {
    constructor(private vfs: VirtualFileSystem) { }

    resolveInclude(filePath: string, arg: string | SyntaxNode): string | undefined {
        const string = this.getString(arg);
        if (!string)
            return undefined;

        const fullPath = path.resolve(path.dirname(filePath), string);
        if (!this.vfs.exists(fullPath))
            return undefined;
        return fullPath;
    }

    resolveImport(filePath: string, arg: string | SyntaxNode): string | undefined {
        const string = this.getString(arg);
        if (!string)
            return undefined;

        let fullPath = path.resolve(path.dirname(filePath), string);
        if (!this.vfs.exists(fullPath) && !fullPath.endsWith('.btl')) {
            fullPath = fullPath + '.btl';
        }
        if (!this.vfs.exists(fullPath)) {
            return undefined;
        }
        return fullPath;
    }

    private getString(arg: string | SyntaxNode): string | undefined {
        return typeof arg === 'string' ? arg : parseString(arg.text);
    }
}
