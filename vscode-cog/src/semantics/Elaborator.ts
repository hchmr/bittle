import assert from 'assert';
import { SyntaxNode, Tree } from '../syntax';
import { IncludeResolver } from '../services/IncludeResolver';
import { ParsingService } from '../services/parsingService';
import {
    ExprNodeType,
    isExprNode,
    isStmtNode,
    isTopLevelNode,
    LiteralNodeType, StmtNodeType, TopLevelNodeType, TypeNodeType,
} from '../syntax/nodeTypes';
import { Nullish, PointRange } from '../utils';
import { stream } from '../utils/stream';
import {
    ConstSym,
    FuncParamSym,
    FuncSym,
    GlobalSym, LocalSym,
    Origin,
    StructFieldSym,
    StructSym,
    Sym,
    SymKind,
    tryMergeSym,
} from './sym';
import { isScalarType, prettyType, tryUnifyTypes, Type, typeLe } from './type';
import { TypeLayout, typeLayout } from './typeLayout';
import { Scope } from './scope';

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

    constructor(
        private parsingService: ParsingService,
        private includeResolver: IncludeResolver,
        private path: string,
    ) {
        this.parseTree = this.parsingService.parse(path);
        this.scope = new Scope(this.path, this.parseTree.rootNode);
    }

    run(): ElaboratorResult {
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

    private reportError(node: SyntaxNode, message: string) {
        this.errors.push({
            message,
            location: {
                file: this.path,
                range: node,
            },
        });
    }

    private unifyTypes(node: SyntaxNode, t1: Type, t2: Type): Type {
        let ok = true;
        const unified = tryUnifyTypes(t1, t2, () => { ok = false; });
        if (node && !ok) {
            this.reportError(node, `Cannot unify types '${prettyType(t1)}' and '${prettyType(t2)}'.`);
        }
        return unified;
    }

    private checkType(node: SyntaxNode, expected: Type) {
        let actual = this.nodeTypeMap.get(node) ?? mkErrorType(); ;
        actual = this.unifyTypes(node, expected, actual);
        if (!typeLe(expected, actual)) {
            this.reportError(node, `Expected type '${prettyType(expected)}', got '${prettyType(actual)}'.`);
        }
    }

    private createOrigin(node: SyntaxNode, nameNode: SyntaxNode | Nullish): Origin {
        return {
            file: this.path,
            node,
            nameNode: nameNode ?? undefined,
        };
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

        const existing = this.lookupSymbol(sym.name);
        if (!existing) {
            this.scope.add(sym.name, sym.qualifiedName);
            this.symbols.set(sym.qualifiedName, sym);
        } else if (sym.kind === existing.kind) {
            const [merged, mergeErr] = tryMergeSym(existing, sym);
            if (mergeErr) {
                this.reportError(sym.origins[0].node, `Conflicting declaration of '${sym.name}'.`);
            }
            assert(existing.qualifiedName === merged.qualifiedName);
            this.symbols.set(merged.qualifiedName, merged);
            sym = merged as T;
        } else {
            this.reportError(sym.origins[0].node, `Another symbol with the same name already exists.`);
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

    private recordNameIntroduction(sym: Sym, nameNode: SyntaxNode) {
        assert(nameNode.type === 'identifier');
        this.nodeSymMap.set(nameNode, sym.qualifiedName);
    }

    private recordNameResolution(sym: Sym, nameNode: SyntaxNode) {
        assert(nameNode.type === 'identifier');
        this.nodeSymMap.set(nameNode, sym.qualifiedName);

        const origin = this.createOrigin(nameNode, nameNode);
        const references = this.references.get(sym.qualifiedName) ?? [];
        references.push({ file: origin.file, nameNode: nameNode });
        this.references.set(sym.qualifiedName, references);
    }

    private trackTyping(node: SyntaxNode, f: () => Type): Type {
        const type = f();
        this.nodeTypeMap.set(node, type);
        return type;
    }

    //==============================================================================
    //== Types

    private typeEval(typeNode: SyntaxNode | Nullish): Type {
        if (!typeNode)
            return mkErrorType();

        return this.trackTyping(typeNode, () => {
            const nodeType = typeNode.type as TypeNodeType;
            switch (nodeType) {
                case TypeNodeType.GroupedType:
                    return this.typeEval(typeNode.childForFieldName('type'));
                case TypeNodeType.NameType:
                    const nameNode = typeNode.firstChild!;
                    switch (nameNode.text) {
                        case 'Void':
                            return { kind: 'void' };
                        case 'Bool':
                            return { kind: 'bool' };
                        case 'Char':
                        case 'Int8':
                            return { kind: 'int', size: 8 };
                        case 'Int16':
                            return { kind: 'int', size: 16 };
                        case 'Int32':
                            return { kind: 'int', size: 32 };
                        case 'Int':
                        case 'Int64':
                            return { kind: 'int', size: 64 };
                        default: {
                            const sym = this.resolveName(nameNode);
                            if (!sym) {
                                return mkErrorType();
                            }
                            if (sym.kind !== SymKind.Struct) {
                                this.reportError(typeNode, `'${sym.name}' is not a struct.`);
                                return mkErrorType();
                            }
                            return { kind: 'struct', name: sym.name, qualifiedName: sym.qualifiedName };
                        }
                    }
                case TypeNodeType.PointerType:
                    return {
                        kind: 'pointer',
                        elementType: this.typeEval(typeNode.childForFieldName('pointee')),
                    };
                case TypeNodeType.ArrayType:
                    return {
                        kind: 'array',
                        elementType: this.typeEval(typeNode.childForFieldName('type')),
                        size: this.constEval(typeNode.childForFieldName('size')),
                    };
                default:
                    const unreachable: never = nodeType;
                    throw new Error(`Unexpected node type: ${unreachable}`);
            }
        });
    }

    private typeLayout(type: Type): TypeLayout {
        return typeLayout(type, {
            getStruct: name => {
                const sym = this.symbols.get(name);
                if (!sym || sym.kind !== SymKind.Struct)
                    return;
                return sym;
            },
        });
    }

    private typeSize(type: Type): number {
        return this.typeLayout(type).size;
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
            case ExprNodeType.GroupedExpr:
                return this.constEval(node.childForFieldName('expr'));
            case ExprNodeType.NameExpr:
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
            case ExprNodeType.LiteralExpr:
                switch (node.firstChild!.type) {
                    case LiteralNodeType.Number:
                        return parseInt(node.firstChild!.text);
                    case LiteralNodeType.Char:
                        return parseChar(node.firstChild!.text);
                    default:
                        reportInvalidConstExpr();
                        return;
                }
            case ExprNodeType.BinaryExpr:
                const left = this.constEval(node.childForFieldName('left'));
                const right = this.constEval(node.childForFieldName('right'));
                const op = node.childForFieldName('op')?.text;
                if (left === undefined || right === undefined || !op)
                    return;
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
            case ExprNodeType.UnaryExpr:
                const operand = this.constEval(node.childForFieldName('operand'));
                const uop = node.childForFieldName('op')?.text;
                if (operand === undefined || !uop)
                    return;
                switch (uop) {
                    case '-': return -operand;
                    case '~': return ~operand;
                    default:
                        reportInvalidConstExpr();
                        return;
                }
            case ExprNodeType.SizeofExpr:
                const type = this.typeEval(node.childForFieldName('type'));
                return this.typeSize(type);
            default:
                reportInvalidConstExpr();
                return;
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
            default:
                const unreachable: never = nodeType;
                throw new Error(`Unexpected node type: ${unreachable}`);
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
        const name = nameNode?.text ?? '';

        const sym: StructSym = {
            kind: SymKind.Struct,
            name,
            qualifiedName: name,
            origins: [this.createOrigin(node, nameNode)],
            fields: undefined,
        };

        this.addSymbol<StructSym>(nameNode, { ...sym });

        const bodyNode = node.childForFieldName('body');
        if (bodyNode) {
            sym.fields = [];
            this.enterScope(bodyNode);

            for (const fieldNode of stream(bodyNode.children).filter(n => n.type === 'struct_member')) {
                const fieldType = this.typeEval(fieldNode.childForFieldName('type'));

                const fieldNameNode = fieldNode.childForFieldName('name');
                const fieldName = fieldNameNode?.text;
                if (!fieldName)
                    continue;

                const fieldSymbol: StructFieldSym = {
                    kind: SymKind.StructField,
                    name: fieldName,
                    qualifiedName: `${sym.name}.${fieldName}`,
                    origins: [this.createOrigin(fieldNode, fieldNameNode)],
                    type: fieldType,
                };
                sym.fields.push(fieldSymbol);
                this.addSymbol(fieldNameNode, fieldSymbol);
            }

            this.exitScope();
        }

        this.addSymbol(nameNode, sym);
    }

    private elabEnum(node: SyntaxNode) {
        const body = node.childForFieldName('body');
        if (!body)
            return;

        let nextValue: number = 0;
        for (const memberNode of stream(body.children).filter(n => n.type === 'enum_member')) {
            const memberNameNode = memberNode.childForFieldName('name');
            const memberName = memberNameNode?.text ?? '';
            const valueNode = memberNode.childForFieldName('value');
            const value = valueNode ? this.constEval(valueNode) : nextValue;

            this.addSymbol<ConstSym>(memberNameNode, {
                kind: SymKind.Const,
                name: memberName,
                qualifiedName: memberName,
                origins: [this.createOrigin(memberNode, memberNameNode)],
                value,
            });

            nextValue = (value ?? nextValue) + 1;
        }
    }

    private elabFunc(node: SyntaxNode) {
        const nameNode = node?.childForFieldName('name');
        const name = nameNode?.text ?? '';

        const paramNodes = node.childrenForFieldName('params');
        const params = stream(paramNodes)
            .filter(n => n.type === 'param_decl')
            .map<FuncParamSym>((paramNode, index) => {
                const paramType = this.typeEval(paramNode.childForFieldName('type'));

                const paramNameNode = paramNode.childForFieldName('name');
                const paramName = paramNameNode?.text ?? '';

                const paramQualifiedName = `${name}.${index}`;

                return {
                    kind: SymKind.FuncParam,
                    name: paramName,
                    qualifiedName: paramQualifiedName,
                    origins: [this.createOrigin(paramNode, paramNameNode)],
                    type: paramType,
                };
            })
            .toArray();

        const isVariadic = !!paramNodes.some(child => child.type === 'variadic_param');

        const returnTypeNode = node.childForFieldName('return_type');
        const returnType: Type = returnTypeNode ? this.typeEval(returnTypeNode) : { kind: 'void' };

        const bodyNode = node.childForFieldName('body');

        const unmergedSym: FuncSym = {
            kind: SymKind.Func,
            name,
            qualifiedName: name,
            origins: [this.createOrigin(node, nameNode)],
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

    private elabGlobal(node: SyntaxNode) {
        const nameNode = node?.childForFieldName('name');
        const name = nameNode?.text ?? '';

        const isExtern = !!node.children.find(n => n.type === 'extern');
        const type = this.typeEval(node.childForFieldName('type'));

        this.addSymbol<GlobalSym>(nameNode, {
            kind: SymKind.Global,
            name,
            qualifiedName: name,
            origins: [this.createOrigin(node, nameNode)],
            isDefined: !isExtern,
            type,
        });
    }

    private elabConst(node: SyntaxNode) {
        const nameNode = node?.childForFieldName('name');
        const name = nameNode?.text ?? '';

        const value = this.constEval(node.childForFieldName('value'));

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
        const name = nameNode?.text ?? '';

        const typeNode = node.childForFieldName('type');
        const initNode = node.childForFieldName('value');

        const declaredType = typeNode ? this.typeEval(typeNode) : undefined;

        const inferedType = initNode ? this.elabExprInfer(initNode) : undefined;

        if (declaredType && inferedType) {
            this.checkType(node, declaredType);
        }
        let type = declaredType ?? inferedType;

        if (!type) {
            this.reportError(node, `Missing type in local declaration.`);
            type ??= mkErrorType();
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
        const returnType = this.currentFunc!.returnType;
        const valueNode = node.childForFieldName('value');

        if (valueNode) {
            this.elabExpr(valueNode, returnType);
        } else if (returnType.kind !== 'void') {
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
        this.elabExpr(node, { kind: 'bool' });
        return { kind: 'bool' };
    }

    private elabExprInt(node: SyntaxNode | Nullish, expectedType?: Type): Type {
        if (!node)
            return mkErrorType();

        assert(!expectedType || expectedType.kind === 'int');

        const type = this.elabExprInfer(node);
        if (type.kind !== 'int') {
            if (type.kind !== 'error') {
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
                    return this.elabExprInfer(node.childForFieldName('expr'));
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
                default:
                    const unreachable: never = nodeType;
                    throw new Error(`Unexpected node type: ${unreachable} `);
            }
        });
    }

    private elabNameExpr(nameExpr: SyntaxNode): Type {
        const nameNode = nameExpr.firstChild!;
        const sym = this.resolveName(nameNode);
        if (!sym) {
            return mkErrorType();
        }

        switch (sym.kind) {
            case SymKind.Const:
                return { kind: 'int', size: 64 };
            case SymKind.Global:
            case SymKind.Local:
            case SymKind.FuncParam:
                return sym.type;
            case SymKind.Struct:
            case SymKind.Func:
            case SymKind.StructField:
                return mkErrorType();
            default:
                const unreachable: never = sym;
                throw new Error(`Unreachable: ${unreachable} `);
        }
    }

    private elabSizeofExpr(node: SyntaxNode): Type {
        const typeNode = node.childForFieldName('type');
        this.typeEval(typeNode);
        return { kind: 'int', size: 64 };
    }

    private elabLiteralExpr(node: SyntaxNode): Type {
        const nodeType = (node.firstChild!).type as LiteralNodeType;
        switch (nodeType) {
            case LiteralNodeType.Bool:
                return { kind: 'bool' };
            case LiteralNodeType.Number:
                return { kind: 'int', size: 64 };
            case LiteralNodeType.Char:
                return { kind: 'int', size: 8 };
            case LiteralNodeType.String:
                return { kind: 'pointer', elementType: { kind: 'int', size: 8 } };
            case LiteralNodeType.Null:
                return { kind: 'pointer', elementType: { kind: 'void' } };
            default:
                const unreachable: never = nodeType;
                throw new Error(`Unexpected literal type: ${unreachable} `);
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
                return { kind: 'pointer', elementType: this.elabExprInfer(operandNode) };
            }
            case '*':
            {
                const operandType = this.elabExprInfer(operandNode);
                if (operandType?.kind !== 'pointer') {
                    if (operandNode && operandType.kind !== 'error') {
                        this.reportError(operandNode, `Expected pointer type.`);
                    }
                    return mkErrorType();
                }
                return operandType.elementType;
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
                    this.reportError(leftNode ?? node, `L - value expected.`);
                }
                const leftType = op !== '='
                    ? this.elabExprInt(leftNode)
                    : this.elabExprInfer(leftNode);

                const rightType = this.elabExprInfer(rightNode);
                if (rightNode) {
                    this.checkType(rightNode, leftType);
                }

                if (!isScalarType(leftType)) {
                    this.reportError(leftNode ?? node, `Expected scalar type.`);
                }
                return { kind: 'void' };
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
                const leftType = this.elabExprInt(node.childForFieldName('left'));
                const rightType = this.elabExprInt(node.childForFieldName('right'));
                return this.unifyTypes(node, leftType, rightType);
            }
            case '==':
            case '!=':
            case '<':
            case '<=':
            case '>':
            case '>=':
            {
                const leftType = this.elabExprInfer(node.childForFieldName('left'));
                const rightType = this.elabExprInfer(node.childForFieldName('right'));
                const cmpType = this.unifyTypes(node, leftType, rightType);
                if (cmpType.kind === 'error' && !isScalarType(cmpType)) {
                    this.reportError(node, `${prettyType(cmpType)} is not comparable.`);
                }
                return { kind: 'bool' };
            }
            case '&&':
            case '||':
            {
                this.elabExprBool(node.childForFieldName('left'));
                this.elabExprBool(node.childForFieldName('right'));
                return { kind: 'bool' };
            }
            default:
                return mkErrorType();
        }
    }

    private elabTernaryExpr(node: SyntaxNode): Type {
        this.elabExprBool(node.childForFieldName('cond'));
        const thenType = this.elabExprInfer(node.childForFieldName('then'));
        const elseType = this.elabExprInfer(node.childForFieldName('else'));
        return this.unifyTypes(node, thenType, elseType);
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
        const indexeeNode = node.childForFieldName('indexee');
        const indexeeType = this.elabExprInfer(indexeeNode);
        if (indexeeType.kind !== 'array' && indexeeType.kind !== 'pointer') {
            if (indexeeType.kind !== 'error') {
                this.reportError(indexeeNode ?? node, `Expression is not indexable.`);
            }
            return mkErrorType();
        }
        this.elabExprInt(node.childForFieldName('index'));
        return indexeeType.elementType;
    }

    private elabField(node: SyntaxNode): StructFieldSym | undefined {
        let leftType = this.elabExprInfer(node.childForFieldName('left'));
        if (leftType.kind === 'pointer') {
            leftType = leftType.elementType;
        }

        if (leftType.kind !== 'struct') {
            if (leftType.kind !== 'error') {
                this.reportError(node, `Expected struct type.`);
            }
            return undefined;
        }

        const sym = this.symbols.get(leftType.qualifiedName);
        assert(sym?.kind === SymKind.Struct);

        const nameNode = node.childForFieldName('name');
        if (!nameNode) {
            return;
        }
        const fieldName = nameNode.text;

        const field = sym.fields?.find(f => f.name === fieldName);
        if (!field) {
            this.reportError(node, `Unknown field '${fieldName}'.`);
            return undefined;
        }
        this.recordNameResolution(field, nameNode);
        return field;
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

        if (!isScalarType(castType) || !isScalarType(exprType)) {
            this.reportError(node, `Invalid cast type.`);
        }

        return castType;
    }
}

//================================================================================
//== Utility functions

function getName(node: SyntaxNode): string | undefined {
    const nameNode = node.childForFieldName('name');
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
            return isLvalue(node.childForFieldName('expr'));
        case ExprNodeType.FieldExpr:
            return isLvalue(node.childForFieldName('expr'));
        default:
            return false;
    }
}

function mkErrorType(): Type {
    return { kind: 'error' };
}
