import path from 'path';
import { SyntaxNode } from '../syntax';
import { VirtualFileSystem } from '../vfs';

export class IncludeResolver {
    constructor(private vfs: VirtualFileSystem) { }

    resolveInclude(filePath: string, arg: string | SyntaxNode): string | undefined {
        const pathValue
            = typeof arg === 'string'
                ? arg
                : tryParseString(arg.text);
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

function tryParseString(text: string): string | undefined {
    if (!text.startsWith('"')) {
        return;
    }
    try {
        return JSON.parse(text);
    } catch {
        return;
    }
}