import assert from "assert"
import { Point, SyntaxNode, Tree } from "tree-sitter"
import { IncludeResolver } from "../IncludeResolver"
import { ParsingService } from "../parser"
import { Nullish, PointRange, rangeContainsPoint } from "../utils"
import { stream } from "../utils/stream"
import {
    ConstSym,
    FuncParamSym,
    FuncSym,
    GlobalSym, LocalSym,
    Origin,
    StructFieldSym,
    StructSym,
    Sym,
    SymKind
} from './sym'
import { isScalarType, prettyType, tryUnifyTypes, Type, typeLe } from "./type"
import { ExprNodeType, LiteralNodeType, StmtNodeType, TopLevelNodeType, TypeNodeType } from "./TypeNodeType"

export class Scope {
    symbols: Map<string, Sym> = new Map();
    children: Scope[] = [];

    constructor(public file: string, public range: PointRange, public parent?: Scope) {
        parent?.children.push(this)
    }

    add(sym: Sym) {
        this.symbols.set(sym.name, sym)
    }

    lookup(name: string): Sym | undefined {
        return this.symbols.get(name) ?? this.parent?.lookup(name);
    }

    get(name: string): Sym | undefined {
        return this.symbols.get(name);
    }

    findScopeForPosition(file: string, position: Point): Scope | undefined {
        if (file !== this.file || !rangeContainsPoint(this.range, position))
            return;

        for (const child of this.children) {
            const scope = child.findScopeForPosition(file, position);
            if (scope) {
                return scope;
            }
        }

        return this;
    }
}

type Location = {
    file: string,
    range: PointRange,
}

type ElaborationError = {
    message: string,
    location: Location,
}

export class Elaborator {
    scope!: Scope;
    errors: ElaborationError[] = []
    currentFunc: FuncSym | undefined

    constructor(
        private parsingService: ParsingService,
        private includeResolver: IncludeResolver,
        private path: string,
    ) { }

    elab(tree: Tree) {
        this.scope = new Scope(this.path, tree.rootNode);
        this.elabTree(tree);
    }

    gotoPosition(position: Point): boolean {
        const scope = this.scope.findScopeForPosition(this.path, position);
        if (!scope) {
            return false;
        }
        this.scope = scope;
        return true;
    }

    gotoRoot() {
        while (this.scope.parent) {
            this.scope = this.scope.parent;
        }
    }

    private reportError(node: SyntaxNode, message: string) {
        this.errors.push({
            message,
            location: {
                file: this.path,
                range: node
            }
        });
    }

    private unifyTypes(node: SyntaxNode, t1: Type, t2: Type): Type {
        let ok = true;
        const unified = tryUnifyTypes(t1, t2, () => { ok = false });
        if (node && !ok) {
            this.reportError(node, `Cannot unify types '${prettyType(t1)}' and '${prettyType(t2)}'.`)
        }
        return unified;
    }

    private checkType(node: SyntaxNode, expected: Type, actual: Type) {
        if (!node || !expected || !actual)
            debugger;
        actual = this.unifyTypes(node, expected, actual);
        if (!typeLe(expected, actual)) {
            this.reportError(node, `Expected type '${prettyType(expected)}', got '${prettyType(actual)}'.`);
        }
        return expected;
    }

    private createOrigin(node: SyntaxNode, nameNode: SyntaxNode | Nullish): Origin {
        return {
            file: this.path,
            node,
            nameNode: nameNode ?? undefined,
        }
    }

    //==============================================================================
    //== Scopes and Symbols

    private enterScope(node: SyntaxNode) {
        this.scope = new Scope(this.path, node, this.scope)
    }

    private exitScope() {
        if (!this.scope.parent)
            throw new Error(`Unreachable: exitScope`)
        this.scope = this.scope.parent;
    }

    addSymbol<T extends Sym>(sym: T) {
        if (!sym.name)
            return;

        const existing = this.scope.get(sym.name);
        if (!existing) {
            this.scope.add(sym);
            return;
        }

        if (sym.kind === existing.kind) {
            const [ok, merged] = tryMergeSym(existing, sym);
            this.scope.add(merged);
            if (ok) {
                return;
            }
        }

        this.reportError(sym.origins[0].node, `Conflicting declaration of '${sym.name}'.`);
    }

    //==============================================================================
    //== Types

    typeEval(typeNode: SyntaxNode | Nullish): Type {
        if (!typeNode)
            return { kind: "error" }

        const nodeType = typeNode.type as TypeNodeType;
        switch (nodeType) {
            case TypeNodeType.GroupedType:
                return this.typeEval(typeNode.childForFieldName("type"))
            case TypeNodeType.NameType:
                switch (typeNode.text) {
                    case "Void":
                        return { kind: "void" }
                    case "Bool":
                        return { kind: "bool" }
                    case "Char":
                    case "Int8":
                        return { kind: "int", size: 8 }
                    case "Int16":
                        return { kind: "int", size: 16 }
                    case "Int32":
                        return { kind: "int", size: 32 }
                    case "Int":
                    case "Int64":
                        return { kind: "int", size: 64 }
                    default: {
                        const sym = this.scope.lookup(typeNode.text)
                        if (sym?.kind !== SymKind.Struct) {
                            this.reportError(typeNode, `Unknown type '${typeNode.text}'.`)
                            return { kind: "error" }
                        }
                        return { kind: "struct", name: sym.name }
                    }
                }
            case TypeNodeType.PointerType:
                return {
                    kind: "pointer",
                    elementType: this.typeEval(typeNode.childForFieldName("pointee"))
                }
            case TypeNodeType.ArrayType:
                return {
                    kind: "array",
                    elementType: this.typeEval(typeNode.childForFieldName("type")),
                    size: this.constEval(typeNode.childForFieldName("size"))
                }
            default:
                const unreachable: never = nodeType;
                throw new Error(`Unexpected node type: ${unreachable}`);
        }
    }

    typeLayout(type: Type): { size: number, align: number } {
        switch (type.kind) {
            case "void":
                return { size: 0, align: 1 }
            case "bool":
                return { size: 1, align: 1 }
            case "int":
                const size = type.size! / 8
                return { size: size, align: size }
            case "pointer":
                return { size: 8, align: 8 }
            case "array":
                const elemLayout = this.typeLayout(type.elementType)
                return { size: elemLayout.size * type.size!, align: elemLayout.align }
            case "struct": {
                const sym = this.scope.lookup(type.name)
                if (sym?.kind !== SymKind.Struct)
                    return { size: 0, align: 1 }
                return stream(sym.fields ?? [])
                    .map(field => this.typeLayout(field.type))
                    .reduce(
                        (a, b) => ({
                            size: alignUp(a.size, b.align) + b.size,
                            align: Math.max(a.align, b.align),
                        }),
                        { size: 0, align: 1 }
                    )
            }
            case "error":
                return { size: 0, align: 1 }
            default:
                const unreachable: never = type;
                throw new Error(`Unexpected type: ${unreachable}`);
        }

        function alignUp(size: number, align: number) {
            return Math.ceil(size / align) * align
        }
    }

    typeSize(type: Type): number {
        return this.typeLayout(type).size
    }

    //==============================================================================
    //== Constants

    private constEval(node: SyntaxNode | Nullish): number | undefined {
        if (!node)
            return;

        const reportInvalidConstExpr = () => {
            this.reportError(node, `Invalid constant expression.`);
        }

        switch (node.type) {
            case ExprNodeType.GroupedExpr:
                return this.constEval(node.childForFieldName("expr"));
            case ExprNodeType.NameExpr:
                const name = node.text;
                const sym = this.scope.lookup(name);
                if (!sym || sym.kind !== SymKind.Const) {
                    this.reportError(node, `Unknown constant '${name}'.`);
                    return;
                }
                return sym.value;
            case ExprNodeType.LiteralExpr:
                switch (node.firstChild!.type) {
                    case LiteralNodeType.Number:
                        return parseInt(node.firstChild!.text)
                    case LiteralNodeType.Char:
                        return parseChar(node.firstChild!.text)
                    default:
                        reportInvalidConstExpr();
                        return;
                }
            case ExprNodeType.BinaryExpr:
                const left = this.constEval(node.childForFieldName("left"))
                const right = this.constEval(node.childForFieldName("right"))
                const op = node.childForFieldName("op")?.text
                if (left === undefined || right === undefined || !op)
                    return;
                switch (op) {
                    case "+": return left + right;
                    case "-": return left - right;
                    case "*": return left * right;
                    case "/": return left / right;
                    case "%": return left % right;
                    case "<<": return left << right;
                    case ">>": return left >> right;
                    case "&": return left & right;
                    case "|": return left | right;
                    case "^": return left ^ right;
                    default:
                        reportInvalidConstExpr();
                        return;
                }
            case ExprNodeType.UnaryExpr:
                const operand = this.constEval(node.childForFieldName("operand"))
                const uop = node.childForFieldName("op")?.text
                if (operand === undefined || !uop)
                    return;
                switch (uop) {
                    case "-": return -operand
                    case '~': return ~operand
                    default:
                        reportInvalidConstExpr();
                        return;
                }
            case ExprNodeType.SizeofExpr:
                const type = this.typeEval(node.childForFieldName("type"))
                return this.typeSize(type);
            default:
                reportInvalidConstExpr();
                return
        }
    }

    //==============================================================================
    //== Top-level

    private elabTree(tree: Tree) {
        for (const node of stream(tree.rootNode.children).filter(node => isValueOf(TopLevelNodeType, node.type))) {
            this.elabTopLevelDecl(node)
        }
    }

    private elabTopLevelDecl(node: SyntaxNode) {
        const nodeType = node.type as TopLevelNodeType;
        switch (nodeType) {
            case TopLevelNodeType.Include:
                this.elabInclude(node);
                break;
            case TopLevelNodeType.Struct:
                this.elabStruct(node)
                break
            case TopLevelNodeType.Func:
                this.elabFunc(node)
                break
            case TopLevelNodeType.Global:
                this.elabGlobal(node)
                break
            case TopLevelNodeType.Const:
                this.elabConst(node)
                break
            case TopLevelNodeType.Enum:
                this.elabEnum(node)
                break
            default:
                const unreachable: never = nodeType;
                throw new Error(`Unexpected node type: ${unreachable}`)
        }
    }

    private elabInclude(node: SyntaxNode) {
        const pathNode = node.childForFieldName("path");
        if (!pathNode)
            return;

        const path = this.includeResolver.resolveInclude(this.path, pathNode);
        if (!path) {
            this.reportError(node, `Cannot resolve include.`);
            return;
        }

        const tree = this.parsingService.parse(path);

        const oldPath = this.path;
        this.path = path;
        this.elabTree(tree);
        this.path = oldPath;
    }

    private elabStruct(node: SyntaxNode) {
        const nameNode = node?.childForFieldName("name");
        const name = nameNode?.text ?? "";

        const sym: StructSym = {
            kind: SymKind.Struct,
            name,
            origins: [this.createOrigin(node, nameNode)],
            fields: undefined,
        }

        this.addSymbol<StructSym>(sym);

        const bodyNode = node.childForFieldName("body");
        if (bodyNode) {
            sym.fields = [];
            this.enterScope(bodyNode)

            for (const fieldNode of stream(bodyNode.children).filter(n => n.type === "struct_member")) {
                const fieldName = getName(fieldNode);
                if (!fieldName)
                    continue;

                const fieldType = this.typeEval(fieldNode.childForFieldName("type"));

                const fieldSymbol: StructFieldSym = {
                    kind: SymKind.StructField,
                    name: fieldName,
                    origins: [this.createOrigin(node, nameNode)],
                    type: fieldType,
                }
                sym.fields.push(fieldSymbol);
                this.addSymbol<StructFieldSym>(fieldSymbol);
            }

            this.exitScope();
        }

        this.addSymbol<StructSym>(sym);
    }

    private elabEnum(node: SyntaxNode) {
        const body = node.childrenForFieldName("body");
        if (!body)
            return;

        let nextValue: number = 0;
        for (const memberNode of stream(body).filter(n => n.type === "enum_member")) {
            const memberNameNode = memberNode.childForFieldName("name");
            const memberName = memberNameNode?.text ?? "";
            const valueNode = memberNode.childForFieldName("value");
            const value = valueNode ? this.constEval(valueNode) : nextValue;

            this.addSymbol<ConstSym>({
                kind: SymKind.Const,
                name: memberName,
                origins: [this.createOrigin(memberNode, memberNameNode)],
                value,
            })

            nextValue = (value ?? nextValue) + 1;
        }
    }

    private elabFunc(node: SyntaxNode) {
        const nameNode = node?.childForFieldName("name");
        const name = nameNode?.text ?? "";

        const paramsNode = node.childForFieldName("params");
        const params = stream(paramsNode?.children ?? [])
            .filter(n => n.type === "param_decl")
            .map<FuncParamSym>(n => {
                const paramName = getName(n) ?? "";
                const paramType = this.typeEval(n.childForFieldName("type"));
                return {
                    kind: SymKind.FuncParam,
                    name: paramName,
                    origins: [this.createOrigin(node, nameNode)],
                    type: paramType,
                }
            })
            .toArray();

        const isVariadic = !!paramsNode?.children.some(child => child.type === "variadic_param");

        const returnTypeNode = node.childForFieldName("return_type");
        const returnType: Type = returnTypeNode ? this.typeEval(returnTypeNode) : { kind: "void" };

        const bodyNode = node.childForFieldName("body");

        this.addSymbol<FuncSym>({
            kind: SymKind.Func,
            name,
            origins: [this.createOrigin(node, nameNode)],
            params,
            returnType,
            isVariadic,
            isDefined: !!bodyNode,
        });

        this.enterScope(node);

        for (const param of params) {
            this.addSymbol<FuncParamSym>(param);
        }

        this.currentFunc = this.scope.lookup(name) as FuncSym;

        if (bodyNode) {
            this.elabBlockStmt(bodyNode);
        }

        this.currentFunc = undefined;

        this.exitScope();
    }

    private elabGlobal(node: SyntaxNode) {
        const nameNode = node?.childForFieldName("name");
        const name = nameNode?.text ?? "";

        const isExtern = !!node.children.find(n => n.type === "extern");
        const type = this.typeEval(node.childForFieldName("type"));

        this.addSymbol<GlobalSym>({
            kind: SymKind.Global,
            name,
            origins: [this.createOrigin(node, nameNode)],
            isDefined: !isExtern,
            type,
        })
    }

    private elabConst(node: SyntaxNode) {
        const nameNode = node?.childForFieldName("name");
        const name = nameNode?.text ?? "";

        const value = this.constEval(node.childForFieldName("value"));

        this.addSymbol<ConstSym>({
            kind: SymKind.Const,
            name,
            origins: [this.createOrigin(node, nameNode)],
            value,
        })
    }

    //==============================================================================
    //== Statements

    private elabStmt(node: SyntaxNode | Nullish) {
        if (!node)
            return;

        switch (node.type) {
            case StmtNodeType.BlockStmt:
                this.elabBlockStmt(node)
                break
            case StmtNodeType.LocalDecl:
                this.elabLocalDecl(node)
                break
            case StmtNodeType.IfStmt:
                this.elabIfStmt(node)
                break
            case StmtNodeType.WhileStmt:
                this.elabWhileStmt(node)
                break
            case StmtNodeType.ReturnStmt:
                this.elabReturnStmt(node)
                break
            case StmtNodeType.JumpStmt:
                break
            case StmtNodeType.ExprStmt:
                this.elabExprStmt(node)
                break
            default:
                throw new Error(`Unexpected node type: ${node.type}`)
        }
    }

    private elabBlockStmt(node: SyntaxNode) {
        this.enterScope(node);
        for (const stmtNode of node.namedChildren.filter(n => isValueOf(StmtNodeType, n.type))) {
            this.elabStmt(stmtNode);
        }
        this.exitScope();
    }

    private elabStmtWithScope(node: SyntaxNode | Nullish) {
        if (!node)
            return;

        this.enterScope(node);
        this.elabStmt(node);
        this.exitScope();
    }

    private elabLocalDecl(node: SyntaxNode) {
        const nameNode = node?.childForFieldName("name");
        const name = nameNode?.text ?? "";

        const typeNode = node.childForFieldName("type");
        const initNode = node.childForFieldName("value");

        let declaredType = typeNode ? this.typeEval(typeNode) : undefined;

        let inferedType = initNode ? this.elabExprInfer(initNode) : undefined;

        if (declaredType && inferedType) {
            this.checkType(node, declaredType, inferedType);
        }
        let type = declaredType ?? inferedType;

        if (!type) {
            this.reportError(node, `Missing type in local declaration.`);
            type ??= { kind: "error" }
        }

        this.addSymbol<LocalSym>({
            kind: SymKind.Local,
            name,
            origins: [this.createOrigin(node, nameNode)],
            type,
        });
    }

    private elabIfStmt(node: SyntaxNode) {
        const condNode = node.childForFieldName("cond");
        const thenNode = node.childForFieldName("then");
        const elseNode = node.childForFieldName("else");

        this.elabExprBool(condNode);
        this.elabStmtWithScope(thenNode);
        this.elabStmtWithScope(elseNode);
    }

    private elabWhileStmt(node: SyntaxNode) {
        const condNode = node.childForFieldName("cond");
        const bodyNode = node.childForFieldName("body");

        this.elabExprBool(condNode);
        this.elabStmtWithScope(bodyNode);
    }

    private elabReturnStmt(node: SyntaxNode) {
        const returnType = this.currentFunc!.returnType;
        const valueNode = node.childForFieldName("value");
        if (returnType.kind === "void") {
            if (valueNode) {
                this.reportError(node, `Return value in void function.`);
            }
        } else {
            if (!valueNode) {
                this.reportError(node, `Missing return value.`);
            }
            this.elabExpr(valueNode, returnType);
        }
    }

    private elabExprStmt(node: SyntaxNode) {
        const exprNode = node.childForFieldName("expr");
        this.elabStmt(exprNode);
    }

    //==============================================================================
    //== Expressions

    private elabExpr(node: SyntaxNode | Nullish, expectedType: Type) {
        if (!node)
            return { kind: "error" }

        let inferredType = this.elabExprInfer(node);
        this.checkType(node, expectedType, inferredType);
    }

    private elabExprBool(node: SyntaxNode | Nullish): Type {
        this.elabExpr(node, { kind: "bool" });
        return { kind: "bool" };
    }

    private elabExprInt(node: SyntaxNode | Nullish, expectedType?: Type): Type {
        if (!node)
            return { kind: "error" }

        assert(!expectedType || expectedType.kind === "int");

        const type = this.elabExprInfer(node);
        if (type.kind !== "int") {
            if (type.kind !== "error") {
                this.reportError(node, `Expected integer expression.`);
            }
            return expectedType ?? { kind: "error" }
        } else {
            return type;
        }
    }

    public elabExprInfer(node: SyntaxNode | Nullish): Type {
        if (!node)
            return { kind: "error" }

        const nodeType = node.type as ExprNodeType;
        switch (nodeType) {
            case ExprNodeType.GroupedExpr:
                return this.elabExprInfer(node.childForFieldName("expr"))
            case ExprNodeType.NameExpr:
                return this.elabNameExpr(node)
            case ExprNodeType.SizeofExpr:
                return this.elabSizeofExpr(node)
            case ExprNodeType.LiteralExpr:
                return this.elabLiteralExpr(node)
            case ExprNodeType.BinaryExpr:
                return this.elabBinaryExpr(node)
            case ExprNodeType.TernaryExpr:
                return this.elabTernaryExpr(node)
            case ExprNodeType.UnaryExpr:
                return this.elabUnaryExpr(node)
            case ExprNodeType.CallExpr:
                return this.elabCallExpr(node)
            case ExprNodeType.IndexExpr:
                return this.elabIndexExpr(node)
            case ExprNodeType.FieldExpr:
                return this.elabFieldExpr(node)
            case ExprNodeType.CastExpr:
                return this.elabCastExpr(node)
            default:
                const unreachable: never = nodeType;
                throw new Error(`Unexpected node type: ${unreachable} `)
        }
    }

    private elabNameExpr(nameNode: SyntaxNode): Type {
        const name = nameNode.text;
        const sym = this.scope.lookup(name);
        if (!sym) {
            this.reportError(nameNode, `Unknown symbol '${name}'.`);
            return { kind: "error" }
        }

        switch (sym.kind) {
            case SymKind.Const:
                return { kind: "int", size: 64 }
            case SymKind.Global:
            case SymKind.Local:
            case SymKind.FuncParam:
                return sym.type
            case SymKind.Struct:
            case SymKind.Func:
            case SymKind.StructField:
                return { kind: "error" }
            default:
                const unreachable: never = sym;
                throw new Error(`Unreachable: ${unreachable} `);
        }
    }

    private elabSizeofExpr(node: SyntaxNode): Type {
        const typeNode = node.childForFieldName("type");
        this.typeEval(typeNode);
        return { kind: "int", size: 64 }
    }

    private elabLiteralExpr(node: SyntaxNode): Type {
        const nodeType = (node.firstChild!).type as LiteralNodeType;
        switch (nodeType) {
            case LiteralNodeType.Bool:
                return { kind: "bool" }
            case LiteralNodeType.Number:
                return { kind: "int", size: 64 }
            case LiteralNodeType.Char:
                return { kind: "int", size: 8 }
            case LiteralNodeType.String:
                return { kind: "pointer", elementType: { kind: "int", size: 8 } }
            case LiteralNodeType.Null:
                return { kind: "pointer", elementType: { kind: "void" } }
            default:
                const unreachable: never = nodeType;
                throw new Error(`Unexpected literal type: ${unreachable} `)
        }
    }

    private elabUnaryExpr(node: SyntaxNode): Type {
        const op = node.childForFieldName("operator")!.text;
        const operandNode = node.childForFieldName("operand");
        switch (op) {
            case "!":
                return this.elabExprBool(operandNode);
            case "-":
                return this.elabExprInt(operandNode);
            case "~":
                return this.elabExprInt(operandNode);
            case "&":
                {
                    if (operandNode && !isLvalue(operandNode)) {
                        this.reportError(operandNode, `Expected lvalue.`);
                    }
                    return { kind: "pointer", elementType: this.elabExprInfer(operandNode) }
                }
            case "*":
                {
                    const operandType = this.elabExprInfer(operandNode);
                    if (operandType?.kind !== "pointer") {
                        if (operandNode && operandType.kind !== "error") {
                            this.reportError(operandNode, `Expected pointer type.`);
                        }
                        return { kind: "error" }
                    }
                    return operandType.elementType;
                }
            default:
                return { kind: "error" }
        }
    }

    private elabBinaryExpr(node: SyntaxNode): Type {
        const op = node.childForFieldName("operator")!.text;
        switch (op) {
            case "=":
            case "+=":
            case "-=":
                {
                    const leftNode = node.childForFieldName("left");
                    const rightNode = node.childForFieldName("right");

                    if (!isLvalue(leftNode)) {
                        this.reportError(leftNode ?? node, `L - value expected.`);
                    }
                    const leftType = op !== "="
                        ? this.elabExprInt(leftNode)
                        : this.elabExprInfer(leftNode);

                    const rightType = this.elabExprInfer(rightNode);
                    if (rightNode) {
                        this.checkType(rightNode, leftType, rightType);
                    }

                    if (!isScalarType(leftType)) {
                        this.reportError(leftNode ?? node, `Expected scalar type.`);
                    }
                    return { kind: "void" }
                }
            case "+":
            case "-":
            case "*":
            case "/":
            case "%":
            case "<<":
            case ">>":
            case "&":
            case "|":
            case "^":
                {
                    const leftType = this.elabExprInt(node.childForFieldName("left"));
                    const rightType = this.elabExprInt(node.childForFieldName("right"));
                    return this.unifyTypes(node, leftType, rightType);
                }
            case "==":
            case "!=":
            case "<":
            case "<=":
            case ">":
            case ">=":
                {
                    const leftType = this.elabExprInfer(node.childForFieldName("left"));
                    const rightType = this.elabExprInfer(node.childForFieldName("right"));
                    const cmpType = this.unifyTypes(node, leftType, rightType);
                    if (cmpType.kind === "error" && !isScalarType(cmpType)) {
                        this.reportError(node, `${prettyType(cmpType)} is not comparable.`);
                    }
                    return { kind: "bool" }
                }
            case "&&":
            case "||":
                {
                    this.elabExprBool(node.childForFieldName("left"));
                    this.elabExprBool(node.childForFieldName("right"));
                    return { kind: "bool" }
                }
            default:
                return { kind: "error" }
        }
    }

    private elabTernaryExpr(node: SyntaxNode): Type {
        this.elabExprBool(node.childForFieldName("cond"));
        const thenType = this.elabExprInfer(node.childForFieldName("then"));
        const elseType = this.elabExprInfer(node.childForFieldName("else"));
        return this.unifyTypes(node, thenType, elseType);
    }

    private elabCallExpr(node: SyntaxNode): Type {
        const calleeNode = node.childForFieldName("callee");
        const argsNode = node.childForFieldName("args");

        if (!calleeNode)
            return { kind: "error" }

        if (calleeNode.type !== ExprNodeType.NameExpr) {
            this.reportError(calleeNode, `Function name expected.`);
            return { kind: "error" }
        }

        const funcName = calleeNode.text;

        const funcSym = this.scope.lookup(funcName);
        if (!funcSym || funcSym.kind !== SymKind.Func) {
            this.reportError(calleeNode, `Unknown function '${funcName}'.`);
            return { kind: "error" }
        }

        const params = funcSym.params;
        const args = (argsNode?.children ?? []).filter(n => isValueOf(ExprNodeType, n.type));

        if (args.length < params.length) {
            this.reportError(node, `Too few arguments provided(${args.length} < ${params.length}).`);
        } else if (args.length > params.length && !funcSym.isVariadic) {
            this.reportError(node, `Too many arguments provided(${args.length} > ${params.length}).`);
        }
        for (let i = 0; i < args.length; i++) {
            if (i < params.length) {
                this.elabExpr(args[i], params[i].type);
            } else if (funcSym.isVariadic) {
                const argType = this.elabExprInfer(args[i]);
                if (!isScalarType(argType)) {
                    this.reportError(node, `Variadic argument must be scalar type.\n`);
                }
            }
        }

        return funcSym.returnType;
    }

    private elabIndexExpr(node: SyntaxNode): Type {
        const indexeeNode = node.childForFieldName("indexee")
        const indexeeType = this.elabExprInfer(indexeeNode);
        if (indexeeType.kind !== "array" && indexeeType.kind !== "pointer") {
            if (indexeeType.kind !== "error") {
                this.reportError(indexeeNode ?? node, `Expression is not indexable.`);
            }
            return { kind: "error" }
        }
        this.elabExprInt(node.childForFieldName("index"));
        return indexeeType.elementType;
    }

    public elabField(node: SyntaxNode): StructFieldSym | undefined {
        let leftType = this.elabExprInfer(node.childForFieldName("left"));
        if (leftType.kind === "pointer") {
            leftType = leftType.elementType;
        }

        if (leftType.kind !== "struct") {
            if (leftType.kind !== "error") {
                this.reportError(node, `Expected struct type.`);
            }
            return undefined;
        }

        const sym = this.scope.lookup(leftType.name);
        assert(sym?.kind === SymKind.Struct);

        const fieldName = getName(node);

        const field = sym.fields?.find(f => f.name === fieldName);
        if (!field) {
            this.reportError(node, `Unknown field '${fieldName}'.`);
            return undefined;
        }
        return field;
    }

    private elabFieldExpr(node: SyntaxNode): Type {
        const field = this.elabField(node);
        return field?.type ?? { kind: "error" }
    }

    private elabCastExpr(node: SyntaxNode): Type {
        const typeNode = node.childForFieldName("type");
        const exprNode = node.childForFieldName("expr");

        const castType = this.typeEval(typeNode);
        const exprType = this.elabExprInfer(exprNode);

        if (!isScalarType(castType) || !isScalarType(exprType)) {
            this.reportError(node, `Invalid cast type.`);
        }

        return castType;
    }
}

//================================================================================
//== Utility functions

function isValueOf(enumType: Record<string, string>, value: string): boolean {
    return Object.values(enumType).includes(value);
}

function getName(node: SyntaxNode): string | undefined {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) {
        return;
    }

    return nameNode.text;
}

// 'a' => 97
// '\n' => 10
// '\x41' => 65
function parseChar(text: string): number {
    if (/^'\\x[0-9a-fA-F]{2}'$/.test(text)) {
        return parseInt(text.slice(3, 5), 16);
    } else if (/^'\\.'$/.test(text)) {
        const c = text[2];
        return JSON.parse(`"\\${c}"`).charCodeAt(0);
    } else {
        return text.charCodeAt(1);
    }
}

function isLvalue(node: SyntaxNode | Nullish): boolean {
    if (!node)
        return true;
    switch (node?.type) {
        case ExprNodeType.NameExpr:
            return true;
        case ExprNodeType.IndexExpr:
            return isLvalue(node.childForFieldName("expr"));
        case ExprNodeType.FieldExpr:
            return isLvalue(node.childForFieldName("expr"));
        default:
            return false;
    }
}

//================================================================================
//== Symbol merging

type ErrorSignal = () => void;

function tryMergeSym(existing: Sym, sym: Sym): [ok: boolean, sym: Sym] {
    assert(existing.name === sym.name);
    assert(existing.kind === sym.kind);

    let ok = true;
    const onError = () => {
        ok = false;
    }

    const merged = (() => {
        switch (existing.kind) {
            case SymKind.Struct:
                return tryMergeStructSym(existing, <StructSym>sym, onError);
            case SymKind.Func:
                return tryMergeFuncSym(existing, <FuncSym>sym, onError);
            case SymKind.Global:
                return tryMergeGlobalSym(existing, <GlobalSym>sym, onError);
            case SymKind.Const:
                return tryMergeConstSym(existing, <ConstSym>sym, onError);
            case SymKind.StructField:
                return tryMergeStructFieldSym(existing, <StructFieldSym>sym, onError);
            case SymKind.FuncParam:
                return tryMergeFuncParamSym(existing, <FuncParamSym>sym, onError);
            case SymKind.Local:
                return tryMergeLocalSym(existing, <LocalSym>sym, onError);
            default:
                const unreachable: never = existing;
                throw new Error(`Unexpected symbol kind: ${unreachable}`);
        }
    })();

    return [ok, merged];
}

function tryMergeStructSym(existing: StructSym, sym: StructSym, onError: ErrorSignal): StructSym {
    return {
        kind: SymKind.Struct,
        name: existing.name,
        origins: mergeOrigins(existing.origins, sym.origins),
        fields: tryMergeStructFields(existing, sym, onError),
    };

    function tryMergeStructFields(existing: StructSym, sym: StructSym, onError: ErrorSignal): StructFieldSym[] | undefined {
        if (!existing.fields || !sym.fields) {
            return existing.fields || sym.fields;
        }

        onError();
        return stream(existing.fields).concat(sym.fields)
            .groupBy(field => field.name)
            .map(([_, fields]) => fields.reduce((a, b) => tryMergeStructFieldSym(a, b, () => { })))
            .toArray();
    }
}

function tryMergeStructFieldSym(field1: StructFieldSym, field2: StructFieldSym, onError: ErrorSignal): StructFieldSym {
    return {
        kind: SymKind.StructField,
        name: field1.name,
        origins: mergeOrigins(field1.origins, field2.origins),
        type: tryUnifyTypes(field1.type, field2.type, onError),
    };
}

function tryMergeFuncSym(existing: FuncSym, sym: FuncSym, onError: ErrorSignal): FuncSym {
    return {
        kind: SymKind.Func,
        name: existing.name,
        origins: mergeOrigins(existing.origins, sym.origins),
        params: tryMergeFuncParams(existing.params, sym.params, onError),
        returnType: tryUnifyTypes(existing.returnType, sym.returnType, onError),
        isVariadic: tryMergeIsVariadic(),
        isDefined: tryMergeIsDefined(),
    };

    function tryMergeIsVariadic(): boolean {
        if (existing.isVariadic !== sym.isVariadic) {
            onError();
        }
        return existing.isVariadic || sym.isVariadic;
    }

    function tryMergeIsDefined(): boolean {
        if (existing.isDefined && sym.isDefined) {
            onError();
        }
        return existing.isDefined || sym.isDefined;
    }
}

function tryMergeFuncParams(params1: FuncParamSym[], params2: FuncParamSym[], onError: ErrorSignal): FuncParamSym[] {
    if (params1.length !== params2.length) {
        onError();
    }
    return stream(params1).zipLongest(params2)
        .map(([p1, p2]) => p1 && p2 ? tryMergeFuncParamSym(p1, p2, onError) : p1 || p2)
        .toArray();
}

function tryMergeFuncParamSym(param1: FuncParamSym, param2: FuncParamSym, onError: ErrorSignal): FuncParamSym {
    return {
        kind: SymKind.FuncParam,
        name: param1.name === param2.name ? param1.name : "{unknown}",
        origins: mergeOrigins(param1.origins, param2.origins),
        type: tryUnifyTypes(param1.type, param2.type, onError),
    };
}

function tryMergeGlobalSym(existing: GlobalSym, sym: GlobalSym, onError: ErrorSignal): GlobalSym {
    if (existing.isDefined && sym.isDefined) {
        onError();
    }
    return {
        kind: SymKind.Global,
        name: existing.name,
        origins: mergeOrigins(existing.origins, sym.origins),
        type: tryUnifyTypes(existing.type, sym.type, onError),
        isDefined: existing.isDefined || sym.isDefined,
    };
}

function tryMergeConstSym(existing: ConstSym, sym: ConstSym, onError: ErrorSignal): ConstSym {
    return {
        kind: SymKind.Const,
        name: existing.name,
        origins: mergeOrigins(existing.origins, sym.origins),
        value: mergeValue(existing.value, sym.value),
    };

    function mergeValue(x1: number | undefined, x2: number | undefined): number | undefined {
        if (x1 !== undefined && x2 !== undefined && x1 !== x2) {
            onError();
        }
        x1 ??= x2;
        x2 ??= x1;
        return x1 === x2 ? x1 : undefined;
    }
}

function tryMergeLocalSym(existing: LocalSym, sym: LocalSym, onError: ErrorSignal): LocalSym {
    onError();
    return {
        kind: SymKind.Local,
        name: existing.name,
        origins: mergeOrigins(existing.origins, sym.origins),
        type: tryUnifyTypes(existing.type, sym.type, onError),
    };
}

// Should be good enough for now. It's only structs that add the same symbol twice.
function mergeOrigins(origins1: Origin[], origins2: Origin[]): Origin[] {
    return origins1 === origins2 ? origins1 : [...origins1, ...origins2];
}
