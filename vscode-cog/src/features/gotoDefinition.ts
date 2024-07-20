import path from "path";
import * as vscode from "vscode";
import { ParsingService } from "../parser";
import { fromVscPosition, toVscRange } from "../utils";
import { getNodesAtPosition } from "../utils/nodeSearch";
import { VirtualFileSystem } from "../vfs";

export class IncludeDefinitionProvider implements vscode.DefinitionProvider {
    constructor(private vfs: VirtualFileSystem, private parsingService: ParsingService) { }

    provideDefinition(
        document: vscode.TextDocument,
        vscPosition: vscode.Position,
        token: vscode.CancellationToken
    ) {
        const tree = this.parsingService.parse(document.fileName);
        const position = fromVscPosition(vscPosition);
        return getNodesAtPosition(tree, position)
            .filter(node => node.type === "string_literal"
                && node.parent?.type === "include_decl")
            .flatMap(node => {
                const stringValue = JSON.parse(node.text);
                const includePath = this.resolveInclude(document.uri.fsPath, stringValue);
                if (!includePath) {
                    return [];
                }
                return [{
                    originSelectionRange: toVscRange(node),
                    targetUri: vscode.Uri.file(includePath),
                    targetRange: new vscode.Range(0, 0, 0, 0),
                }];
            })
    }

    resolveInclude(filePath: string, stringValue: string) {
        const includePath = path.resolve(path.dirname(filePath), stringValue);
        if (this.vfs.readFile(includePath)) {
            return includePath;
        }
    }
}
