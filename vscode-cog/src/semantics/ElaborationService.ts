import { SyntaxNode } from "tree-sitter";
import { IncludeResolver } from "../IncludeResolver";
import { ParsingService } from "../parser";
import { Elaborator } from "./Elaborator";
import { StructFieldSym, Sym } from "./sym";
import { Type } from "./type";

interface IElaborationService {
    resolveSymbol(path: string, nameNode: SyntaxNode): Sym | undefined;
    inferType(path: string, exprNode: SyntaxNode): Type;
    evalType(path: string, node: SyntaxNode): Type;
}

export class ElaborationService implements IElaborationService {
    constructor(
        private parsingService: ParsingService,
        private includeResolver: IncludeResolver,
    ) { }

    resolveSymbol(path: string, nameNode: SyntaxNode): Sym | undefined {
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

    private resolveTypeName(path: string, nameNode: SyntaxNode): Sym | undefined {
        let node: SyntaxNode | undefined = nameNode.parent!;

        return this.lookup(path, node, nameNode.text);
    }

    private resolveValueName(path: string, nameNode: SyntaxNode): Sym | undefined {
        let node: SyntaxNode | undefined = nameNode.parent!;

        return this.lookup(path, node, nameNode.text);
    }

    private resolveFieldName(path: string, nameNode: SyntaxNode): StructFieldSym | undefined {
        return this.createElaboratorForScope(path, nameNode).elabField(nameNode.parent!);
    }

    inferType(path: string, exprNode: SyntaxNode): Type {
        return this.createElaboratorForScope(path, exprNode).elabExprInfer(exprNode);
    }

    evalType(path: string, node: SyntaxNode): Type {
        return this.createElaboratorForScope(path, node).typeEval(node);
    }

    private lookup(path: string, node: SyntaxNode | null, name: string): Sym | undefined {
        return this.createElaboratorForScope(path, node).scope.lookup(name);
    }

    private createElaboratorForScope(path: string, node: SyntaxNode | null): Elaborator {
        const tree = this.parsingService.parse(path);
        const elaborator = new Elaborator(this.parsingService, this.includeResolver, path);
        elaborator.elab(tree);
        if (!node || !elaborator.gotoPosition(node.startPosition)) {
            throw new Error("Failed to create elaborator for scope");
        }
        return elaborator;
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
