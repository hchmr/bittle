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

        for (const [filePath, references] of outgoing) {
            for (const reference of references) {
                incoming.get(reference)!.add(filePath);
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
                    const reference = this.pathResolver.resolveImport(path, pathNode);
                    if (reference) {
                        references.add(reference);
                    }
                }
            }
        }

        return references;
    }
}
