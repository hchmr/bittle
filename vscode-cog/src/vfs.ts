import * as vscode from 'vscode';
import * as fs from 'fs';

/** A virtual file system that keeps files in with changes in memory. */
export interface VirtualFileSystem {
    /** Get the content of a cog file */
    readFile(path: string): string | undefined;
}

export function createVirtualFileSystem(): VirtualFileSystem & vscode.Disposable {
    const disposables: vscode.Disposable[] = [];

    const fileCache = new Map<string, string>();

    vscode.workspace.onDidChangeTextDocument(({ document }) => {
        if (fileCache.has(document.uri.fsPath)) {
            fileCache.set(document.uri.fsPath, document.getText());
        }
    }, disposables)

    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{cog,cogs}');
    watcher.onDidChange((uri) => {
        const path = uri.fsPath;
        fileCache.delete(path);
    });
    watcher.onDidDelete((uri) => {
        const path = uri.fsPath;
        fileCache.delete(path);
    });

    return {
        readFile(path: string): string | undefined {
            if (!fileCache.has(path)) {
                const fileContent = getFromWorkspace() || getFromFileSystem();
                if (fileContent) {
                    fileCache.set(path, fileContent);
                }
            }
            return fileCache.get(path);

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


