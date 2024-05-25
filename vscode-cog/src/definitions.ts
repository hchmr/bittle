import { SymbolKind, TextDocument } from "vscode";

export function findDefinitionsInSource(document: TextDocument) {
    const definitions = [];

    for (const match of document.getText().matchAll(/^(struct|func|var|const)\s*(\w+)/gm)) {
        definitions.push({
            index: match.index + match[0].length - match[2].length,
            name: match[2],
            kind: {
                'struct': SymbolKind.Struct,
                'func': SymbolKind.Function,
                'var': SymbolKind.Variable,
                'const': SymbolKind.Constant,
            }[match[1]]!,
        });
    }

    // enums
    for (const match of document.getText().matchAll(/^enum\s*\{([^}]*)\}/gm)) {
        for (const part of match[1].split(',')) {
            const name = part.trim();
            if (name) {
                definitions.push({
                    index: match.index + match[0].indexOf(name),
                    name: name,
                    kind: SymbolKind.EnumMember,
                });
            }
        }
    }

    return definitions;
}
