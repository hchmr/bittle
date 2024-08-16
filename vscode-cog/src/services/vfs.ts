import * as fs from 'fs';
import { Minimatch } from 'minimatch';
import path from 'path';
import * as vscode from 'vscode';
import { isCogFile } from '../utils';
import { ReactiveCache } from '../utils/reactiveCache';

/** A virtual file system that keeps files in with changes in memory. */
export interface VirtualFileSystem {
    /** Get the content of a cog file */
    readFile(path: string): string;
    /** Checks if a file exists */
    exists(path: string): boolean;
    /** List all files in the virtual file system */
    listFiles(): Array<string>;
}

export class VirtualFileSystemImpl implements VirtualFileSystem, vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private cache: ReactiveCache;
    private excludes: Minimatch[] = [];

    constructor(cache: ReactiveCache) {
        this.cache = cache;
        this.excludes = getExcludes();

        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.languageId !== 'cog'
                || event.contentChanges.length === 0
                || this.isExcluded(event.document.uri.fsPath)
            )
                return;

            const path = event.document.uri.fsPath;
            this.invalidateContents(path);
        }, this.disposables);

        const watcher = vscode.workspace.createFileSystemWatcher('**/*.{cog,cogs}');
        watcher.onDidChange((uri) => {
            if (vscode.workspace.textDocuments.some(doc => doc.uri.fsPath === uri.fsPath)) {
                return; // Already handled by onDidChangeTextDocument
            }

            const path = uri.fsPath;
            this.invalidateContents(path);
        });
        watcher.onDidDelete((uri) => {
            const path = uri.fsPath;
            this.invalidateFile(path);
        });
        watcher.onDidCreate((uri) => {
            const path = uri.fsPath;
            this.invalidateFile(path);
        });

        this.disposables.push(watcher);
    }

    public dispose() {
        this.disposables.forEach(d => d.dispose());
    }

    private invalidateContents(path: string) {
        this.cache.delete(`vfs:read:${path}`);
    }

    private invalidateFile(path: string) {
        this.cache.delete(`vfs:list`);
        this.cache.delete(`vfs:read:${path}`);
        this.cache.delete(`vfs:exists:${path}`);
    }

    public readFile(path: string): string {
        return this.cache.compute(`vfs:read:${path}`, () => this.readFileUncached(path));
    }

    public exists(path: string): boolean {
        return this.cache.compute(`vfs:exists:${path}`, () => this.existsUncached(path));
    }

    public listFiles(): Array<string> {
        return this.cache.compute(`vfs:list`, () => Array.from(this.listFilesUncached()));
    }

    private readFileUncached(path: string): string {
        return getFromWorkspace() ?? getFromFileSystem() ?? '';

        function getFromWorkspace(): string | undefined {
            return vscode.workspace.textDocuments
                .find(doc => doc.uri.fsPath === path)
                ?.getText();
        }

        function getFromFileSystem(): string | undefined {
            try {
                return fs.readFileSync(path, 'utf8');
            } catch (err) {
                return undefined;
            }
        }
    }

    private existsUncached(path: string): boolean {
        return this.cache.compute(`vfs:exists:${path}`, () =>
            vscode.workspace.textDocuments.some(doc => doc.uri.fsPath === path)
            || fs.existsSync(path) && fs.statSync(path).isFile(),
        );
    };

    private listFilesUncached(): Array<string> {
        const files: Array<string> = [];

        files.push(
            ...vscode.workspace.textDocuments
                .map(doc => doc.uri.fsPath)
                .filter(filePath => isCogFile(filePath) && !this.isExcluded(filePath)),
        );

        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            files.push(...this.listFilesInWorkspaceFolder(folder.uri.fsPath));
        }

        console.log('listFilesUncached', files);
        return files;
    }

    private *listFilesInWorkspaceFolder(folder: string): Iterable<string> {
        for (const entry of fs.readdirSync(folder, { withFileTypes: true, recursive: true })) {
            if (entry.isFile() && isCogFile(entry.name)) {
                const filePath = path.join(entry.parentPath, entry.name);
                if (!this.isExcluded(filePath)) {
                    yield filePath;
                }
            }
        }
    }

    private isExcluded(path: string): boolean {
        return this.excludes.some(exclude => exclude.match(path));
    }
}

function getExcludes(): Minimatch[] {
    const excludes = vscode.workspace.getConfiguration('cog').get<string[]>('exclude', []);
    return excludes.map(pattern => new Minimatch(pattern, { dot: true, optimizationLevel: 2 }));
}
