import assert from 'assert';
import { IncludeResolver } from '../services/IncludeResolver';
import { ParsingService } from '../services/parsingService';
import { SyntaxNode, Tree } from '../syntax';
import {
    ErrorNodeType,
    ExprNodeType,
    ExprNodeTypes,
    isArgNode,
    isExprNode,
    isStmtNode,
    isTopLevelNode,
    LiteralNodeType,
    LiteralNodeTypes,
    NodeTypes,
    StmtNodeType,
    StmtNodeTypes,
    TopLevelNodeType,
    TopLevelNodeTypes,
    TypeNodeType,
    TypeNodeTypes,
} from '../syntax/nodeTypes';
import { Nullish, PointRange } from '../utils';
import { stream } from '../utils/stream';
import { Scope } from './scope';
import {
    ConstSym,
    FuncParamSym,
    FuncSym,
    GlobalSym,
    isDefined,
    LocalSym,
    Origin,
    StructFieldSym,
    StructSym,
    Sym,
    SymKind,
} from './sym';
import {
    isScalarType,
    isValidReturnType,
    mkArrayType,
    mkBoolType,
    mkErrorType,
    mkIntType,
    mkNeverType,
    mkPointerType,
    mkStructType,
    mkVoidType,
    prettyType,
    primitiveTypes,
    tryUnifyTypes,
    Type,
    typeEq,
    TypeKind,
    typeLe,
} from './type';
import { TypeLayout, typeLayout } from './typeLayout';

export type ErrorLocation = {
    file: string;
    range: PointRange;
};

export type Severity
    = 'error'
    | 'warning'
    | 'info'
    | 'hint';

export type ElaborationDiag = {
    severity: Severity;
    message: string;
    location: ErrorLocation;
    unnecessary?: boolean;
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
    diagnostics: ElaborationDiag[];
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

    private diagnostics: ElaborationDiag[] = [];

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
            diagnostics: this.diagnostics,
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

    private lookupExistingSymbol(name: string) {
        const qname = this.scope.get(name);
        if (!qname)
            return;
        return this.symbols.get(qname);
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

    private addSym(sym: Sym) {
        this.scope.add(sym.name, sym.qualifiedName);
        this.symbols.set(sym.qualifiedName, sym);
        const nameNode = sym.origins[0].nameNode;
        if (nameNode) {
            this.recordNameIntroduction(sym, nameNode);
        }
    }

    private declareStructSym(declNode: SyntaxNode, nameNode: SyntaxNode | Nullish, isDefinition: boolean): StructSym {
        if (!nameNode) {
            return {
                kind: SymKind.Struct,
                name: '',
                qualifiedName: '',
                origins: [],
                base: undefined,
                fields: undefined,
                isDefined: false,
            };
        }

        const existing = this.lookupExistingSymbol(nameNode.text);
        if (existing) {
            if (existing.kind !== SymKind.Struct) {
                this.reportError(nameNode, `Another symbol with the same name already exists.`);
            } else if (isDefined(existing) && isDefinition) {
                this.reportError(nameNode, `Redefinition of '${existing.name}'.`);
            } else {
                existing.origins.push(this.createOrigin(declNode, nameNode, !isDefinition));
                return existing;
            }
        }
        const sym: StructSym = {
            kind: SymKind.Struct,
            name: nameNode.text,
            qualifiedName: 'struct:' + nameNode.text,
            origins: [this.createOrigin(declNode, nameNode, !isDefinition)],
            base: undefined,
            fields: undefined,
            isDefined: false,
        };
        if (!existing) {
            this.addSym(sym);
        }
        return sym;
    }

    private defineStructFieldSym(declNode: SyntaxNode, nameNode: SyntaxNode, type: Type, structSym: StructSym): StructFieldSym {
        const existing = this.lookupExistingSymbol(nameNode.text);
        if (existing) {
            if (existing.kind !== SymKind.StructField) {
                this.reportError(nameNode, `Another symbol with the same name already exists.`);
            } else {
                this.reportError(nameNode, `Redefinition of '${existing.name}'.`);
            }
        }
        const sym: StructFieldSym = {
            kind: SymKind.StructField,
            name: nameNode.text,
            qualifiedName: `${structSym.name}.${nameNode.text}`,
            origins: [this.createOrigin(declNode, nameNode)],
            type,
        };
        if (!existing) {
            this.addSym(sym);
        }
        return sym;
    }

    private declareFuncSym(declNode: SyntaxNode, nameNode: SyntaxNode | Nullish, params: FuncParamSym[], returnType: Type, isVariadic: boolean, isDefinition: boolean): FuncSym {
        if (!nameNode) {
            return {
                kind: SymKind.Func,
                name: '',
                qualifiedName: '',
                origins: [],
                params,
                returnType,
                isVariadic,
                isDefined: false,
            };
        }

        const existing = this.lookupExistingSymbol(nameNode.text);
        if (existing) {
            if (existing.kind !== SymKind.Func) {
                this.reportError(nameNode, `Another symbol with the same name already exists.`);
            } else if (!paramsLooseEq(existing.params, params) || !typeLooseEq(existing.returnType, returnType) || existing.isVariadic !== isVariadic) {
                this.reportError(nameNode, `Redefinition of '${existing.name}' with different signature.`);
            } else if (isDefined(existing) && isDefinition) {
                this.reportError(nameNode, `Redefinition of '${existing.name}'.`);
            } else {
                existing.origins.push(this.createOrigin(declNode, nameNode, !isDefinition));
                return existing;
            }
        }
        const sym: FuncSym = {
            kind: SymKind.Func,
            name: nameNode.text,
            qualifiedName: 'func:' + nameNode.text,
            origins: [this.createOrigin(declNode, nameNode, !isDefinition)],
            params,
            returnType,
            isVariadic,
            isDefined: false,
        };
        if (!existing) {
            this.addSym(sym);
        }
        return sym;
    }

    private defineFuncParamSym(declNode: SyntaxNode, nameNode: SyntaxNode | Nullish, funcName: string, paramIndex: number, type: Type): FuncParamSym {
        if (!nameNode) {
            return {
                kind: SymKind.FuncParam,
                name: '',
                qualifiedName: '',
                origins: [],
                type,
            };
        }

        const existing = this.lookupExistingSymbol(nameNode.text);
        if (existing) {
            if (existing.kind !== SymKind.FuncParam) {
                this.reportError(nameNode, `Another symbol with the same name already exists.`);
            } else {
                this.reportError(nameNode, `Redefinition of '${existing.name}'.`);
            }
        }

        const sym: FuncParamSym = {
            kind: SymKind.FuncParam,
            name: nameNode.text,
            qualifiedName: `func:${funcName}.param:${paramIndex}`,
            origins: [this.createOrigin(declNode, nameNode)],
            type,
        };

        if (!existing) {
            this.addSym(sym);
        }
        return sym;
    }

    private declareGlobalSym(declNode: SyntaxNode, nameNode: SyntaxNode | Nullish, type: Type, isDefinition: boolean): GlobalSym {
        if (!nameNode) {
            return {
                kind: SymKind.Global,
                name: '',
                qualifiedName: '',
                origins: [],
                isDefined: false,
                type,
            };
        }

        if (!nameNode) {
            return {
                kind: SymKind.Global,
                name: '',
                qualifiedName: '',
                origins: [],
                isDefined: false,
                type,
            };
        }

        const existing = this.lookupExistingSymbol(nameNode.text);
        if (existing) {
            if (existing.kind !== SymKind.Global) {
                this.reportError(nameNode, `Another symbol with the same name already exists.`);
            } else if (!typeLooseEq(existing.type, type)) {
                this.reportError(nameNode, `Redefinition of '${existing.name}' with different type.`);
            } else if (isDefined(existing) && isDefinition) {
                this.reportError(nameNode, `Redefinition of '${existing.name}'.`);
            } else {
                existing.origins.push(this.createOrigin(declNode, nameNode, !isDefinition));
                return existing;
            }
        }
        const sym: GlobalSym = {
            kind: SymKind.Global,
            name: nameNode.text,
            qualifiedName: 'global:' + nameNode.text,
            origins: [this.createOrigin(declNode, nameNode, !isDefinition)],
            isDefined: false,
            type,
        };

        if (!existing) {
            this.addSym(sym);
        }
        return sym;
    }

    private defineConstSym(declNode: SyntaxNode, nameNode: SyntaxNode | Nullish, value: number | undefined): ConstSym {
        if (!nameNode) {
            return {
                kind: SymKind.Const,
                name: '',
                qualifiedName: '',
                origins: [],
                value: undefined,
            };
        }

        const existing = this.lookupExistingSymbol(nameNode.text);
        if (existing) {
            if (existing.kind !== SymKind.Const) {
                this.reportError(nameNode, `Another symbol with the same name already exists.`);
            } else {
                this.reportError(nameNode, `Redefinition of '${existing.name}'.`);
            }
        }
        const sym: ConstSym = {
            kind: SymKind.Const,
            name: nameNode.text,
            qualifiedName: 'const:' + nameNode.text,
            origins: [this.createOrigin(declNode, nameNode)],
            value,
        };

        if (!existing) {
            this.addSym(sym);
        }
        return sym;
    }

    private defineLocalSym(declNode: SyntaxNode, nameNode: SyntaxNode | Nullish, type: Type): LocalSym {
        if (!nameNode) {
            return {
                kind: SymKind.Local,
                name: '',
                qualifiedName: '',
                origins: [],
                type,
            };
        }

        const existing = this.lookupExistingSymbol(nameNode.text);
        if (existing) {
            if (existing.kind !== SymKind.Local) {
                this.reportError(nameNode, `Another symbol with the same name already exists.`);
            } else {
                this.reportError(nameNode, `Redefinition of '${existing.name}'.`);
            }
        }
        const sym: LocalSym = {
            kind: SymKind.Local,
            name: nameNode.text,
            qualifiedName: `${this.currentFunc!.name}.local:${this.nextLocalIndex++}`,
            origins: [this.createOrigin(declNode, nameNode)],
            type,
        };

        if (!existing) {
            this.addSym(sym);
        }
        return sym;
    }

    //==============================================================================
    //== Types

    private typeEval(typeNode: SyntaxNode | Nullish): Type {
        if (!typeNode)
            return mkErrorType();

        return this.trackTyping(typeNode, () => {
            const nodeType = typeNode.type as TypeNodeType | ErrorNodeType;
            switch (nodeType) {
                case TypeNodeTypes.GroupedType: {
                    const nestedTypeNode = typeNode.childForFieldName('type');
                    return this.typeEval(nestedTypeNode);
                }
                case TypeNodeTypes.NameType: {
                    const nameNode = typeNode.firstChild!;
                    const name = nameNode.text;

                    if (name in primitiveTypes) {
                        return primitiveTypes[name]!;
                    } else {
                        const sym = this.resolveName(nameNode);
                        if (!sym) {
                            return mkErrorType();
                        }
                        if (sym.kind !== SymKind.Struct) {
                            this.reportError(typeNode, `'${sym.name}' is not a struct.`);
                            return mkErrorType();
                        }
                        return mkStructType(sym);
                    }
                }
                case TypeNodeTypes.PointerType: {
                    const pointeeNode = typeNode.childForFieldName('pointee');
                    return mkPointerType(this.typeEval(pointeeNode));
                }
                case TypeNodeTypes.ArrayType: {
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
                case TypeNodeTypes.NeverType:
                    return mkNeverType();
                case NodeTypes.Error:
                    return mkErrorType();
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
            case ExprNodeTypes.GroupedExpr: {
                const nestedNode = node.childForFieldName('expr');
                return this.constEval(nestedNode);
            }
            case ExprNodeTypes.NameExpr: {
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
            case ExprNodeTypes.LiteralExpr: {
                switch (node.firstChild!.type) {
                    case LiteralNodeTypes.Number:
                        return parseInt(node.firstChild!.text);
                    case LiteralNodeTypes.Char:
                        return parseChar(node.firstChild!.text);
                    default:
                        reportInvalidConstExpr();
                        return;
                }
            }
            case ExprNodeTypes.BinaryExpr: {
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
            case ExprNodeTypes.UnaryExpr: {
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
            case ExprNodeTypes.SizeofExpr: {
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
        const nodeType = node.type as TopLevelNodeType | ErrorNodeType;
        switch (nodeType) {
            case TopLevelNodeTypes.Include:
                this.elabInclude(node);
                break;
            case TopLevelNodeTypes.Struct:
                this.elabStruct(node);
                break;
            case TopLevelNodeTypes.Func:
                this.elabFunc(node);
                break;
            case TopLevelNodeTypes.Global:
                this.elabGlobal(node);
                break;
            case TopLevelNodeTypes.Const:
                this.elabConst(node);
                break;
            case TopLevelNodeTypes.Enum:
                this.elabEnum(node);
                break;
            case NodeTypes.Error:
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
        const baseTypeNode = node.childForFieldName('base');
        const bodyNode = node.childForFieldName('body');

        const sym = this.declareStructSym(node, nameNode, !!bodyNode);
        this.enterScope(node);

        if (baseTypeNode) {
            this.elabStructBase(baseTypeNode, sym);
        }

        if (bodyNode) {
            sym.fields ??= [];

            // Add base fields to the scope
            for (const field of sym.fields ?? []) {
                this.addSym(field);
            }

            for (const fieldNode of stream(bodyNode.children).filter(n => n.type === 'struct_member')) {
                this.elabStructField(fieldNode, sym);
            }

            if (sym.fields.length === 0) {
                this.reportError(bodyNode, `Struct must have at least one field.`);
            }
        }

        if (sym.fields) {
            sym.isDefined = true;
        }

        this.exitScope();
    }

    private elabStructBase(
        baseTypeNode: SyntaxNode,
        structSym: StructSym,
    ): StructSym | undefined {
        const baseType = this.typeEval(baseTypeNode);
        if (baseType.kind === TypeKind.Err) {
            return;
        }
        if (baseType.kind !== TypeKind.Struct) {
            this.reportError(baseTypeNode!, `Base type must be a struct.`);
            return;
        }
        if (baseType.sym.qualifiedName === structSym.qualifiedName) {
            this.reportError(baseTypeNode!, `Struct cannot inherit from itself.`);
            return;
        }
        if (this.isUnsizedType(baseType)) {
            this.reportError(baseTypeNode!, `Base type has incomplete type.`);
            return;
        }
        const baseSym = this.symbols.get(baseType.sym.qualifiedName);
        assert(baseSym?.kind === SymKind.Struct);
        structSym.base = baseSym;
        structSym.fields = [...baseSym?.fields ?? []];
    }

    private elabStructField(fieldNode: SyntaxNode, structSym: StructSym) {
        const nameNode = fieldNode.childForFieldName('name');
        const typeNode = fieldNode.childForFieldName('type');

        const fieldType = this.typeEval(typeNode);

        const fieldName = nameNode?.text;
        if (!fieldName)
            return;

        const fieldSym = this.defineStructFieldSym(fieldNode, nameNode, fieldType, structSym);
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

        const value = valueNode ? this.constEval(valueNode) : nextValue;
        this.defineConstSym(memberNode, nameNode, value);
        return (value ?? nextValue) + 1;
    }

    private elabFunc(node: SyntaxNode) {
        const nameNode = node?.childForFieldName('name');
        const paramNodes = node.childrenForFieldName('params');
        const bodyNode = node.childForFieldName('body');

        this.enterScope(node);

        const name = nameNode?.text ?? '';
        const params = stream(paramNodes)
            .filter(n => n.type === 'param_decl')
            .map<FuncParamSym>((paramNode, index) => this.elabFuncParam(paramNode, name, index))
            .toArray();

        this.exitScope();

        const isVariadic = !!paramNodes.some(child => child.type === 'variadic_param');

        const returnTypeNode = node.childForFieldName('return_type');
        const returnType: Type = returnTypeNode ? this.typeEval(returnTypeNode) : mkVoidType();

        if (isInvalidReturnType(returnType)) {
            this.reportError(returnTypeNode!, `Function return type must be void or of scalar type.`);
        }

        const sym = this.declareFuncSym(node, nameNode, params, returnType, isVariadic, !!bodyNode);

        this.enterScope(node);

        for (const param of params) {
            this.addSym(param);
        }

        this.currentFunc = sym;
        this.nextLocalIndex = 0;

        if (bodyNode) {
            this.elabBlockStmt(bodyNode);
        }

        this.currentFunc = undefined;
        this.nextLocalIndex = undefined!;

        this.exitScope();

        sym.isDefined = !!bodyNode;
    }

    private elabFuncParam(paramNode: SyntaxNode, funcName: string, paramIndex: number): FuncParamSym {
        const nameNode = paramNode.childForFieldName('name');
        const typeNode = paramNode.childForFieldName('type');

        const type = this.typeEval(typeNode);
        if (isNonScalarType(type)) {
            this.reportError(paramNode, `Function parameter must be of scalar type.`);
        }

        // TODO: funcName may be empty
        return this.defineFuncParamSym(paramNode, nameNode, funcName, paramIndex, type);
    }

    private elabGlobal(node: SyntaxNode) {
        const externNode = node.children.find(n => n.type === 'extern');
        const nameNode = node?.childForFieldName('name');
        const typeNode = node.childForFieldName('type');

        const isExtern = !!externNode;

        const type = this.typeEval(typeNode);
        if (this.isUnsizedType(type)) {
            this.reportError(node, `Variable must have a known size.`);
        }

        const sym = this.declareGlobalSym(node, nameNode, type, !isExtern);
        sym.isDefined = !isExtern;
    }

    private elabConst(node: SyntaxNode) {
        const nameNode = node?.childForFieldName('name');
        const valueNode = node.childForFieldName('value');

        const name = nameNode?.text ?? '';
        const value = this.constEval(valueNode);

        this.defineConstSym(node, nameNode, value);
    }

    //==============================================================================
    //== Statements

    private elabStmt(node: SyntaxNode | Nullish) {
        if (!node)
            return;

        const nodeType = node.type as StmtNodeType | ErrorNodeType;
        switch (nodeType) {
            case StmtNodeTypes.BlockStmt:
                this.elabBlockStmt(node);
                break;
            case StmtNodeTypes.LocalDecl:
                this.elabLocalDecl(node);
                break;
            case StmtNodeTypes.IfStmt:
                this.elabIfStmt(node);
                break;
            case StmtNodeTypes.WhileStmt:
                this.elabWhileStmt(node);
                break;
            case StmtNodeTypes.ForStmt:
                this.elabForStmt(node);
                break;
            case StmtNodeTypes.ReturnStmt:
                this.elabReturnStmt(node);
                break;
            case StmtNodeTypes.BreakStmt:
            case StmtNodeTypes.ContinueStmt:
                break;
            case StmtNodeTypes.ExprStmt:
                this.elabExprStmt(node);
                break;
            case NodeTypes.Error:
                break;
            default: {
                const unreachable: never = nodeType;
                throw new Error(`Unexpected node type: ${unreachable}`);
            }
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

        this.defineLocalSym(node, nameNode, type);
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

    private elabForStmt(node: SyntaxNode) {
        const initNode = node.childForFieldName('init');
        const condNode = node.childForFieldName('cond');
        const stepNode = node.childForFieldName('step');
        const bodyNode = node.childForFieldName('body');

        this.enterScope(node);
        this.elabStmt(initNode);
        this.elabExprBool(condNode);
        this.elabExprInfer(stepNode);
        this.elabStmtWithScope(bodyNode);
        this.exitScope();
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
            const nodeType = node.type as ExprNodeType | ErrorNodeType;
            switch (nodeType) {
                case ExprNodeTypes.GroupedExpr:
                    return this.elabGroupedExpr(node);
                case ExprNodeTypes.NameExpr:
                    return this.elabNameExpr(node);
                case ExprNodeTypes.SizeofExpr:
                    return this.elabSizeofExpr(node);
                case ExprNodeTypes.LiteralExpr:
                    return this.elabLiteralExpr(node);
                case ExprNodeTypes.ArrayExpr:
                    return this.elabArrayExpr(node);
                case ExprNodeTypes.BinaryExpr:
                    return this.elabBinaryExpr(node);
                case ExprNodeTypes.TernaryExpr:
                    return this.elabTernaryExpr(node);
                case ExprNodeTypes.UnaryExpr:
                    return this.elabUnaryExpr(node);
                case ExprNodeTypes.CallExpr:
                    return this.elabCallExpr(node);
                case ExprNodeTypes.IndexExpr:
                    return this.elabIndexExpr(node);
                case ExprNodeTypes.FieldExpr:
                    return this.elabFieldExpr(node);
                case ExprNodeTypes.CastExpr:
                    return this.elabCastExpr(node);
                case NodeTypes.Error:
                    return mkErrorType();
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
                return mkIntType(32);
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
            case LiteralNodeTypes.Bool:
                return mkBoolType();
            case LiteralNodeTypes.Number:
                return mkIntType(64);
            case LiteralNodeTypes.Char:
                return mkIntType(8);
            case LiteralNodeTypes.String:
                return mkPointerType(mkIntType(8));
            case LiteralNodeTypes.Null:
                return mkPointerType(mkVoidType());
            default: {
                const unreachable: never = nodeType;
                throw new Error(`Unexpected literal type: ${unreachable} `);
            }
        }
    }

    private elabArrayExpr(node: SyntaxNode): Type {
        const elemNodes = node.children.filter(isExprNode);
        if (elemNodes.length === 0) {
            this.reportError(node, `Empty array literal.`);
            return mkErrorType();
        }

        const elemType = this.elabExprInfer(elemNodes[0]);
        for (let i = 1; i < elemNodes.length; i++) {
            this.elabExpr(elemNodes[i], elemType);
        }

        return mkArrayType(elemType, elemNodes.length);
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
            case '|=':
            case '&=':
            case '^=':
            case '<<=':
            case '>>=':
            case '+=':
            case '-=':
            case '*=':
            case '/=':
            case '%=':
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
        const argListNode = node.childForFieldName('args');
        assert(argListNode);

        if (!calleeNode) {
            return this.elabCallExprUnknown(node);
        }
        if (calleeNode.type !== ExprNodeTypes.NameExpr) {
            this.reportError(calleeNode, `Function or struct name expected.`);
            return this.elabCallExprUnknown(node);
        }

        const calleeNameNode = calleeNode.firstChild!;
        const calleeName = calleeNameNode.text;

        const sym = this.resolveName(calleeNameNode);
        if (!sym) {
            return this.elabCallExprUnknown(node);
        }
        if (sym.kind == SymKind.Func) {
            return this.elabCallExprPart2(node, sym.params, sym.isVariadic, sym.returnType);
        } else if (sym.kind === SymKind.Struct && sym.fields) {
            return this.elabCallExprPart2(node, sym.fields, false, mkStructType(sym));
        } else {
            this.reportError(calleeNode, `'${calleeName}' is not a function or struct.`);
            return this.elabCallExprUnknown(node);
        }
    }

    elabCallExprPart2(
        node: SyntaxNode,
        params: (FuncParamSym | StructFieldSym)[],
        isVariadic: boolean,
        returnType: Type,
    ): Type {
        const argListNode = node.childForFieldName('args')!;

        const argNodes = argListNode.children.filter(x => isArgNode(x));

        if (argNodes.length < params.length) {
            this.reportError(argListNode, `Too few arguments provided (${argNodes.length} < ${params.length}).`);
        } else if (argNodes.length > params.length && !isVariadic) {
            this.reportError(argListNode, `Too many arguments provided (${argNodes.length} > ${params.length}).`);
        }
        for (let i = 0; i < argNodes.length; i++) {
            const argNode = argNodes[i];
            const argLabelNode = argNode.childForFieldName('label');
            const argValueNode = argNode.childForFieldName('value');
            if (i < params.length) {
                if (argLabelNode) {
                    const paramName = params[i].name;
                    if (argLabelNode.text !== paramName) {
                        this.reportError(argLabelNode, `Expected label '${paramName}'.`);
                    } else {
                        this.recordNameResolution(params[i], argLabelNode);
                    }
                }
                if (argValueNode) {
                    this.elabExpr(argValueNode, params[i].type);
                }
            } else if (isVariadic) {
                if (argLabelNode) {
                    this.reportError(argLabelNode, `Variadic argument cannot have a label.`);
                }
                if (argValueNode) {
                    const argType = this.elabExprInfer(argValueNode);
                    if (isNonScalarType(argType)) {
                        this.reportError(node, `Variadic argument must be scalar type.`);
                    }
                }
            }
        }

        return returnType;
    }

    private elabCallExprUnknown(node: SyntaxNode): Type {
        const argListNode = node.childForFieldName('args')!;

        for (const argNode of argListNode.children.filter(x => isArgNode(x) && x.childForFieldName('value'))) {
            const valueNode = argNode.childForFieldName('value')!;
            this.elabExprInfer(valueNode);
        }
        return mkErrorType();
    }

    private elabIndexExpr(node: SyntaxNode): Type {
        const indexeeNode = node.childForFieldName('indexee');
        const indexNode = node.childForFieldName('index');

        const indexeeType = this.elabExprInfer(indexeeNode);
        const _indexType = this.elabExprInt(indexNode);

        if (indexeeType.kind !== TypeKind.Arr && indexeeType.kind !== TypeKind.Ptr) {
            if (indexeeType.kind !== TypeKind.Err) {
                this.reportError(indexeeNode ?? node, `Expression is not indexable.`);
            }
            return mkErrorType();
        }

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
        return this.resolveStructField(leftType.sym.qualifiedName, nameNode);
    }

    private elabFieldExpr(node: SyntaxNode): Type {
        const field = this.elabField(node);
        return field?.type ?? mkErrorType();
    }

    private elabCastExpr(node: SyntaxNode): Type {
        const typeNode = node.childForFieldName('type');
        const keywordNode = node.children.find(n => n.type === 'as')!;
        const exprNode = node.childForFieldName('expr');

        const castType = this.typeEval(typeNode);
        const exprType = this.elabExprInfer(exprNode);

        if (isNonScalarType(castType) || isNonScalarType(exprType)) {
            this.reportError(node, `Invalid cast type.`);
        }
        if (typeEq(castType, exprType)) {
            this.reportWarning(keywordNode, `Redundant cast.`);
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

    private reportDiagnostic(node: SyntaxNode, severity: Severity, message: string) {
        this.diagnostics.push({
            severity,
            message,
            location: {
                file: this.path,
                range: node,
            },
        });
    }

    private reportError(node: SyntaxNode, message: string) {
        this.reportDiagnostic(node, 'error', message);
    }

    private reportWarning(node: SyntaxNode, message: string) {
        this.reportDiagnostic(node, 'warning', message);
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
        return type.kind !== TypeKind.Err
            && this.typeSize(type) === undefined;
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
        case ExprNodeTypes.NameExpr:
            return true;
        case ExprNodeTypes.IndexExpr:
            return isLvalue(node.childForFieldName('expr'));
        case ExprNodeTypes.FieldExpr:
            return isLvalue(node.childForFieldName('expr'));
        case ExprNodeTypes.UnaryExpr:
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
    return node.type === ExprNodeTypes.LiteralExpr
        && node.firstChild!.type === LiteralNodeTypes.Number;
}

function typeLooseEq(t1: Type, t2: Type): boolean {
    return t1.kind === TypeKind.Err || t2.kind === TypeKind.Err || typeEq(t1, t2);
}

function paramsLooseEq(p1: FuncParamSym[], p2: FuncParamSym[]): boolean {
    return stream(p1).zipLongest(p2).every(([a, b]) => a && b && typeLooseEq(a.type, b.type));
}
