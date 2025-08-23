import { NodeTypes } from '../syntax/nodeTypes';
import { ReactiveCache } from '../utils/reactiveCache';
import { ParsingService } from './parsingService';
import { VirtualFileSystem } from './vfs';

export class ModuleListService {
    constructor(
        private parsingService: ParsingService,
        private vfs: VirtualFileSystem,
        private cache: ReactiveCache,
    ) { }

    getModuleList(): string[] {
        return this.cache.compute(`moduleList`, () => {
            return Array.from(this.getModuleListUncached());
        });
    }

    private* getModuleListUncached(): Iterable<string> {
        for (const filePath of this.vfs.listFiles()) {
            const tree = this.parsingService.parse(filePath);
            for (const node of tree.rootNode.children) {
                if (node.type === NodeTypes.ModuleNameDecl) {
                    yield filePath;
                }
            }
        }
    }
}
