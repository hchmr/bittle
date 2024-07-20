import * as fs from 'fs';
import * as vscode from 'vscode';
import { ReactiveCache } from './reactiveCache';

/** A virtual file system that keeps files in with changes in memory. */
export interface VirtualFileSystem {
    /** Get the content of a cog file */
    readFile(path: string): string | undefined;
}

export function createVirtualFileSystem(cache: ReactiveCache): VirtualFileSystem & vscode.Disposable {
    const disposables: vscode.Disposable[] = [];

    vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.languageId !== 'cog' || event.contentChanges.length === 0)
            return;

        const path = event.document.uri.fsPath;
        cache.delete(`vfs:${path}`);
    }, disposables)

    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{cog,cogs}');
    watcher.onDidChange((uri) => {
        if (vscode.workspace.textDocuments.some(doc => doc.uri.fsPath === uri.fsPath)) {
            return; // Already handled by onDidChangeTextDocument
        }

        const path = uri.fsPath;
        cache.delete(`vfs:${path}`);
    });
    watcher.onDidDelete((uri) => {
        const path = uri.fsPath;
        cache.delete(`vfs:${path}`);
    });
    watcher.onDidCreate((uri) => {
        const path = uri.fsPath;
        cache.delete(`vfs:${path}`);
    });

    return {
        readFile(path: string): string | undefined {
            return cache.compute(`vfs:${path}`, () =>
                getFromWorkspace() ?? getFromFileSystem()
            );

            function getFromWorkspace() {
                return vscode.workspace.textDocuments
                    .find(doc => doc.uri.fsPath === path)
                    ?.getText();
            }

            function getFromFileSystem() {
                try {
                    return fs.readFileSync(path, 'utf8');
                } catch (err) {
                    return undefined;
                }
            }
        },
        dispose() {
            disposables.forEach(d => d.dispose());
            watcher.dispose();
        }
    };
}


