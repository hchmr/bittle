import { Tree } from '../syntax';
import { DeclNodeTypes } from '../syntax/generated';
import { NodeTypes, TopLevelNodeTypes } from '../syntax/nodeTypes';
import { ParsingService } from './parsingService';
import { PathResolver } from './pathResolver';
import { VirtualFileSystem } from './vfs';

type FileGraph = {
    incoming: Map<string, Set<string>>;
    outgoing: Map<string, Set<string>>;
};

export class FileGraphService {
    constructor(
        private parsingService: ParsingService,
        private vfs: VirtualFileSystem,
        private pathResolver: PathResolver,
    ) { }

    getFinalIncludingFiles(filePath: string): string[] {
        const includeGraph = this.getFileGraph(path => {
            const tree = this.parsingService.parse(path);
            return this.getReferencesForFile(path, tree, NodeTypes.IncludeDecl);
        });
        return transitiveReferences(filePath, includeGraph)
            .filter(path => includeGraph.incoming.get(path)!.size === 0);
    }

    getImportingFiles(filePath: string): string[] {
        const importGraph = this.getFileGraph(path => {
            const tree = this.parsingService.parse(path);
            return this.getReferencesForFile(path, tree, NodeTypes.ImportDecl);
        });
        return Array.from(importGraph.incoming.get(filePath) ?? []);
    }

    private getFileGraph(getOutgoing: (path: string) => Set<string>): FileGraph {
        const filePaths = this.vfs.listFiles();

        const outgoing = new Map<string, Set<string>>();
        const incoming = new Map<string, Set<string>>();

        for (const filePath of filePaths) {
            outgoing.set(filePath, new Set());
            incoming.set(filePath, new Set());
        }

        for (const filePath of filePaths) {
            outgoing.set(filePath, getOutgoing(filePath));
        }

        for (const [filePath, includes] of outgoing) {
            for (const include of includes) {
                incoming.get(include)!.add(filePath);
            }
        }

        return { incoming, outgoing };
    }

    private getReferencesForFile(path: string, tree: Tree, type: string): Set<string> {
        const references = new Set<string>();

        for (const node of tree.rootNode.children) {
            if (type) {
                const pathNode = node.childForFieldName('path');
                if (pathNode) {
                    const includePath = node.type == DeclNodeTypes.IncludeDecl
                        ? this.pathResolver.resolveInclude(path, pathNode)
                        : this.pathResolver.resolveImport(path, pathNode);
                    if (includePath) {
                        references.add(includePath);
                    }
                }
            }
        }

        return references;
    }
}

// Gets all files that transitively includes the given file
function transitiveReferences(initialNode: string, graph: FileGraph): string[] {
    const visited = new Set<string>();

    const visit = (path: string) => {
        if (visited.has(path)) {
            return;
        }

        visited.add(path);

        for (const incoming of graph.incoming.get(path)!) {
            visit(incoming);
        }
    };

    visit(initialNode);

    visited.delete(initialNode);

    return Array.from(visited);
}
