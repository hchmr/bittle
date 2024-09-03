import { Tree } from '../syntax';
import { TopLevelNodeTypes } from '../syntax/nodeTypes';
import { IncludeResolver } from './IncludeResolver';
import { ParsingService } from './parsingService';
import { VirtualFileSystem } from './vfs';

type IncludeGraph = {
    incoming: Map<string, Set<string>>;
    outgoing: Map<string, Set<string>>;
};

export class IncludeGraphService {
    constructor(
        private parsingService: ParsingService,
        private vfs: VirtualFileSystem,
        private includeResolver: IncludeResolver,
    ) { }

    getFinalReferences(filePath: string): string[] {
        const graph = this.getIncludeGraph();
        return transitiveReferences(filePath, graph)
            .filter(path => graph.incoming.get(path)!.size === 0);
    }

    private getIncludeGraph(): IncludeGraph {
        const filePaths = this.vfs.listFiles();

        const outgoing = new Map<string, Set<string>>();
        const incoming = new Map<string, Set<string>>();

        for (const filePath of filePaths) {
            outgoing.set(filePath, new Set());
            incoming.set(filePath, new Set());
        }

        for (const filePath of filePaths) {
            const tree = this.parsingService.parse(filePath);
            const includes = this.getIncludesForFile(filePath, tree);
            outgoing.set(filePath, includes);
        }

        for (const [filePath, includes] of outgoing) {
            for (const include of includes) {
                incoming.get(include)!.add(filePath);
            }
        }

        return { incoming, outgoing };
    }

    private getIncludesForFile(path: string, tree: Tree): Set<string> {
        const includePaths = new Set<string>();

        for (const node of tree.rootNode.children) {
            if (node.type === TopLevelNodeTypes.Include) {
                const pathNode = node.childForFieldName('path');
                if (pathNode) {
                    const includePath = this.includeResolver.resolveInclude(path, pathNode);
                    if (includePath) {
                        includePaths.add(includePath);
                    }
                }
            }
        }

        return includePaths;
    }
}

// Gets all files that transitively includes the given file
function transitiveReferences(initialNode: string, graph: IncludeGraph): string[] {
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
