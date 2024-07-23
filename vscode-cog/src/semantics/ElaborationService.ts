import assert from "assert";
import { SyntaxNode } from "tree-sitter";
import { Nullish, rangeContains } from "../utils";
import { stream } from "../utils/stream";
import { IndexEntry, IndexingService } from "./IndexingService";
import { ConstSymbol, FuncParamSymbol, FuncSymbol, GlobalSymbol, StructFieldSymbol, StructSymbol, Symbol, SymbolType, valueSymbolType } from "./sym";
import { Type, unifyTypes } from "./type";

export class ElaborationService {
    constructor(
        private indexService: IndexingService,
    ) { }

    resolveSymbol(path: string, nameNode: SyntaxNode): Symbol | undefined {
        if (isFieldName(nameNode)) {
            return this.resolveFieldName(path, nameNode);
        } else if (isTypeName(nameNode)) {
            return this.resolveTypeName(path, nameNode);
        } else if (isValueName(nameNode)) {
            return this.resolveValueName(path, nameNode);
        } else {
            return;
        }
    }

    resolveTypeName(path: string, nameNode: SyntaxNode): Symbol | undefined {
        return this.lookupGlobalSymbol(path, nameNode.text, SymbolNamespace.Type);
    }

    resolveValueName(path: string, nameNode: SyntaxNode): Symbol | undefined {
        let node: SyntaxNode | undefined = nameNode.parent!;

        return this.lookupSymbolFromNode(path, node, nameNode, SymbolNamespace.Value);
    }

    resolveFieldName(path: string, nameNode: SyntaxNode): StructFieldSymbol | undefined {
        const left = nameNode.parent!.childForFieldName("left");
        if (!left) {
            return;
        }

        let leftType = this.inferType(path, left);
        if (leftType?.kind === "pointer") {
            leftType = leftType.elementType;
        }
        if (leftType?.kind !== "struct") {
            return;
        }

        const symbol = this.lookupGlobalSymbol(path, leftType.name, SymbolNamespace.Type);
        assert(symbol?.kind === "struct");

        return symbol.fields?.find(f => f.name === nameNode.text);
    }

    resolveStructMemberName(path: string, nameNode: SyntaxNode): StructFieldSymbol | undefined {
        const structNode = nameNode.parent!.parent!;
        assert(structNode.type === "struct_member");

        const structNameNode = structNode.childForFieldName("name");
        if (!structNameNode) {
            return;
        }

        const symbol = this.resolveTypeName(path, structNameNode);
        if (symbol?.kind !== "struct") {
            return;
        }
        return symbol.fields?.find(f => f.name === nameNode.text);
    }

    //==========================================================================
    //= Type Inference

    inferType(path: string, exprNode: SyntaxNode | Nullish): Type {
        if (!exprNode) {
            return { kind: "error" };
        }

        if (exprNode.type === "grouped_expr") {
            const innerNode = exprNode.childForFieldName("inner");
            return this.inferType(path, innerNode);
        } else if (exprNode.type === "name_expr") {
            const symbol = this.resolveValueName(path, exprNode);
            if (!symbol) {
                return { kind: "error" };
            }
            return valueSymbolType(symbol);
        } else if (exprNode.type === "literal_expr") {
            const literalNode = exprNode.firstNamedChild;
            if (!literalNode) {
                return { kind: "error" };
            }
            if (literalNode.type === "string_literal") {
                return { kind: "pointer", elementType: { kind: "int", size: 8 } };
            } else if (literalNode.type === "char_literal") {
                return { kind: "int", size: 8 };
            } else if (literalNode.type === "number_literal") {
                return { kind: "int", size: 64 };
            } else if (literalNode.type === "bool_literal") {
                return { kind: "bool" };
            } else if (literalNode.type === "null_literal") {
                return { kind: "pointer", elementType: { kind: "void" } };
            } else {
                throw new Error(`Unreachable: ${literalNode.type}`);
            }
        } else if (exprNode.type === "ternary_expr") {
            const thenNode = exprNode.childForFieldName("then");
            const elseNode = exprNode.childForFieldName("else");
            const thenType = this.inferType(path, thenNode);
            const elseType = this.inferType(path, elseNode);
            return unifyTypes(thenType, elseType);
        } else if (exprNode.type === "binary_expr") {
            const leftNode = exprNode.childForFieldName("left");
            const rightNode = exprNode.childForFieldName("right");
            const operator = exprNode.childForFieldName("operator")?.text;
            if (["=", "+=", "-="].includes(operator!)) {
                return { kind: "void" };
            } else if (["&&", "||", "==", "!=", "<", "<=", ">", ">="].includes(operator!)) {
                return { kind: "bool" };
            } else {
                const leftType = this.inferIntegerType(path, leftNode);
                const rightType = this.inferIntegerType(path, rightNode);
                return unifyTypes(leftType, rightType);
            }
        } else if (exprNode.type === "sizeof_expr") {
            return { kind: "int", size: 64 };
        } else if (exprNode.type === "unary_expr") {
            const operandNode = exprNode.childForFieldName("operand");
            const operator = exprNode.childForFieldName("operator")?.text;
            if (operator === "&") {
                return { kind: "pointer", elementType: this.inferType(path, operandNode) };
            } else if (operator === "*") {
                const operandType = this.inferType(path, operandNode);
                if (operandType.kind === "pointer") {
                    return operandType.elementType;
                } else {
                    return { kind: "error" };
                }
            } else if (operator === "-") {
                return this.inferIntegerType(path, operandNode);
            } else if (operator === "!") {
                return { kind: "bool" };
            } else {
                throw new Error(`Unreachable: ${operator}`);
            }
        } else if (exprNode.type === "call_expr") {
            const calleeNode = exprNode.childForFieldName("callee");
            if (!calleeNode) {
                return { kind: "error" };
            }
            const symbol = this.resolveValueName(path, calleeNode);
            if (!symbol || symbol.kind !== "func") {
                return { kind: "error" };
            }
            return symbol.returnType;
        } else if (exprNode.type === "index_expr") {
            const indexeeNode = exprNode.childForFieldName("indexee");
            const indexeeType = this.inferType(path, indexeeNode);
            if (indexeeType.kind === "pointer") {
                return indexeeType.elementType;
            } else if (indexeeType.kind === "array") {
                return indexeeType.elementType;
            } else {
                return { kind: "error" };
            }
        } else if (exprNode.type === "field_expr") {
            const nameNode = exprNode.childForFieldName("name");
            if (!nameNode) {
                return { kind: "error" };
            }
            const fieldSymbol = this.resolveFieldName(path, nameNode);
            if (!fieldSymbol) {
                return { kind: "error" };
            }
            return fieldSymbol.type;
        } else if (exprNode.type === "cast_expr") {
            const typeNode = exprNode.childForFieldName("type");
            return this.evalType(path, typeNode);
        } else {
            throw new Error(`Unreachable: ${exprNode.type}`);
        }
    }

    private inferIntegerType(path: string, exprNode: SyntaxNode | Nullish): Type {
        const type = this.inferType(path, exprNode);
        return type.kind === "int"
            ? type
            : { kind: "error" };
    }

    //==========================================================================
    //= Type Evaluation

    evalType(path: string, node: SyntaxNode | Nullish): Type {
        if (!node) {
            return { kind: "error" };
        }

        if (node.type === "grouped_type") {
            return this.evalType(path, node.childForFieldName("type"));
        } else if (node.type === "name_type") {
            const name = node.text;
            if (name == "Void") {
                return { kind: "void" };
            } else if (name == "Bool") {
                return { kind: "bool" };
            } else if (name == "Char" || name == "Int8") {
                return { kind: "int", size: 8 };
            } else if (name == "Int16") {
                return { kind: "int", size: 16 };
            } else if (name == "Int32") {
                return { kind: "int", size: 32 };
            } else if (name == "Int" || name == "Int64") {
                return { kind: "int", size: 64 };
            } else {
                if (!this.existsStruct(path, name)) {
                    return { kind: "error" };
                }
                return { kind: "struct", name };
            }
        } else if (node.type === "pointer_type") {
            const pointeeNode = node.childForFieldName("pointee");
            const pointeeType = this.evalType(path, pointeeNode);
            return { kind: "pointer", elementType: pointeeType };
        } else if (node.type === "array_type") {
            const elementTypeNode = node.childForFieldName("element_type");
            const sizeNode = node.childForFieldName("size");
            const elementType = this.evalType(path, elementTypeNode);
            const size = this.evalConst(path, sizeNode);
            return { kind: "array", elementType, size };
        } else {
            throw new Error(`Unreachable: ${node.type}`);
        }
    }

    //==========================================================================
    //= Constant Evaluation

    private evalConst(path: string, node: SyntaxNode | Nullish): number | undefined {
        if (!node) {
            return;
        }
        if (node.type === "literal_expr") {
            const literalNode = node.firstNamedChild;
            if (!literalNode) {
                return;
            }
            if (literalNode.type === "int_literal") {
                return parseInt(literalNode.text);
            }
        } else if (node.type === "sizeof_expr") {
            throw new Error("Not implemented");
        } else if (node.type === "unary_expr") {
            const operandNode = node.childForFieldName("operand");
            const operator = node.childForFieldName("operator")?.text;
            const operandValue = this.evalConst(path, operandNode);
            if (!operandValue) {
                return undefined;
            }
            if (operator === "-") {
                return -operandValue;
            }
        } else if (node.type === "binary_expr") {
            const leftNode = node.childForFieldName("left");
            const rightNode = node.childForFieldName("right");
            const operator = node.childForFieldName("operator")?.text;
            const leftValue = this.evalConst(path, leftNode);
            const rightValue = this.evalConst(path, rightNode);
            if (!leftValue || !rightValue) {
                return;
            }
            if (operator === "+") {
                return leftValue + rightValue;
            } else if (operator === "-") {
                return leftValue - rightValue;
            }
        } else if (node.type === "name_expr") {
            const symbol = this.lookupSymbolFromNode(path, node.parent!, node, SymbolNamespace.Value);
            if (symbol?.kind !== "const") {
                return;
            }
            return symbol.value;
        }
    }

    //==========================================================================
    //= Symbol Lookup

    private existsStruct(path: string, name: string): boolean {
        return !stream(this.indexService.index(path).entries)
            .filter(entry => entry.name === name && entry.type === "struct")
            .isEmpty();
    }

    private lookupGlobalSymbol(path: string, name: string, namespace: SymbolNamespace): Symbol | undefined {
        const symbols = stream(this.indexService.index(path).entries)
            .filter(entry => entry.name === name && isInNamespace(entry.type, namespace))
            .groupBy(entry => entry.type)
            .map(([type, entries]) => this.createSymbolFromEntries(type, entries))
            .toArray();
        if (symbols.length !== 1) {
            return;
        }
        return symbols[0];
    }

    private lookupSymbolFromNode(path: string, node: SyntaxNode, nameNode: SyntaxNode, namespace: SymbolNamespace): Symbol | undefined {
        let scopeNode: SyntaxNode | null = node;
        do {
            const symbol = this.lookupSymbolInNode(path, scopeNode, nameNode, namespace);
            if (symbol === 'loop') {
                return;
            }
            if (symbol) {
                return symbol;
            }
            scopeNode = scopeNode.parent;
        } while (scopeNode);
        return this.lookupGlobalSymbol(path, nameNode.text, namespace);
    }

    private lookupSymbolInNode(path: string, node: SyntaxNode, searchNode: SyntaxNode, namespace: SymbolNamespace): Symbol | 'loop' | undefined {
        if (namespace !== SymbolNamespace.Value)
            return;

        if (node.type === "block_stmt") {
            for (const child of node.namedChildren) {
                if (child.type === "local_decl") {
                    const nameNode = child.childForFieldName("name");
                    if (nameNode && nameNode.text === searchNode.text) {
                        const valueNode = child.childForFieldName("value");
                        if (valueNode && rangeContains(valueNode, searchNode)) {
                            return 'loop';
                        }
                        return this.createLocalSymbol(path, child);
                    }
                }
            }
        } else if (node.type === "func_decl") {
            const paramsNode = node.childForFieldName("params");
            if (paramsNode) {
                for (const child of paramsNode.namedChildren) {
                    if (child.type === "param_decl") {
                        const nameNode = child.childForFieldName("name");
                        if (nameNode && nameNode.text === searchNode.text) {
                            return this.createFuncParamSymbol(path, child);
                        }
                    }
                }
            }
        } else if (node.type === "struct_decl") {
            const body = node.childForFieldName("body");
            if (body) {
                for (const child of body.namedChildren) {
                    if (child.type === "struct_member") {
                        const nameNode = child.childForFieldName("name");
                        if (nameNode && nameNode.text === searchNode.text) {
                            return this.createstructFieldSymbol(path, child);
                        }
                    }
                }
            }
        }
    }

    //==========================================================================
    //= Creating symbols

    private createSymbolFromEntries(type: SymbolType, entries: IndexEntry[]): Symbol {
        return stream(entries)
            .map(entry => this.createSymbolFromEntry(type, entry))
            .toArray()
            .reduce(mergeSymbol);
    }

    private createSymbolFromEntry(type: SymbolType, entry: IndexEntry): Symbol {
        if (type === "struct") {
            return this.createStructSymbol(entry);
        } else if (type === "func") {
            return this.createFuncSymbol(entry);
        } else if (type === "global") {
            return this.createGlobalSymbol(entry);
        } else if (type === "const") {
            return this.createConstSymbol(entry);
        } else {
            throw new Error(`Unreachable: ${type}`);
        }
    }

    private createStructSymbol(entry: IndexEntry): StructSymbol {
        const body = entry.origin.node.childForFieldName("body");
        return {
            kind: "struct",
            name: entry.name,
            origins: [entry.origin],
            fields: body
                ? stream(body.namedChildren)
                    .filterMap(child => this.createstructFieldSymbol(entry.origin.file, child))
                    .toArray()
                : undefined,
        };
    }

    private createstructFieldSymbol(path: string, node: SyntaxNode): StructFieldSymbol {
        const nameNode = node.childForFieldName("name") ?? undefined;
        const typeNode = node.childForFieldName("type");
        return {
            kind: "struct_field",
            name: nameNode?.text ?? "{unknown}",
            origins: [{ file: path, nameNode, node }],
            type: this.evalType(path, typeNode),
        };
    }

    private createFuncSymbol(entry: IndexEntry): FuncSymbol {
        const paramsNode = entry.origin.node.childForFieldName("params");
        const returnTypeNode = entry.origin.node.childForFieldName("return_type");
        return {
            kind: "func",
            name: entry.name,
            origins: [entry.origin],
            params: paramsNode
                ? this.createFuncParams(entry.origin.file, paramsNode)
                : [],
            returnType: returnTypeNode
                ? this.evalType(entry.origin.file, returnTypeNode)
                : { kind: "void" },
            isVariadic: !!paramsNode?.namedChildren.some(child => child.type === "variadic_param"),
        };
    }

    private createFuncParams(path: string, paramsNode: SyntaxNode): FuncParamSymbol[] {
        return stream(paramsNode.namedChildren)
            .filter(child => child.type === "param_decl")
            .map(child => this.createFuncParamSymbol(path, child))
            .toArray();
    }

    private createFuncParamSymbol(path: string, node: SyntaxNode): FuncParamSymbol {
        const nameNode = node.childForFieldName("name") ?? undefined;
        const typeNode = node.childForFieldName("type");
        return {
            kind: "func_param",
            name: nameNode?.text ?? "{unknown}",
            origins: [{ file: path, nameNode, node }],
            type: this.evalType(path, typeNode),
        };
    }

    private createGlobalSymbol(entry: IndexEntry): GlobalSymbol {
        const isExtern = !!entry.origin.node.childForFieldName("externModifier");
        const typeNode = entry.origin.node.childForFieldName("type");
        return {
            kind: "global",
            name: entry.name,
            origins: [entry.origin],
            type: this.evalType(entry.origin.file, typeNode),
            isExtern,
        };
    }

    private createConstSymbol(entry: IndexEntry): Symbol {
        const valueNode = entry.origin.node.childForFieldName("value");
        return {
            kind: "const",
            name: entry.name,
            origins: [entry.origin],
            value: valueNode ? this.evalConst(entry.origin.file, valueNode) : undefined,
        };
    }

    private createLocalSymbol(path: string, node: SyntaxNode): Symbol {
        const nameNode = node.childForFieldName("name") ?? undefined;
        const typeNode = node.childForFieldName("type");
        const exprNode = node.childForFieldName("value");
        return {
            kind: "local",
            name: nameNode?.text ?? "{unknown}",
            origins: [{ file: path, nameNode, node }],
            type: typeNode
                ? this.evalType(path, typeNode)
                : exprNode
                    ? this.inferType(path, exprNode)
                    : { kind: "error" },
        };
    }
}

//================================================================================
//= Symbol namespaces

enum SymbolNamespace {
    Type,
    Value,
}

function isInNamespace(type: SymbolType, namespace: SymbolNamespace): boolean {
    if (namespace === SymbolNamespace.Type) {
        return type === "struct";
    } else {
        return type !== "struct";
    }
}

//================================================================================
//== Symbol merging

function mergeSymbol<S extends Symbol>(existing: S, sym: S): Symbol {
    if (existing.kind === "struct") {
        return tryMergeStructSymbol(existing, <StructSymbol>sym);
    } else if (existing.kind === "func") {
        return tryMergeFuncSymbol(existing, <FuncSymbol>sym);
    } else if (existing.kind === "global") {
        return mergeGlobalSymbol(existing, <GlobalSymbol>sym);
    } else if (existing.kind === "const") {
        return mergeConstSymbol(existing, <ConstSymbol>sym);
    } else {
        throw new Error(`Unreachable: ${existing.kind}`);
    }
}

function tryMergeStructSymbol(existing: StructSymbol, sym: StructSymbol): StructSymbol {
    return {
        kind: "struct",
        name: existing.name,
        origins: existing.origins.concat(sym.origins),
        fields: existing.fields && sym.fields ? mergeFieldSymbols(existing.fields, sym.fields) : existing.fields || sym.fields,
    };
}

function mergeFieldSymbols(fields1: StructFieldSymbol[], fields2: StructFieldSymbol[]): StructFieldSymbol[] {
    return stream(fields1).concat(fields2)
        .groupBy(field => field.name)
        .map(([_, fields]) => fields.reduce(mergeFieldSymbol))
        .toArray();
}

function mergeFieldSymbol(field1: StructFieldSymbol, field2: StructFieldSymbol): StructFieldSymbol {
    return {
        kind: "struct_field",
        name: field1.name,
        origins: field1.origins.concat(field2.origins),
        type: unifyTypes(field1.type, field2.type),
    };
}

function tryMergeFuncSymbol(existing: FuncSymbol, sym: FuncSymbol): FuncSymbol {
    return {
        kind: "func",
        name: existing.name,
        origins: existing.origins.concat(sym.origins),
        params: mergeFuncParams(existing.params, sym.params),
        returnType: unifyTypes(existing.returnType, sym.returnType),
        isVariadic: existing.isVariadic,
    };
}

function mergeFuncParams(params1: FuncParamSymbol[], params2: FuncParamSymbol[]): FuncParamSymbol[] {
    return stream(params1).zipLongest(params2)
        .map(([p1, p2]) => p1 && p2 ? mergeFuncParam(p1, p2) : p1 || p2)
        .toArray();
}

function mergeFuncParam(param1: FuncParamSymbol, param2: FuncParamSymbol): FuncParamSymbol {
    return {
        kind: "func_param",
        name: param1.name === param2.name ? param1.name : "{unknown}",
        origins: param1.origins.concat(param2.origins),
        type: unifyTypes(param1.type, param2.type),
    };
}

function mergeGlobalSymbol(existing: GlobalSymbol, sym: GlobalSymbol): GlobalSymbol {
    return {
        kind: "global",
        name: existing.name,
        origins: existing.origins.concat(sym.origins),
        type: unifyTypes(existing.type, sym.type),
        isExtern: existing.isExtern && sym.isExtern,
    };
}

function mergeConstSymbol(existing: ConstSymbol, sym: ConstSymbol): ConstSymbol {
    return {
        kind: "const",
        name: existing.name,
        origins: existing.origins.concat(sym.origins),
        value: mergeValue(existing.value, sym.value),
    };

    function mergeValue(x1: number | undefined, x2: number | undefined): number | undefined {
        x1 ??= x2;
        x2 ??= x1;
        return x1 === x2 ? x1 : undefined;
    }
}

//================================================================================
//= Helpers

function isFieldName(nameNode: SyntaxNode): boolean {
    return nameNode.parent!.type === "field_expr"
}

function isTypeName(nameNode: SyntaxNode): boolean {
    return nameNode.parent!.type === "name_type" || nameNode.parent!.type === "struct_decl";
}

function isValueName(nameNode: SyntaxNode): boolean {
    return [
        "enum_member",
        "struct_decl",
        "struct_member",
        "func_decl",
        "param_decl",
        "global_decl",
        "const_decl",
        "local_decl",
        "name_expr",
    ].includes(nameNode.parent!.type);
}
