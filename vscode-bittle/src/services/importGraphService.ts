import { Tree } from '../syntax';
import { TopLevelNodeTypes } from '../syntax/nodeTypes';
import { ParsingService } from './parsingService';
import { PathResolver } from './pathResolver';
import { VirtualFileSystem } from './vfs';

type FileGraph = {
    incoming: Map<string, Set<string>>;
    outgoing: Map<string, Set<string>>;
};

export class ImportGraphService {
    constructor(
        private parsingService: ParsingService,
        private vfs: VirtualFileSystem,
        private pathResolver: PathResolver,
    ) { }

    getImportingFiles(filePath: string): string[] {
        const graph = this.getImportGraph();
        return Array.from(graph.incoming.get(filePath) ?? []);
    }

    private getImportGraph(): FileGraph {
        const filePaths = this.vfs.listFiles();

        const outgoing = new Map<string, Set<string>>();
        const incoming = new Map<string, Set<string>>();

        for (const filePath of filePaths) {
            outgoing.set(filePath, new Set());
            incoming.set(filePath, new Set());
        }

        for (const filePath of filePaths) {
            const tree = this.parsingService.parse(filePath);
            const imports = this.getImportsAndImportsForFile(filePath, tree);
            outgoing.set(filePath, imports);
        }

        for (const [filePath, imports] of outgoing) {
            for (const import_ of imports) {
                incoming.get(import_)?.add(filePath);
            }
        }

        return { incoming, outgoing };
    }

    private getImportsAndImportsForFile(path: string, tree: Tree): Set<string> {
        const importPaths = new Set<string>();

        for (const node of tree.rootNode.children) {
            if (node.type === TopLevelNodeTypes.Import) {
                const pathNode = node.childForFieldName('path');
                if (pathNode) {
                    const importPath = this.pathResolver.resolveImport(path, pathNode);
                    if (importPath) {
                        importPaths.add(importPath);
                    }
                }
            }
        }

        return importPaths;
    }
}
