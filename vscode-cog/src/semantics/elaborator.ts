import assert from 'assert';
import { IncludeResolver } from '../services/IncludeResolver';
import { ParsingService } from '../services/parsingService';
import { SyntaxNode, Tree } from '../syntax';
import {
    ExprNodeType,
    isExprNode,
    isStmtNode,
    isTopLevelNode,
    LiteralNodeType,
    StmtNodeType,
    TopLevelNodeType,
    TypeNodeType,
} from '../syntax/nodeTypes';
import { Nullish, PointRange } from '../utils';
import { stream } from '../utils/stream';
import { Scope } from './scope';
import {
    ConstSym,
    FuncParamSym,
    FuncSym,
    GlobalSym,
    LocalSym,
    Origin,
    StructFieldSym,
    StructSym,
    Sym,
    SymKind,
    tryMergeSym,
} from './sym';
import {
    isScalarType,
    isValidReturnType,
    mkArrayType,
    mkBoolType,
    mkErrorType,
    mkIntType,
    mkPointerType,
    mkStructType,
    mkVoidType,
    prettyType,
    tryUnifyTypes,
    Type,
    TypeKind,
    typeLe,
} from './type';
import { TypeLayout, typeLayout } from './typeLayout';

export type ErrorLocation = {
    file: string;
    range: PointRange;
};

export type ElaborationError = {
    message: string;
    location: ErrorLocation;
};

export type SymReference = {
    file: string;
    nameNode: SyntaxNode;
};

export type ElaboratorResult = {
    scope: Scope;
    symbols: Map<string, Sym>;
    nodeSymMap: WeakMap<SyntaxNode, string>;
    nodeTypeMap: WeakMap<SyntaxNode, Type>;
    references: Map<string, SymReference[]>;
    errors: ElaborationError[];
};

export class Elaborator {
    private parseTree: Tree;

    private scope: Scope;

    // Symbol.qualifiedName -> Symbol
    private symbols: Map<string, Sym> = new Map();
    // Symbol.qualifiedName -> Reference[]
    private references: Map<string, SymReference[]> = new Map();

    // SyntaxNode -> Symbol.qualifiedName
    private nodeSymMap: WeakMap<SyntaxNode, string> = new WeakMap();
    // SyntaxNode -> Type
    private nodeTypeMap: WeakMap<SyntaxNode, Type> = new WeakMap();

    private errors: ElaborationError[] = [];

    // Current function
    private currentFunc: FuncSym | undefined;
    private nextLocalIndex: number = 0;

    private constructor(
        private parsingService: ParsingService,
        private includeResolver: IncludeResolver,
        private path: string,
    ) {
        this.parseTree = this.parsingService.parse(path);
        this.scope = new Scope(this.path, this.parseTree.rootNode);
    }

    private run(): ElaboratorResult {
        this.elabTree(this.parseTree);
        return {
            scope: this.scope,
            symbols: this.symbols,
            nodeSymMap: this.nodeSymMap,
            nodeTypeMap: this.nodeTypeMap,
            references: this.references,
            errors: this.errors,
        };
    }

    public static elaborate(
        parsingService: ParsingService,
        includeResolver: IncludeResolver,
        path: string,
    ): ElaboratorResult {
        return new Elaborator(parsingService, includeResolver, path).run();
    }

    //==============================================================================
    //== Scopes and Symbols

    private enterScope(node: SyntaxNode) {
        this.scope = new Scope(this.path, node, this.scope);
    }

    private exitScope() {
        if (!this.scope.parent)
            throw new Error(`Unreachable: exitScope`);
        this.scope = this.scope.parent;
    }

    private lookupSymbol(name: string) {
        const qname = this.scope.lookup(name);
        if (!qname)
            return;
        return this.symbols.get(qname);
    }

    private addSymbol<T extends Sym>(nameNode: SyntaxNode | Nullish, sym: T): T {
        if (!sym.name)
            return sym;

        const origin = nameNode ?? sym.origins[0].node;

        const existing = this.lookupSymbol(sym.name);
        if (!existing) {
            this.scope.add(sym.name, sym.qualifiedName);
            this.symbols.set(sym.qualifiedName, sym);
        } else if (sym.kind === existing.kind) {
            const [merged, mergeErr] = tryMergeSym(existing, sym);
            if (mergeErr) {
                this.reportError(origin, `Conflicting declaration of '${sym.name}'.`);
            }
            assert(existing.qualifiedName === merged.qualifiedName);
            this.symbols.set(merged.qualifiedName, merged);
            sym = merged as T;
        } else {
            this.reportError(origin, `Another symbol with the same name already exists.`);
        }

        if (nameNode) {
            this.recordNameIntroduction(sym, nameNode);
        }

        return sym;
    }

    private resolveName(nameNode: SyntaxNode): Sym | undefined {
        const name = nameNode.text;
        const sym = this.lookupSymbol(name);
        if (sym) {
            this.recordNameResolution(sym, nameNode);
            return sym;
        } else {
            this.reportError(nameNode, `Unknown symbol '${name}'.`);
            return undefined;
        }
    }

    private resolveStructField(structName: string, nameNode: SyntaxNode) {
        const sym = this.symbols.get(structName);
        assert(sym?.kind === SymKind.Struct);

        const fieldName = nameNode.text;
        const field = sym.fields?.find(f => f.name === fieldName);
        if (!field) {
            this.reportError(nameNode, `Unknown field '${fieldName}'.`);
            return undefined;
        }

        this.recordNameResolution(field, nameNode);
        return field;
    }

    private recordNameIntroduction(sym: Sym, nameNode: SyntaxNode) {
        assert(nameNode.type === 'identifier');
        this.nodeSymMap.set(nameNode, sym.qualifiedName);
    }

    private recordNameResolution(sym: Sym, nameNode: SyntaxNode) {
        assert(nameNode.type === 'identifier');
        this.nodeSymMap.set(nameNode, sym.qualifiedName);

        const references = this.references.get(sym.qualifiedName) ?? [];
        references.push({ file: this.path, nameNode: nameNode });
        this.references.set(sym.qualifiedName, references);
    }

    //==============================================================================
    //== Types

    private typeEval(typeNode: SyntaxNode | Nullish): Type {
        if (!typeNode)
            return mkErrorType();

        return this.trackTyping(typeNode, () => {
            const nodeType = typeNode.type as TypeNodeType;
            switch (nodeType) {
                case TypeNodeType.GroupedType: {
                    const nestedTypeNode = typeNode.childForFieldName('type');
                    return this.typeEval(nestedTypeNode);
                }
                case TypeNodeType.NameType: {
                    const nameNode = typeNode.firstChild!;
                    switch (nameNode.text) {
                        case 'Void':
                            return mkVoidType();
                        case 'Bool':
                            return mkBoolType();
                        case 'Char':
                        case 'Int8':
                            return mkIntType(8);
                        case 'Int16':
                            return mkIntType(16);
                        case 'Int32':
                            return mkIntType(32);
                        case 'Int':
                        case 'Int64':
                            return mkIntType(64);
                        default: {
                            const sym = this.resolveName(nameNode);
                            if (!sym) {
                                return mkErrorType();
                            }
                            if (sym.kind !== SymKind.Struct) {
                                this.reportError(typeNode, `'${sym.name}' is not a struct.`);
                                return mkErrorType();
                            }
                            return mkStructType(sym.name, sym.qualifiedName);
                        }
                    }
                }
                case TypeNodeType.PointerType: {
                    const pointeeNode = typeNode.childForFieldName('pointee');
                    return mkPointerType(this.typeEval(pointeeNode));
                }
                case TypeNodeType.ArrayType: {
                    const elemNode = typeNode.childForFieldName('type');
                    const sizeNode = typeNode.childForFieldName('size');

                    const elemType = this.typeEval(elemNode);
                    if (this.isUnsizedType(elemType)) {
                        this.reportError(typeNode, `The element type of an array must have a known size.`);
                    }

                    let size = this.constEval(sizeNode);
                    if (size !== undefined && size <= 0) {
                        this.reportError(typeNode, `Array size must be positive.`);
                        size = undefined;
                    }

                    return mkArrayType(elemType, size);
                }
                default: {
                    const unreachable: never = nodeType;
                    throw new Error(`Unexpected node type: ${unreachable}`);
                }
            }
        });
    }

    //==============================================================================
    //== Constants

    private constEval(node: SyntaxNode | Nullish): number | undefined {
        if (!node)
            return;

        const reportInvalidConstExpr = () => {
            this.reportError(node, `Invalid constant expression.`);
        };

        switch (node.type) {
            case ExprNodeType.GroupedExpr: {
                const nestedNode = node.childForFieldName('expr');
                return this.constEval(nestedNode);
            }
            case ExprNodeType.NameExpr: {
                const nameNode = node.firstChild!;
                const sym = this.resolveName(nameNode);
                if (!sym) {
                    return;
                }
                if (sym.kind !== SymKind.Const) {
                    this.reportError(nameNode, `'${sym.name}' is not a constant.`);
                    return;
                }
                return sym.value;
            }
            case ExprNodeType.LiteralExpr: {
                switch (node.firstChild!.type) {
                    case LiteralNodeType.Number:
                        return parseInt(node.firstChild!.text);
                    case LiteralNodeType.Char:
                        return parseChar(node.firstChild!.text);
                    default:
                        reportInvalidConstExpr();
                        return;
                }
            }
            case ExprNodeType.BinaryExpr: {
                const left = this.constEval(node.childForFieldName('left'));
                const right = this.constEval(node.childForFieldName('right'));
                const op = node.childForFieldName('operator')?.text;

                if (left === undefined || right === undefined || !op) {
                    return;
                }
                switch (op) {
                    case '+': return left + right;
                    case '-': return left - right;
                    case '*': return left * right;
                    case '/': return left / right;
                    case '%': return left % right;
                    case '<<': return left << right;
                    case '>>': return left >> right;
                    case '&': return left & right;
                    case '|': return left | right;
                    case '^': return left ^ right;
                    default:
                        reportInvalidConstExpr();
                        return;
                }
            }
            case ExprNodeType.UnaryExpr: {
                const operand = this.constEval(node.childForFieldName('operand'));
                const op = node.childForFieldName('operator')?.text;

                if (operand === undefined || !op) {
                    return;
                }
                switch (op) {
                    case '-': return -operand;
                    case '~': return ~operand;
                    default:
                        reportInvalidConstExpr();
                        return;
                }
            }
            case ExprNodeType.SizeofExpr: {
                const typeNode = node.childForFieldName('type');
                const type = this.typeEval(typeNode);
                return this.typeSize(type);
            }
            default: {
                reportInvalidConstExpr();
                return;
            }
        }
    }

    //==============================================================================
    //== Top-level

    private elabTree(tree: Tree) {
        for (const node of stream(tree.rootNode.children).filter(node => isTopLevelNode(node))) {
            this.elabTopLevelDecl(node);
        }
    }

    private elabTopLevelDecl(node: SyntaxNode) {
        const nodeType = node.type as TopLevelNodeType;
        switch (nodeType) {
            case TopLevelNodeType.Include:
                this.elabInclude(node);
                break;
            case TopLevelNodeType.Struct:
                this.elabStruct(node);
                break;
            case TopLevelNodeType.Func:
                this.elabFunc(node);
                break;
            case TopLevelNodeType.Global:
                this.elabGlobal(node);
                break;
            case TopLevelNodeType.Const:
                this.elabConst(node);
                break;
            case TopLevelNodeType.Enum:
                this.elabEnum(node);
                break;
            default: {
                const unreachable: never = nodeType;
                throw new Error(`Unexpected node type: ${unreachable}`);
            }
        }
    }

    private elabInclude(node: SyntaxNode) {
        const pathNode = node.childForFieldName('path');
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
        const nameNode = node?.childForFieldName('name');
        const bodyNode = node.childForFieldName('body');

        const name = nameNode?.text ?? '';
        const sym: StructSym = {
            kind: SymKind.Struct,
            name,
            qualifiedName: name,
            origins: [this.createOrigin(node, nameNode, !bodyNode)],
            fields: undefined,
        };

        this.addSymbol<StructSym>(nameNode, { ...sym });

        if (bodyNode) {
            sym.fields = [];
            this.enterScope(bodyNode);

            for (const fieldNode of stream(bodyNode.children).filter(n => n.type === 'struct_member')) {
                this.elabStructField(fieldNode, sym);
            }

            this.exitScope();
        }

        this.addSymbol(nameNode, sym);
    }

    private elabStructField(fieldNode: SyntaxNode, structSym: StructSym) {
        const nameNode = fieldNode.childForFieldName('name');
        const typeNode = fieldNode.childForFieldName('type');

        const fieldType = this.typeEval(typeNode);

        const fieldName = nameNode?.text;
        if (!fieldName)
            return;

        const fieldSym: StructFieldSym = {
            kind: SymKind.StructField,
            name: fieldName,
            qualifiedName: `${structSym.name}.${fieldName}`,
            origins: [this.createOrigin(fieldNode, nameNode)],
            type: fieldType,
        };
        this.addSymbol(nameNode, fieldSym);
        structSym.fields!.push(fieldSym);
    }

    private elabEnum(node: SyntaxNode) {
        const body = node.childForFieldName('body');
        if (!body)
            return;

        let nextValue: number = 0;
        for (const memberNode of stream(body.children).filter(n => n.type === 'enum_member')) {
            nextValue = this.elabEnumMember(memberNode, nextValue);
        }
    }

    private elabEnumMember(memberNode: SyntaxNode, nextValue: number) {
        const nameNode = memberNode.childForFieldName('name');
        const valueNode = memberNode.childForFieldName('value');

        const name = nameNode?.text ?? '';
        const value = valueNode ? this.constEval(valueNode) : nextValue;

        this.addSymbol<ConstSym>(nameNode, {
            kind: SymKind.Const,
            name,
            qualifiedName: name,
            origins: [this.createOrigin(memberNode, nameNode)],
            value,
        });

        return (value ?? nextValue) + 1;
    }

    private elabFunc(node: SyntaxNode) {
        const nameNode = node?.childForFieldName('name');
        const paramNodes = node.childrenForFieldName('params');
        const bodyNode = node.childForFieldName('body');

        const name = nameNode?.text ?? '';
        const params = stream(paramNodes)
            .filter(n => n.type === 'param_decl')
            .map<FuncParamSym>((paramNode, index) => this.elabFuncParam(paramNode, name, index))
            .toArray();

        const isVariadic = !!paramNodes.some(child => child.type === 'variadic_param');

        const returnTypeNode = node.childForFieldName('return_type');
        const returnType: Type = returnTypeNode ? this.typeEval(returnTypeNode) : mkVoidType();

        if (isInvalidReturnType(returnType)) {
            this.reportError(returnTypeNode!, `Function return type must be void or of scalar type.`);
        }

        const unmergedSym: FuncSym = {
            kind: SymKind.Func,
            name,
            qualifiedName: name,
            origins: [this.createOrigin(node, nameNode, !bodyNode)],
            params,
            returnType,
            isVariadic,
            isDefined: !!bodyNode,
        };
        const mergedSym = this.addSymbol(nameNode, unmergedSym);

        this.enterScope(node);

        for (const param of params) {
            this.addSymbol(param.origins[0].nameNode, param);
        }

        this.currentFunc = mergedSym.kind === SymKind.Func ? mergedSym : unmergedSym;
        this.nextLocalIndex = 0;

        if (bodyNode) {
            this.elabBlockStmt(bodyNode);
        }

        this.currentFunc = undefined;
        this.nextLocalIndex = undefined!;

        this.exitScope();
    }

    private elabFuncParam(paramNode: SyntaxNode, funcName: string, paramIndex: number): FuncParamSym {
        const nameNode = paramNode.childForFieldName('name');
        const typeNode = paramNode.childForFieldName('type');

        const name = nameNode?.text ?? '';

        const type = this.typeEval(typeNode);
        if (isNonScalarType(type)) {
            this.reportError(paramNode, `Function parameter must be of scalar type.`);
        }

        return {
            kind: SymKind.FuncParam,
            name,
            qualifiedName: `${funcName}.${paramIndex}`,
            origins: [this.createOrigin(paramNode, nameNode)],
            type,
        };
    }

    private elabGlobal(node: SyntaxNode) {
        const externNode = node.children.find(n => n.type === 'extern');
        const nameNode = node?.childForFieldName('name');
        const typeNode = node.childForFieldName('type');

        const isExtern = !!externNode;
        const name = nameNode?.text ?? '';

        const type = this.typeEval(typeNode);
        if (this.isUnsizedType(type)) {
            this.reportError(node, `Variable must have a known size.`);
        }

        this.addSymbol<GlobalSym>(nameNode, {
            kind: SymKind.Global,
            name,
            qualifiedName: name,
            origins: [this.createOrigin(node, nameNode, isExtern)],
            isDefined: !isExtern,
            type,
        });
    }

    private elabConst(node: SyntaxNode) {
        const nameNode = node?.childForFieldName('name');
        const valueNode = node.childForFieldName('value');

        const name = nameNode?.text ?? '';
        const value = this.constEval(valueNode);

        this.addSymbol<ConstSym>(nameNode, {
            kind: SymKind.Const,
            name,
            qualifiedName: name,
            origins: [this.createOrigin(node, nameNode)],
            value,
        });
    }

    //==============================================================================
    //== Statements

    private elabStmt(node: SyntaxNode | Nullish) {
        if (!node)
            return;

        switch (node.type) {
            case StmtNodeType.BlockStmt:
                this.elabBlockStmt(node);
                break;
            case StmtNodeType.LocalDecl:
                this.elabLocalDecl(node);
                break;
            case StmtNodeType.IfStmt:
                this.elabIfStmt(node);
                break;
            case StmtNodeType.WhileStmt:
                this.elabWhileStmt(node);
                break;
            case StmtNodeType.ReturnStmt:
                this.elabReturnStmt(node);
                break;
            case StmtNodeType.BreakStmt:
            case StmtNodeType.ContinueStmt:
                break;
            case StmtNodeType.ExprStmt:
                this.elabExprStmt(node);
                break;
            default:
                throw new Error(`Unexpected node type: ${node.type}`);
        }
    }

    private elabBlockStmt(node: SyntaxNode) {
        this.enterScope(node);
        for (const stmtNode of node.namedChildren.filter(n => isStmtNode(n))) {
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
        const nameNode = node?.childForFieldName('name');
        const typeNode = node.childForFieldName('type');
        const initNode = node.childForFieldName('value');

        const name = nameNode?.text ?? '';

        const declaredType = typeNode ? this.typeEval(typeNode) : undefined;

        const inferedType = initNode ? this.elabExprInfer(initNode) : undefined;

        if (declaredType && inferedType) {
            this.checkType(initNode!, declaredType);
        }
        let type = declaredType ?? inferedType;

        if (!type) {
            this.reportError(node, `Missing type in local declaration.`);
            type ??= mkErrorType();
        }
        if (this.isUnsizedType(type)) {
            this.reportError(node, `Variable must have a known size.`);
        }

        const qname = `${this.currentFunc!.name}.x${this.nextLocalIndex++}`;

        this.addSymbol<LocalSym>(nameNode, {
            kind: SymKind.Local,
            name,
            qualifiedName: qname,
            origins: [this.createOrigin(node, nameNode)],
            type,
        });
    }

    private elabIfStmt(node: SyntaxNode) {
        const condNode = node.childForFieldName('cond');
        const thenNode = node.childForFieldName('then');
        const elseNode = node.childForFieldName('else');

        this.elabExprBool(condNode);
        this.elabStmtWithScope(thenNode);
        this.elabStmtWithScope(elseNode);
    }

    private elabWhileStmt(node: SyntaxNode) {
        const condNode = node.childForFieldName('cond');
        const bodyNode = node.childForFieldName('body');

        this.elabExprBool(condNode);
        this.elabStmtWithScope(bodyNode);
    }

    private elabReturnStmt(node: SyntaxNode) {
        const valueNode = node.childForFieldName('value');

        const returnType = this.currentFunc!.returnType;
        if (valueNode) {
            this.elabExpr(valueNode, returnType);
        } else if (returnType.kind !== TypeKind.Void) {
            this.reportError(node, `Missing return value.`);
        }
    }

    private elabExprStmt(node: SyntaxNode) {
        const exprNode = node.childForFieldName('expr');
        this.elabExprInfer(exprNode);
    }

    //==============================================================================
    //== Expressions

    private elabExpr(node: SyntaxNode | Nullish, expectedType: Type) {
        if (!node)
            return mkErrorType();

        this.elabExprInfer(node);
        this.checkType(node, expectedType);
    }

    private elabExprBool(node: SyntaxNode | Nullish): Type {
        this.elabExpr(node, mkBoolType());
        return mkBoolType();
    }

    private elabExprInt(node: SyntaxNode | Nullish, expectedType?: Type): Type {
        if (!node)
            return mkErrorType();

        assert(!expectedType || expectedType.kind === TypeKind.Int);

        const type = this.elabExprInfer(node);
        if (type.kind !== TypeKind.Int) {
            if (type.kind !== TypeKind.Err) {
                this.reportError(node, `Expected integer expression.`);
            }
            return expectedType ?? mkErrorType();
        } else {
            return type;
        }
    }

    private elabExprInfer(node: SyntaxNode | Nullish): Type {
        if (!node)
            return mkErrorType();

        return this.trackTyping(node, () => {
            const nodeType = node.type as ExprNodeType;
            switch (nodeType) {
                case ExprNodeType.GroupedExpr:
                    return this.elabGroupedExpr(node);
                case ExprNodeType.NameExpr:
                    return this.elabNameExpr(node);
                case ExprNodeType.SizeofExpr:
                    return this.elabSizeofExpr(node);
                case ExprNodeType.LiteralExpr:
                    return this.elabLiteralExpr(node);
                case ExprNodeType.BinaryExpr:
                    return this.elabBinaryExpr(node);
                case ExprNodeType.TernaryExpr:
                    return this.elabTernaryExpr(node);
                case ExprNodeType.UnaryExpr:
                    return this.elabUnaryExpr(node);
                case ExprNodeType.CallExpr:
                    return this.elabCallExpr(node);
                case ExprNodeType.IndexExpr:
                    return this.elabIndexExpr(node);
                case ExprNodeType.FieldExpr:
                    return this.elabFieldExpr(node);
                case ExprNodeType.CastExpr:
                    return this.elabCastExpr(node);
                default: {
                    const unreachable: never = nodeType;
                    throw new Error(`Unexpected node type: ${unreachable} `);
                }
            }
        });
    }

    private elabGroupedExpr(node: SyntaxNode): Type {
        const nestedNode = node.childForFieldName('expr');
        return this.elabExprInfer(nestedNode);
    }

    private elabNameExpr(nameExpr: SyntaxNode): Type {
        const nameNode = nameExpr.firstChild!;
        const sym = this.resolveName(nameNode);
        if (!sym) {
            return mkErrorType();
        }

        switch (sym.kind) {
            case SymKind.Const:
                return mkIntType(64);
            case SymKind.Global:
            case SymKind.Local:
            case SymKind.FuncParam:
                return sym.type;
            case SymKind.Struct:
            case SymKind.Func:
            case SymKind.StructField:
                return mkErrorType();
            default: {
                const unreachable: never = sym;
                throw new Error(`Unreachable: ${unreachable} `);
            }
        }
    }

    private elabSizeofExpr(node: SyntaxNode): Type {
        const typeNode = node.childForFieldName('type');
        this.typeEval(typeNode);
        return mkIntType(64);
    }

    private elabLiteralExpr(node: SyntaxNode): Type {
        const nodeType = (node.firstChild!).type as LiteralNodeType;
        switch (nodeType) {
            case LiteralNodeType.Bool:
                return mkBoolType();
            case LiteralNodeType.Number:
                return mkIntType(64);
            case LiteralNodeType.Char:
                return mkIntType(8);
            case LiteralNodeType.String:
                return mkPointerType(mkIntType(8));
            case LiteralNodeType.Null:
                return mkPointerType(mkVoidType());
            default: {
                const unreachable: never = nodeType;
                throw new Error(`Unexpected literal type: ${unreachable} `);
            }
        }
    }

    private elabUnaryExpr(node: SyntaxNode): Type {
        const op = node.childForFieldName('operator')!.text;
        const operandNode = node.childForFieldName('operand');
        switch (op) {
            case '!':
                return this.elabExprBool(operandNode);
            case '-':
                return this.elabExprInt(operandNode);
            case '~':
                return this.elabExprInt(operandNode);
            case '&':
            {
                if (operandNode && !isLvalue(operandNode)) {
                    this.reportError(operandNode, `Expected lvalue.`);
                }
                return mkPointerType(this.elabExprInfer(operandNode));
            }
            case '*':
            {
                const operandType = this.elabExprInfer(operandNode);
                if (operandType?.kind !== TypeKind.Ptr) {
                    if (operandNode && operandType.kind !== TypeKind.Err) {
                        this.reportError(operandNode, `Expected pointer type.`);
                    }
                    return mkErrorType();
                }
                return operandType.pointeeType;
            }
            default:
                return mkErrorType();
        }
    }

    private elabBinaryExpr(node: SyntaxNode): Type {
        const op = node.childForFieldName('operator')!.text;
        switch (op) {
            case '=':
            case '+=':
            case '-=':
            {
                const leftNode = node.childForFieldName('left');
                const rightNode = node.childForFieldName('right');

                if (!isLvalue(leftNode)) {
                    this.reportError(leftNode ?? node, `L-value expected.`);
                }
                const leftType = op !== '='
                    ? this.elabExprInt(leftNode)
                    : this.elabExprInfer(leftNode);

                if (rightNode) {
                    this.elabExpr(rightNode, leftType);
                }
                return mkVoidType();
            }
            case '+':
            case '-':
            case '*':
            case '/':
            case '%':
            case '<<':
            case '>>':
            case '&':
            case '|':
            case '^':
            {
                const leftNode = node.childForFieldName('left');
                const rightNode = node.childForFieldName('right');
                this.elabExprInt(leftNode);
                this.elabExprInt(rightNode);
                return this.unifyTypes(node, leftNode, rightNode);
            }
            case '==':
            case '!=':
            case '<':
            case '<=':
            case '>':
            case '>=':
            {
                const leftNode = node.childForFieldName('left');
                const rightNode = node.childForFieldName('right');
                this.elabExprInfer(leftNode);
                this.elabExprInfer(rightNode);
                const cmpType = this.unifyTypes(node, leftNode, rightNode);
                if (cmpType.kind === TypeKind.Err && !isScalarType(cmpType)) {
                    this.reportError(node, `${prettyType(cmpType)} is not comparable.`);
                }
                return mkBoolType();
            }
            case '&&':
            case '||':
            {
                const leftNode = node.childForFieldName('left');
                const rightNode = node.childForFieldName('right');
                this.elabExprBool(leftNode);
                this.elabExprBool(rightNode);
                return mkBoolType();
            }
            default:
                return mkErrorType();
        }
    }

    private elabTernaryExpr(node: SyntaxNode): Type {
        this.elabExprBool(node.childForFieldName('cond'));
        const thenNode = node.childForFieldName('then');
        const elseNode = node.childForFieldName('else');
        this.elabExprInfer(thenNode);
        this.elabExprInfer(elseNode);
        return this.unifyTypes(node, thenNode, elseNode);
    }

    private elabCallExpr(node: SyntaxNode): Type {
        const calleeNode = node.childForFieldName('callee');
        const argsNodes = node.childrenForFieldName('args');
        if (!calleeNode) {
            return mkErrorType();
        }
        if (calleeNode.type !== ExprNodeType.NameExpr) {
            this.reportError(calleeNode, `Function name expected.`);
            return mkErrorType();
        }

        const funcNameNode = calleeNode.firstChild!;
        const funcName = funcNameNode.text;

        const funcSym = this.resolveName(funcNameNode);
        if (!funcSym) {
            return mkErrorType();
        }
        if (funcSym.kind !== SymKind.Func) {
            this.reportError(calleeNode, `'${funcName}' is not a function.`);
            return mkErrorType();
        }

        const params = funcSym.params;
        const args = argsNodes.filter(x => isExprNode(x));

        if (args.length < params.length) {
            this.reportError(node, `Too few arguments provided (${args.length} < ${params.length}).`);
        } else if (args.length > params.length && !funcSym.isVariadic) {
            this.reportError(node, `Too many arguments provided (${args.length} > ${params.length}).`);
        }
        for (let i = 0; i < args.length; i++) {
            if (i < params.length) {
                this.elabExpr(args[i], params[i].type);
            } else if (funcSym.isVariadic) {
                const argType = this.elabExprInfer(args[i]);
                if (isNonScalarType(argType)) {
                    this.reportError(node, `Variadic argument must be scalar type.`);
                }
            }
        }

        return funcSym.returnType;
    }

    private elabIndexExpr(node: SyntaxNode): Type {
        const indexeeNode = node.childForFieldName('indexee');
        const indexNode = node.childForFieldName('index');

        const indexeeType = this.elabExprInfer(indexeeNode);
        if (indexeeType.kind !== TypeKind.Arr && indexeeType.kind !== TypeKind.Ptr) {
            if (indexeeType.kind !== TypeKind.Err) {
                this.reportError(indexeeNode ?? node, `Expression is not indexable.`);
            }
            return mkErrorType();
        }

        this.elabExprInt(indexNode);

        return indexeeType.kind === TypeKind.Arr
            ? indexeeType.elemType
            : indexeeType.pointeeType;
    }

    private elabField(node: SyntaxNode): StructFieldSym | undefined {
        const leftNode = node.childForFieldName('left');
        const nameNode = node.childForFieldName('name');

        let leftType = this.elabExprInfer(leftNode);
        if (leftType.kind === TypeKind.Ptr) {
            leftType = leftType.pointeeType;
        }
        if (leftType.kind !== TypeKind.Struct) {
            if (leftType.kind !== TypeKind.Err) {
                this.reportError(node, `Expected struct type.`);
            }
            return;
        }

        if (!nameNode) {
            return;
        }
        return this.resolveStructField(leftType.qualifiedName, nameNode);
    }

    private elabFieldExpr(node: SyntaxNode): Type {
        const field = this.elabField(node);
        return field?.type ?? mkErrorType();
    }

    private elabCastExpr(node: SyntaxNode): Type {
        const typeNode = node.childForFieldName('type');
        const exprNode = node.childForFieldName('expr');

        const castType = this.typeEval(typeNode);
        const exprType = this.elabExprInfer(exprNode);

        if (isNonScalarType(castType) || isNonScalarType(exprType)) {
            this.reportError(node, `Invalid cast type.`);
        }

        return castType;
    }

    //==============================================================================
    //== Type checking

    private tryCoerce(node: SyntaxNode, expected: Type) {
        if (expected.kind === TypeKind.Int && expected.size && isIntegerLiteralExpr(node)) {
            const bitsRequired = Math.ceil(Math.log2(parseInt(node.text)) + 1);
            if (bitsRequired < expected.size) {
                this.nodeTypeMap.set(node, expected);
            }
        }
    }

    private unifyTypes(node: SyntaxNode, e1: SyntaxNode | Nullish, e2: SyntaxNode | Nullish): Type {
        if (!(e1 && e2)) {
            return e1 ? this.getType(e1) : e2 ? this.getType(e2) : mkErrorType();
        }

        this.tryCoerce(e1, this.getType(e2));
        this.tryCoerce(e2, this.getType(e1));

        const t1 = this.getType(e1);
        const t2 = this.getType(e2);

        let err = false;
        const unified = tryUnifyTypes(t1, t2, () => {
            err = true;
        });
        if (err) {
            this.reportError(node, `Type mismatch. Cannot unify '${prettyType(t1)}' and '${prettyType(t2)}'.`);
        }

        return unified;
    }

    private checkType(node: SyntaxNode, expected: Type) {
        this.tryCoerce(node, expected);

        const actual = this.getType(node);

        if (expected.kind === TypeKind.Ptr && expected.pointeeType.kind === TypeKind.Void && actual.kind === TypeKind.Ptr) {
            return;
        }
        if (!typeLe(actual, expected)) {
            this.reportError(node, `Type mismatch. Expected '${prettyType(expected)}', got '${prettyType(actual)}'.`);
        }
    }

    //==============================================================================
    //== Helper methods

    private setType(node: SyntaxNode, type: Type) {
        this.nodeTypeMap.set(node, type);
    }

    private getType(node: SyntaxNode): Type {
        const type = this.nodeTypeMap.get(node);
        assert(type, `Missing type for node: ${node.type}`);
        return type;
    }

    private trackTyping(node: SyntaxNode, f: () => Type): Type {
        const type = f();
        this.setType(node, type);
        return type;
    }

    private reportError(node: SyntaxNode, message: string) {
        this.errors.push({
            message,
            location: {
                file: this.path,
                range: node,
            },
        });
    }

    private typeLayout(type: Type): TypeLayout | undefined {
        return typeLayout(type, {
            getStruct: name => {
                const sym = this.symbols.get(name);
                if (!sym || sym.kind !== SymKind.Struct)
                    return;
                return sym;
            },
        });
    }

    private typeSize(type: Type): number | undefined {
        return this.typeLayout(type)?.size;
    }

    private isUnsizedType(type: Type): boolean {
        return this.typeSize(type) === undefined;
    }

    private createOrigin(node: SyntaxNode, nameNode: SyntaxNode | Nullish, isForwardDecl: boolean = false): Origin {
        return {
            file: this.path,
            node,
            nameNode: nameNode ?? undefined,
            isForwardDecl,
        };
    }
}

//================================================================================
//== Utility functions

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
            return isLvalue(node.childForFieldName('expr'));
        case ExprNodeType.FieldExpr:
            return isLvalue(node.childForFieldName('expr'));
        case ExprNodeType.UnaryExpr:
            return node.childForFieldName('operator')?.text === '*';
        default:
            return false;
    }
}

function isNonScalarType(type: Type): boolean {
    return type.kind !== TypeKind.Err && !isScalarType(type);
}

function isInvalidReturnType(type: Type): boolean {
    return type.kind !== TypeKind.Err && !isValidReturnType(type);
}

function isIntegerLiteralExpr(node: SyntaxNode): boolean {
    return node.type === ExprNodeType.LiteralExpr
        && node.firstChild!.type === LiteralNodeType.Number;
}
