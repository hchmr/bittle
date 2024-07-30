import path from "path";
import { SyntaxNode } from "cog-parser";
import { VirtualFileSystem } from "../vfs";

// IncludeResolver

export class IncludeResolver {
    constructor(private vfs: VirtualFileSystem) { }

    resolveInclude(filePath: string, arg: string | SyntaxNode) {
        const pathValue =
            typeof arg === "string"
                ? arg
                : JSON.parse(arg.text);
        const includePath = path.resolve(path.dirname(filePath), pathValue);
        if (this.vfs.exists(includePath)) {
            return includePath;
        }
    }
}
