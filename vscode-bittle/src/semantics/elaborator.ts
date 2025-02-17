import assert from 'assert';
import { IncludeResolver } from '../services/IncludeResolver';
import { ParsingService } from '../services/parsingService';
import { PointRange, SyntaxNode } from '../syntax';
import { AstNode, TokenNode } from '../syntax/ast';
import { ArrayExprNode, ArrayTypeNode, BinaryExprNode, BlockStmtNode, BoolLiteralNode, BreakStmtNode, CallExprNode, CastExprNode, CharLiteralNode, ConstDeclNode, ContinueStmtNode, DeclNode, EnumDeclNode, EnumMemberNode, ExprNode, ExprStmtNode, FieldExprNode, FieldNode, ForStmtNode, FuncDeclNode, FuncParamNode, GlobalDeclNode, GroupedExprNode, GroupedTypeNode, IfStmtNode, IncludeDeclNode, IndexExprNode, IntLiteralNode, LiteralExprNode, LocalDeclNode, NameExprNode, NameTypeNode, NeverTypeNode, NullLiteralNode, PointerTypeNode, RecordDeclNode, RecordExprNode, RestParamTypeNode, ReturnStmtNode, RootNode, SizeofExprNode, StmtNode, StringLiteralNode, TernaryExprNode, TypeNode, UnaryExprNode, WhileStmtNode, } from '../syntax/generated';
import { Nullish, unreachable } from '../utils';
import { stream } from '../utils/stream';
import { Scope } from './scope';
import { ConstSym, EnumSym, FuncParamSym, FuncSym, GlobalSym, isDefined, LocalSym, Origin, RecordFieldSym, RecordKind, RecordSym, Sym, SymKind, } from './sym';
import { isScalarType, isValidReturnType, mkArrayType, mkBoolType, mkEnumType, mkErrorType, mkIntType, mkNeverType, mkPointerType, mkRecordType, mkRestParamType, mkVoidType, prettyType, primitiveTypes, tryUnifyTypes, Type, typeConvertible, typeEq, typeImplicitlyConvertible, TypeKind, typeLayout, } from './type';

export type ErrorLocation = {
    file: string;
    range: PointRange;
};

export type Severity =
    | 'error'
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
    nodeSymMap: WeakMap<SyntaxNode, string[]>;
    nodeTypeMap: WeakMap<SyntaxNode, Type>;
    references: Map<string, SymReference[]>;
    diagnostics: ElaborationDiag[];
};

export class Elaborator {
    private rootNode: RootNode;

    private scope: Scope;

    // Symbol.qualifiedName -> Symbol
    private symbols: Map<string, Sym> = new Map();
    // Symbol.qualifiedName -> Reference[]
    private references: Map<string, SymReference[]> = new Map();

    // SyntaxNode -> Symbol.qualifiedName
    private nodeSymMap: WeakMap<SyntaxNode, string[]> = new WeakMap();
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
        this.rootNode = this.parsingService.parseAsAst(path);
        this.scope = new Scope(this.path, this.rootNode.syntax);
    }

    private run(): ElaboratorResult {
        this.elabRoot(this.rootNode);
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

    private enterScope(node: AstNode) {
        this.scope = new Scope(this.path, node.syntax, this.scope);
    }

    private exitScope() {
        if (!this.scope.parent)
            throw new Error(`Unreachable: exitScope`);
        this.scope = this.scope.parent;
    }

    private inOuterScope<T>(fn: () => T): T {
        const innerScope = this.scope;
        this.scope = this.scope.parent!;
        const result = fn();
        this.scope = innerScope;
        return result;
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

    private resolveRecordField(recordName: string, nameNode: SyntaxNode) {
        const sym = this.symbols.get(recordName);
        assert(sym?.kind === SymKind.Record);

        const fieldName = nameNode.text;
        const field = sym.fields.find(f => f.name === fieldName);
        if (!field) {
            this.reportError(nameNode, `Unknown field '${fieldName}'.`);
            return undefined;
        }

        this.recordNameResolution(field, nameNode);
        return field;
    }

    private recordNameIntroduction(sym: Sym, nameNode: SyntaxNode) {
        assert(nameNode.type === 'identifier');
        appendInWeakMap(this.nodeSymMap, nameNode, sym.qualifiedName);
    }

    private recordNameResolution(sym: Sym, nameNode: SyntaxNode) {
        assert(nameNode.type === 'identifier');
        appendInWeakMap(this.nodeSymMap, nameNode, sym.qualifiedName);

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

    private declareRecordSym(declNode: RecordDeclNode, nameNode: TokenNode | Nullish, isDefinition: boolean): RecordSym {
        const recordKind = declNode.structToken ? RecordKind.Struct : RecordKind.Union;

        if (!nameNode) {
            return {
                kind: SymKind.Record,
                recordKind,
                name: '',
                qualifiedName: '',
                origins: [],
                base: undefined,
                fields: [],
                isDefined: false,
            };
        }

        const existing = this.lookupExistingSymbol(nameNode.text);
        if (existing) {
            if (existing.kind !== SymKind.Record) {
                this.reportError(nameNode, `Another symbol with the same name already exists.`);
            } else if (isDefined(existing) && isDefinition) {
                this.reportError(nameNode, `Redefinition of '${existing.name}'.`);
            } else {
                this.recordNameIntroduction(existing, nameNode);
                existing.origins.push(this.createOrigin(declNode.syntax, nameNode, !isDefinition));
                return existing;
            }
        }
        const sym: RecordSym = {
            kind: SymKind.Record,
            recordKind,
            name: nameNode.text,
            qualifiedName: 'record:' + nameNode.text,
            origins: [this.createOrigin(declNode.syntax, nameNode, !isDefinition)],
            base: undefined,
            fields: [],
            isDefined: false,
        };
        if (!existing) {
            this.addSym(sym);
        }
        return sym;
    }

    private defineRecordFieldSym(declNode: FieldNode, nameNode: TokenNode, type: Type, recordSym: RecordSym): RecordFieldSym {
        const existing = this.lookupExistingSymbol(nameNode.text);
        if (existing) {
            if (existing.kind !== SymKind.RecordField) {
                this.reportError(nameNode, `Another symbol with the same name already exists.`);
            } else {
                this.reportError(nameNode, `Redefinition of '${existing.name}'.`);
            }
        }
        const sym: RecordFieldSym = {
            kind: SymKind.RecordField,
            name: nameNode.text,
            qualifiedName: `${recordSym.name}.${nameNode.text}`,
            origins: [this.createOrigin(declNode.syntax, nameNode)],
            type,
        };
        if (!existing) {
            this.addSym(sym);
        }
        return sym;
    }

    private defineEnumSym(declNode: EnumDeclNode, nameNode: TokenNode | Nullish): EnumSym | undefined {
        if (!nameNode) {
            return;
        }

        const existing = this.lookupExistingSymbol(nameNode.text);
        if (existing) {
            if (existing.kind !== SymKind.Enum) {
                this.reportError(nameNode, `Another symbol with the same name already exists.`);
            } else {
                this.reportError(nameNode, `Redefinition of '${existing.name}'.`);
            }
        }
        const sym: EnumSym = {
            kind: SymKind.Enum,
            name: nameNode.text,
            qualifiedName: 'enum:' + nameNode.text,
            origins: [this.createOrigin(declNode.syntax, nameNode)],
            size: 32,
        };
        if (!existing) {
            this.addSym(sym);
        }
        return sym;
    }

    private declareFuncSym(declNode: FuncDeclNode, nameNode: TokenNode | Nullish, params: FuncParamSym[], returnType: Type, isVariadic: boolean, isDefinition: boolean): FuncSym {
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
                this.recordNameIntroduction(existing, nameNode);
                existing.origins.push(this.createOrigin(declNode.syntax, nameNode, !isDefinition));
                return existing;
            }
        }
        const sym: FuncSym = {
            kind: SymKind.Func,
            name: nameNode.text,
            qualifiedName: 'func:' + nameNode.text,
            origins: [this.createOrigin(declNode.syntax, nameNode, !isDefinition)],
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

    private defineFuncParamSym(declNode: FuncParamNode, nameNode: TokenNode | Nullish, funcName: string, paramIndex: number, type: Type): FuncParamSym {
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
            origins: [this.createOrigin(declNode.syntax, nameNode)],
            type,
        };

        if (!existing) {
            this.addSym(sym);
        }
        return sym;
    }

    private declareGlobalSym(declNode: GlobalDeclNode, nameNode: TokenNode | Nullish, type: Type, isDefinition: boolean): GlobalSym {
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
                this.recordNameIntroduction(existing, nameNode);
                existing.origins.push(this.createOrigin(declNode.syntax, nameNode, !isDefinition));
                return existing;
            }
        }
        const sym: GlobalSym = {
            kind: SymKind.Global,
            name: nameNode.text,
            qualifiedName: 'global:' + nameNode.text,
            origins: [this.createOrigin(declNode.syntax, nameNode, !isDefinition)],
            isDefined: false,
            type,
        };

        if (!existing) {
            this.addSym(sym);
        }
        return sym;
    }

    private defineConstSym(declNode: ConstDeclNode | EnumMemberNode, nameNode: TokenNode | Nullish, type: Type, value: number | undefined): ConstSym {
        assert(isScalarType(type));

        if (!nameNode) {
            return {
                kind: SymKind.Const,
                name: '',
                qualifiedName: '',
                origins: [],
                value: undefined,
                type,
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
            origins: [this.createOrigin(declNode.syntax, nameNode)],
            type,
            value,
        };

        if (!existing) {
            this.addSym(sym);
        }
        return sym;
    }

    private defineLocalSym(declNode: LocalDeclNode | FuncParamNode, nameNode: TokenNode | Nullish, type: Type): LocalSym {
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
        const isConflictingRedefinition = existing && existing.kind !== SymKind.Local;
        if (isConflictingRedefinition) {
            this.reportError(nameNode, `Another symbol with the same name already exists.`);
        }

        const sym: LocalSym = {
            kind: SymKind.Local,
            name: nameNode.text,
            qualifiedName: `${this.currentFunc!.name}.local:${this.nextLocalIndex++}`,
            origins: [this.createOrigin(declNode.syntax, nameNode)],
            type,
        };

        if (!isConflictingRedefinition) {
            this.addSym(sym);
        }
        return sym;
    }

    //==============================================================================
    //== Types

    private typeEval(typeNode: TypeNode | Nullish): Type {
        if (!typeNode)
            return mkErrorType();

        return this.trackTyping(typeNode, () => {
            if (typeNode instanceof GroupedTypeNode) {
                const nestedTypeNode = typeNode.type;
                return this.typeEval(nestedTypeNode);
            } else if (typeNode instanceof NameTypeNode) {
                const nameNode = typeNode.identifierToken!;
                const name = nameNode.text;

                if (name in primitiveTypes) {
                    return primitiveTypes[name]!;
                } else {
                    const sym = this.resolveName(nameNode);
                    if (!sym) {
                        return mkErrorType();
                    }
                    if (sym.kind === SymKind.Record) {
                        return mkRecordType(sym);
                    } else if (sym.kind === SymKind.Enum) {
                        return mkEnumType(sym);
                    } else {
                        this.reportError(nameNode, `'${sym.name}' is not a type.`);
                        return mkErrorType();
                    }
                }
            } else if (typeNode instanceof PointerTypeNode) {
                return mkPointerType(this.typeEval(typeNode.pointee));
            } else if (typeNode instanceof ArrayTypeNode) {
                const elemType = this.typeEval(typeNode.type);
                if (this.isUnsizedType(elemType)) {
                    this.reportError(typeNode, `The element type of an array must have a known size.`);
                }

                let size = this.constEval(typeNode.size);
                if (size !== undefined && size <= 0) {
                    this.reportError(typeNode, `Array size must be positive.`);
                    size = undefined;
                }

                return mkArrayType(elemType, size);
            } else if (typeNode instanceof NeverTypeNode) {
                return mkNeverType();
            } else if (typeNode instanceof RestParamTypeNode) {
                return mkRestParamType();
            } else {
                unreachable(typeNode);
            }
        });
    }

    //==============================================================================
    //== Constants

    private constEval(node: ExprNode | Nullish): number | undefined {
        if (!node)
            return;

        const reportInvalidConstExpr = () => {
            this.reportError(node, `Invalid constant expression.`);
        };

        if (node instanceof GroupedExprNode) {
            const nestedNode = node.exprNode;
            return this.constEval(nestedNode);
        } else if (node instanceof NameExprNode) {
            const nameNode = node.identifierToken!;
            const sym = this.resolveName(nameNode);
            if (!sym) {
                return;
            }
            if (sym.kind !== SymKind.Const) {
                this.reportError(nameNode, `'${sym.name}' is not a constant.`);
                return;
            }
            return sym.value;
        } else if (node instanceof LiteralExprNode) {
            const literalNode = node.literalNode;
            if (literalNode instanceof IntLiteralNode) {
                return Number(literalNode.numberLiteralToken!.text);
            } else if (literalNode instanceof CharLiteralNode) {
                return parseChar(literalNode.charLiteralToken!.text);
            }
        } else if (node instanceof BinaryExprNode) {
            const left = this.constEval(node.left);
            const right = this.constEval(node.right);

            if (left === undefined || right === undefined || !node.op) {
                return;
            }
            switch (node.op.text) {
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
        } else if (node instanceof UnaryExprNode) {
            const operand = this.constEval(node.right);

            if (operand === undefined || !node.op) {
                return;
            }
            switch (node.op.text) {
                case '-': return -operand;
                case '~': return ~operand;
                default:
                    reportInvalidConstExpr();
                    return;
            }
        } else if (node instanceof SizeofExprNode) {
            const typeNode = node.type;
            const type = this.typeEval(typeNode);
            return typeLayout(type)?.size;
        } else {
            reportInvalidConstExpr();
            return;
        }
    }

    //==============================================================================
    //== Top-level

    private elabRoot(rootNode: RootNode) {
        for (const node of rootNode.declNodes) {
            this.elabTopLevelDecl(node);
        }
    }

    private elabTopLevelDecl(node: DeclNode) {
        if (node instanceof IncludeDeclNode) {
            this.elabInclude(node);
        } else if (node instanceof RecordDeclNode) {
            this.elabRecord(node);
        } else if (node instanceof FuncDeclNode) {
            this.elabFunc(node);
        } else if (node instanceof GlobalDeclNode) {
            this.elabGlobal(node);
        } else if (node instanceof ConstDeclNode) {
            this.elabConst(node);
        } else if (node instanceof EnumDeclNode) {
            this.elabEnum(node);
        } else {
            unreachable(node);
        }
    }

    private elabInclude(node: IncludeDeclNode) {
        if (!node.path)
            return;

        const path = this.includeResolver.resolveInclude(this.path, node.path);
        if (!path) {
            this.reportError(node, `Cannot resolve include.`);
            return;
        }

        const tree = this.parsingService.parseAsAst(path);

        const oldPath = this.path;
        this.path = path;
        this.elabRoot(tree);
        this.path = oldPath;
    }

    private elabRecord(node: RecordDeclNode) {
        const nameNode = node.name;
        const baseTypeNode = node.base;
        const bodyNode = node.body;

        const sym = this.declareRecordSym(node, nameNode, !!bodyNode);
        this.enterScope(node);

        if (baseTypeNode) {
            this.elabRecordBase(baseTypeNode, sym);
        }

        if (bodyNode) {
            // Add base fields to the scope
            for (const field of sym.fields) {
                this.addSym(field);
            }

            for (const fieldNode of bodyNode.fieldNodes) {
                this.elabRecordField(fieldNode, sym);
            }

            if (sym.fields.length === 0) {
                this.reportError(bodyNode, `Record must have at least one field.`);
            }
        }

        if (bodyNode) {
            sym.isDefined = true;
        }

        this.exitScope();
    }

    private elabRecordBase(
        baseTypeNode: TypeNode,
        recordSym: RecordSym,
    ): RecordSym | undefined {
        const baseType = this.typeEval(baseTypeNode);
        if (baseType.kind === TypeKind.Err) {
            return;
        }
        if (baseType.kind !== TypeKind.Record) {
            this.reportError(baseTypeNode, `Base type must be a record.`);
            return;
        }
        if (baseType.sym.recordKind !== recordSym.recordKind && baseType.sym.fields.length !== 1) {
            this.reportError(baseTypeNode, `Base type must be the same kind of record or have exactly one field.`);
            return;
        }
        if (baseType.sym.qualifiedName === recordSym.qualifiedName) {
            this.reportError(baseTypeNode, `Record cannot inherit from itself.`);
            return;
        }
        if (this.isUnsizedType(baseType)) {
            this.reportError(baseTypeNode, `Base type has incomplete type.`);
            return;
        }
        const baseSym = this.symbols.get(baseType.sym.qualifiedName);
        assert(baseSym?.kind === SymKind.Record);
        recordSym.base = baseSym;
        recordSym.fields = [...baseSym.fields];
    }

    private elabRecordField(fieldNode: FieldNode, recordSym: RecordSym) {
        const nameNode = fieldNode.name;
        const typeNode = fieldNode.type;

        let fieldType = this.typeEval(typeNode);
        if (typeNode && this.isUnsizedType(fieldType)) {
            this.reportError(typeNode, `Field has incomplete type. Consider inserting an indirection.`);
            fieldType = mkErrorType();
        }

        const fieldName = nameNode?.text;
        if (!fieldName)
            return;

        const fieldSym = this.defineRecordFieldSym(fieldNode, nameNode, fieldType, recordSym);
        recordSym.fields.push(fieldSym);
    }

    private elabEnum(node: EnumDeclNode) {
        const enumSym = this.defineEnumSym(node, node.name);

        const type = enumSym ? mkEnumType(enumSym) : mkIntType(32);

        if (node.body) {
            let nextValue = 0;
            for (const memberNode of node.body.enumMemberNodes) {
                nextValue = this.elabEnumMember(memberNode, type, nextValue);
            }
        }
    }

    private elabEnumMember(memberNode: EnumMemberNode, type: Type, nextValue: number): number {
        const nameNode = memberNode.name;
        const valueNode = memberNode.value;

        const value = valueNode ? this.constEval(valueNode) : nextValue;
        this.defineConstSym(memberNode, nameNode, type, value);
        return (value ?? nextValue) + 1;
    }

    private elabFunc(node: FuncDeclNode) {
        const nameNode = node.name;
        const paramNodes = node.params?.funcParamNodes ?? [];
        const bodyNode = node.body;

        this.enterScope(node);

        const name = nameNode?.text ?? '';
        const params = stream(paramNodes)
            .filter(paramNode => !paramNode.dotDotDotToken)
            .map<FuncParamSym>((paramNode, index) => this.elabFuncParam(paramNode, name, index))
            .toArray();

        const restParamNode = this.handleRestParamNodes(paramNodes);

        const returnType: Type = node.returnType ? this.typeEval(node.returnType) : mkVoidType();

        if (isInvalidReturnType(returnType)) {
            this.reportError(node.returnType!, `Function return type must have known size.`);
        }

        const sym = this.inOuterScope(() => {
            return this.declareFuncSym(node, nameNode, params, returnType, !!restParamNode, !!bodyNode);
        });

        if (name === 'main') {
            this.verify_main_signature(node, sym);
        }

        this.currentFunc = sym;
        this.nextLocalIndex = 0;

        if (restParamNode) {
            this.defineLocalSym(restParamNode, restParamNode.restParamName, mkRestParamType());
        }

        if (bodyNode) {
            this.elabBlockStmt(bodyNode);
        }

        this.currentFunc = undefined;
        this.nextLocalIndex = undefined!;

        this.exitScope();

        sym.isDefined = !!bodyNode;
    }

    private handleRestParamNodes(paramNodes: FuncParamNode[]) {
        const restParamNodes = paramNodes.filter(paramNode => paramNode.dotDotDotToken);
        const restParamNode = restParamNodes.pop();
        if (!restParamNode) {
            return null;
        }
        for (const paramNode of restParamNodes) {
            this.reportError(paramNode, `Variadic parameter must be the last parameter.`);
        }
        return restParamNode;
    }

    private elabFuncParam(paramNode: FuncParamNode, funcName: string, paramIndex: number): FuncParamSym {
        const nameNode = paramNode.name;
        const typeNode = paramNode.type;

        const type = this.typeEval(typeNode);
        if (this.isUnsizedType(type)) {
            this.reportError(paramNode, `Parameter must have a known size.`);
        }

        return this.defineFuncParamSym(paramNode, nameNode, funcName, paramIndex, type);
    }

    private verify_main_signature(node: FuncDeclNode, sym: FuncSym) {
        if (!typeEq(sym.returnType, mkIntType(32))) {
            const spanNode = node.returnType ?? node.name ?? node;
            this.reportError(spanNode, `Return type of 'main' must be 'Int32'.`);
        }

        const regularParamNodes = node.params!.funcParamNodes.filter(paramNode => !paramNode.dotDotDotToken);
        for (let i = 0; i < sym.params.length; i++) {
            const paramNode = regularParamNodes[i];
            const param = sym.params[i];
            if (i === 0) {
                if (!typeEq(param.type, mkIntType(32))) {
                    this.reportError(paramNode, `The arg count parameter of 'main' must have type 'Int32'.`);
                }
            } else if (i === 1) {
                if (!typeEq(param.type, mkPointerType(mkPointerType(mkIntType(8))))) {
                    this.reportError(paramNode, `The arg vector parameter of 'main' must have type '**Char'.`);
                }
            } else {
                this.reportError(paramNode, `The 'main' function can only have parameters 'argc: Int32' and 'argv: **Char'.`);
            }
        }

        if (sym.isVariadic) {
            const dotDotdotToken = stream(node.params!.funcParamNodes).filterMap(paramNode => paramNode.dotDotDotToken).first()!;
            this.reportError(dotDotdotToken, `The 'main' function cannot be variadic.`);
        }
    }

    private elabGlobal(node: GlobalDeclNode) {
        const externNode = node.externToken;
        const nameNode = node.name;
        const typeNode = node.type;

        const isExtern = !!externNode;

        const type = this.typeEval(typeNode);
        if (this.isUnsizedType(type)) {
            this.reportError(node, `Variable must have a known size.`);
        }

        const sym = this.declareGlobalSym(node, nameNode, type, !isExtern);
        sym.isDefined = !isExtern;
    }

    private elabConst(node: ConstDeclNode) {
        const nameNode = node.name;
        const valueNode = node.value;

        const name = nameNode?.text ?? '';
        const type = mkIntType(32);
        const value = this.constEval(valueNode);

        this.defineConstSym(node, nameNode, type, value);
    }

    //==============================================================================
    //== Statements

    private elabStmt(node: StmtNode | Nullish) {
        if (!node)
            return;

        if (node instanceof BlockStmtNode) {
            this.elabBlockStmt(node);
        } else if (node instanceof LocalDeclNode) {
            this.elabLocalDecl(node);
        } else if (node instanceof IfStmtNode) {
            this.elabIfStmt(node);
        } else if (node instanceof WhileStmtNode) {
            this.elabWhileStmt(node);
        } else if (node instanceof ForStmtNode) {
            this.elabForStmt(node);
        } else if (node instanceof ReturnStmtNode) {
            this.elabReturnStmt(node);
        } else if (node instanceof BreakStmtNode || node instanceof ContinueStmtNode) {
            // Do nothing for BreakStmtNode and ContinueStmtNode
        } else if (node instanceof ExprStmtNode) {
            this.elabExprStmt(node);
        } else {
            unreachable(node);
        }
    }

    private elabBlockStmt(node: BlockStmtNode) {
        this.enterScope(node);
        for (const stmtNode of node.stmtNodes) {
            this.elabStmt(stmtNode);
        }
        this.exitScope();
    }

    private elabStmtWithScope(node: StmtNode | Nullish) {
        if (!node)
            return;

        this.enterScope(node);
        this.elabStmt(node);
        this.exitScope();
    }

    private elabLocalDecl(node: LocalDeclNode) {
        const nameNode = node.name;
        const typeNode = node.type;
        const initNode = node.value;

        const declaredType = typeNode ? this.typeEval(typeNode) : undefined;

        const inferedType = initNode ? this.elabExprInfer(initNode, { typeHint: declaredType }) : undefined;

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

    private elabIfStmt(node: IfStmtNode) {
        const condNode = node.cond;
        const thenNode = node.then;
        const elseNode = node.else;

        this.elabExprBool(condNode);
        this.elabStmtWithScope(thenNode);
        this.elabStmtWithScope(elseNode);
    }

    private elabWhileStmt(node: WhileStmtNode) {
        const condNode = node.cond;
        const bodyNode = node.body;

        this.elabExprBool(condNode);
        this.elabStmtWithScope(bodyNode);
    }

    private elabForStmt(node: ForStmtNode) {
        const initNode = node.init;
        const condNode = node.cond;
        const stepNode = node.step;
        const bodyNode = node.body;

        this.enterScope(node);
        this.elabStmt(initNode);
        this.elabExprBool(condNode);
        this.elabExprInfer(stepNode, { typeHint: undefined });
        this.elabStmtWithScope(bodyNode);
        this.exitScope();
    }

    private elabReturnStmt(node: ReturnStmtNode) {
        const valueNode = node.value;

        const returnType = this.currentFunc!.returnType;
        if (valueNode) {
            this.elabExpr(valueNode, returnType);
        } else if (returnType.kind !== TypeKind.Void) {
            this.reportError(node, `Missing return value.`);
        }
    }

    private elabExprStmt(node: ExprStmtNode) {
        const exprNode = node.expr;
        this.elabExprInfer(exprNode, { typeHint: undefined });
    }

    //==============================================================================
    //== Expressions

    private elabExpr(node: ExprNode | Nullish, expectedType: Type) {
        if (!node)
            return mkErrorType();

        this.elabExprInfer(node, { typeHint: expectedType });
        this.checkType(node, expectedType);
    }

    private elabExprBool(node: ExprNode | Nullish): Type {
        this.elabExpr(node, mkBoolType());
        return mkBoolType();
    }

    private elabExprInferInt(node: ExprNode | Nullish, { typeHint }: { typeHint: Type | undefined }): Type {
        if (!node)
            return mkErrorType();

        const type = this.elabExprInfer(node, { typeHint });
        if (type.kind !== TypeKind.Int) {
            if (type.kind !== TypeKind.Err) {
                this.reportError(node, `Expected integer expression.`);
            }
            return typeHint ?? mkErrorType();
        } else {
            return type;
        }
    }

    private elabExprInfer(node: ExprNode | Nullish, { typeHint }: { typeHint: Type | undefined }): Type {
        if (!node)
            return mkErrorType();

        return this.trackTyping(node, () => {
            if (node instanceof GroupedExprNode) {
                return this.elabGroupedExpr(node, typeHint);
            } else if (node instanceof NameExprNode) {
                return this.elabNameExpr(node);
            } else if (node instanceof SizeofExprNode) {
                return this.elabSizeofExpr(node);
            } else if (node instanceof LiteralExprNode) {
                return this.elabLiteralExpr(node, typeHint);
            } else if (node instanceof ArrayExprNode) {
                return this.elabArrayExpr(node, typeHint);
            } else if (node instanceof BinaryExprNode) {
                return this.elabBinaryExpr(node, typeHint);
            } else if (node instanceof TernaryExprNode) {
                return this.elabTernaryExpr(node, typeHint);
            } else if (node instanceof UnaryExprNode) {
                return this.elabUnaryExpr(node, typeHint);
            } else if (node instanceof CallExprNode) {
                return this.elabCallExpr(node);
            } else if (node instanceof IndexExprNode) {
                return this.elabIndexExpr(node);
            } else if (node instanceof FieldExprNode) {
                return this.elabFieldExpr(node);
            } else if (node instanceof CastExprNode) {
                return this.elabCastExpr(node);
            } else if (node instanceof RecordExprNode) {
                return this.elabRecordExpr(node);
            } else {
                unreachable(node);
            }
        });
    }

    private elabGroupedExpr(node: GroupedExprNode, typeHint: Type | undefined): Type {
        return this.elabExprInfer(node.exprNode, { typeHint });
    }

    private elabNameExpr(nameExpr: NameExprNode): Type {
        const nameNode = nameExpr.identifierToken!;
        const sym = this.resolveName(nameNode);
        if (!sym) {
            return mkErrorType();
        }

        switch (sym.kind) {
            case SymKind.Const:
                return sym.type;
            case SymKind.Global:
            case SymKind.Local:
            case SymKind.FuncParam:
                return sym.type;
            case SymKind.Enum:
                return mkEnumType(sym);
            case SymKind.Record:
            case SymKind.Func:
            case SymKind.RecordField:
                this.reportError(nameNode, `Expected a variable or a constant.`);
                return mkErrorType();
            default: {
                unreachable(sym);
            }
        }
    }

    private elabSizeofExpr(node: SizeofExprNode): Type {
        const typeNode = node.type;
        this.typeEval(typeNode);
        return mkIntType(64);
    }

    private elabLiteralExpr(node: LiteralExprNode, typeHint: Type | undefined): Type {
        const literal = node.literalNode!;
        if (literal instanceof BoolLiteralNode) {
            return mkBoolType();
        } else if (literal instanceof IntLiteralNode) {
            if (typeHint?.kind === TypeKind.Int) {
                return typeHint;
            } else {
                return mkIntType(64);
            }
        } else if (literal instanceof CharLiteralNode) {
            return mkIntType(8);
        } else if (literal instanceof StringLiteralNode) {
            return mkPointerType(mkIntType(8));
        } else if (literal instanceof NullLiteralNode) {
            return mkPointerType(mkVoidType());
        } else {
            unreachable(literal);
        }
    }

    private elabArrayExpr(node: ArrayExprNode, typeHint: Type | undefined): Type {
        const elemNodes = node.exprNodes;
        if (elemNodes.length === 0) {
            this.reportError(node, `Empty array literal.`);
            return mkErrorType();
        }

        const elemTypeHint = typeHint?.kind === TypeKind.Arr ? typeHint.elemType : undefined;

        const elemType = this.elabExprInfer(elemNodes[0], { typeHint: elemTypeHint });
        for (let i = 1; i < elemNodes.length; i++) {
            this.elabExpr(elemNodes[i], elemType);
        }

        return mkArrayType(elemType, elemNodes.length);
    }

    private elabUnaryExpr(node: UnaryExprNode, typeHint: Type | undefined): Type {
        const op = node.op!.text;
        const operandNode = node.right;
        switch (op) {
            case '!':
                return this.elabExprBool(operandNode);
            case '-':
                return this.elabExprInferInt(operandNode, { typeHint });
            case '~':
                return this.elabExprInferInt(operandNode, { typeHint });
            case '&': {
                const operandTypeHint = typeHint?.kind === TypeKind.Ptr ? typeHint.pointeeType : undefined;
                const operandType = this.elabExprInfer(operandNode, { typeHint: operandTypeHint });
                return mkPointerType(operandType);
            }
            case '*':
                {
                    const operandTypeHint = typeHint?.kind === TypeKind.Ptr ? typeHint : undefined;
                    const operandType = this.elabExprInfer(operandNode, { typeHint: operandTypeHint });
                    if (operandType.kind !== TypeKind.Ptr) {
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

    private elabBinaryExpr(node: BinaryExprNode, typeHint: Type | undefined): Type {
        const op = node.op!.text;
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
                    const leftNode = node.left;
                    const rightNode = node.right;

                    if (!isLvalue(leftNode)) {
                        this.reportError(leftNode ?? node, `L-value expected.`);
                    }
                    const leftType = op !== '='
                        ? this.elabExprInferInt(leftNode, { typeHint })
                        : this.elabExprInfer(leftNode, { typeHint: undefined });

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
                    const leftNode = node.left;
                    const rightNode = node.right;
                    const leftType = this.elabExprInferInt(leftNode, { typeHint });
                    const _rightType = this.elabExprInferInt(rightNode, { typeHint: leftType });
                    return this.unifyTypes(node, leftNode, rightNode);
                }
            case '==':
            case '!=':
            case '<':
            case '<=':
            case '>':
            case '>=':
                {
                    const leftNode = node.left;
                    const rightNode = node.right;
                    const leftType = this.elabExprInfer(leftNode, { typeHint: undefined });
                    const _rightType = this.elabExprInfer(rightNode, { typeHint: leftType });
                    const cmpType = this.unifyTypes(node, leftNode, rightNode);
                    if (cmpType.kind !== TypeKind.Err && !isScalarType(cmpType)) {
                        this.reportError(node, `${prettyType(cmpType)} is not comparable.`);
                    }
                    return mkBoolType();
                }
            case '&&':
            case '||':
                {
                    const leftNode = node.left;
                    const rightNode = node.right;
                    this.elabExprBool(leftNode);
                    this.elabExprBool(rightNode);
                    return mkBoolType();
                }
            default:
                return mkErrorType();
        }
    }

    private elabTernaryExpr(node: TernaryExprNode, typeHint: Type | undefined): Type {
        this.elabExprBool(node.cond);
        const thenNode = node.then;
        const elseNode = node.else;
        const thenType = this.elabExprInfer(thenNode, { typeHint });
        const _elseType = this.elabExprInfer(elseNode, { typeHint: thenType });
        return this.unifyTypes(node, thenNode, elseNode);
    }

    private elabCallExpr(node: CallExprNode): Type {
        const calleeNode = node.callee;
        const argListNode = node.args;
        assert(argListNode);

        if (!calleeNode) {
            return this.elabCallExprUnknown(node);
        }
        if (!(calleeNode instanceof NameExprNode)) {
            this.reportError(calleeNode, `Function name expected.`);
            this.elabExprInfer(calleeNode, { typeHint: undefined });
            return this.elabCallExprUnknown(node);
        }

        const calleeNameNode = calleeNode.identifierToken!;
        const calleeName = calleeNameNode.text;

        const sym = this.resolveName(calleeNameNode);
        if (!sym) {
            return this.elabCallExprUnknown(node);
        }
        if (sym.kind != SymKind.Func) {
            this.reportError(calleeNode, `'${calleeName}' is not a function.`);
            this.elabExprInfer(calleeNode, { typeHint: undefined });
            return this.elabCallExprUnknown(node);
        }

        const params = sym.params;
        const argNodes = argListNode.callArgNodes;

        const nParams = sym.params.length;
        const nArgs = argListNode.callArgNodes.length;

        if (nArgs < nParams) {
            this.reportError(argListNode, `Too few arguments provided (${nArgs} < ${nParams}).`);
        } else if (nArgs > nParams && !sym.isVariadic) {
            this.reportError(argListNode, `Too many arguments provided (${nArgs} > ${nParams}).`);
        }
        for (let i = 0; i < nArgs; i++) {
            const argNode = argNodes[i];
            const argLabelNode = argNode.label;
            const argValueNode = argNode.value;
            if (i < nParams) {
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
            } else {
                let argType = mkErrorType();
                if (argValueNode) {
                    argType = this.elabExprInfer(argValueNode, { typeHint: undefined });
                    if (argType.kind === TypeKind.RestParam) {
                        this.reportWarning(argValueNode, `Rest parameter value passed as a variadic argument. This might be a mistake.`);
                    }
                }
                if (sym.isVariadic) {
                    if (argLabelNode) {
                        this.reportError(argLabelNode, `Variadic argument cannot have a label.`);
                    }
                    if (argValueNode && this.isUnsizedType(argType)) {
                        this.reportError(argValueNode, `Variadic argument must have a known size.`);
                    }
                }
            }
        }

        return sym.returnType;
    }

    private elabCallExprUnknown(node: CallExprNode): Type {
        const argListNode = node.args!;

        for (const argNode of argListNode.callArgNodes.filter(x => x.value)) {
            const valueNode = argNode.value!;
            this.elabExprInfer(valueNode, { typeHint: undefined });
        }
        return mkErrorType();
    }

    private elabIndexExpr(node: IndexExprNode): Type {
        const indexeeNode = node.indexee;
        const indexNode = node.index;

        const indexeeType = this.elabExprInfer(indexeeNode, { typeHint: undefined });
        const _indexType = this.elabExprInferInt(indexNode, { typeHint: undefined });

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

    private elabField(node: FieldExprNode): RecordFieldSym | undefined {
        const leftNode = node.left;
        const nameNode = node.name;

        let leftType = this.elabExprInfer(leftNode, { typeHint: undefined });
        if (leftType.kind === TypeKind.Ptr) {
            leftType = leftType.pointeeType;
        }
        if (leftType.kind !== TypeKind.Record) {
            if (leftType.kind !== TypeKind.Err) {
                this.reportError(node, `Expected record type.`);
            }
            return;
        }

        if (!nameNode) {
            return;
        }
        return this.resolveRecordField(leftType.sym.qualifiedName, nameNode);
    }

    private elabFieldExpr(node: FieldExprNode): Type {
        const field = this.elabField(node);
        return field?.type ?? mkErrorType();
    }

    private elabCastExpr(node: CastExprNode): Type {
        const typeNode = node.type;
        const keywordNode = node.asToken!;
        const exprNode = node.expr;

        const castType = this.typeEval(typeNode);
        const exprType = this.elabExprInfer(exprNode, { typeHint: undefined });

        if (!typeConvertible(exprType, castType)) {
            this.reportError(node, `Invalid cast type.`);
        }

        if (typeEq(castType, exprType)) {
            this.reportWarning(keywordNode, `Redundant cast.`);
        }

        return castType;
    }

    private elabRecordExpr(node: RecordExprNode): Type {
        const nameNode = node.name!;
        const fieldListNode = node.fields!;

        const sym = this.resolveName(nameNode);
        if (!sym) {
            return this.elabRecordExprUnknown(node);
        }
        if (sym.kind !== SymKind.Record) {
            this.reportError(nameNode, `Expected a record name.`);
            return this.elabRecordExprUnknown(node);
        }

        if (!sym.isDefined) {
            this.reportError(nameNode, `'${sym.name}' has incomplete type.`);
            return this.elabRecordExprUnknown(node);
        }

        const seenFields = new Set<string>();

        for (const fieldNode of fieldListNode.fieldInitNodes) {
            const valueNode = fieldNode.value;

            let nameNode = fieldNode.name;
            if (!nameNode && valueNode instanceof NameExprNode) {
                nameNode = valueNode.identifierToken;
            }

            let fieldType = mkErrorType();
            if (nameNode) {
                const fieldSym = this.resolveRecordField(sym.qualifiedName, nameNode);
                if (fieldSym) {
                    if (seenFields.has(fieldSym.name)) {
                        this.reportError(nameNode, `Field is already initialized.`);
                    }
                    if (sym.recordKind === RecordKind.Union && seenFields.size > 0) {
                        this.reportError(nameNode, `Only one field can be initialized in a union.`);
                    }
                    seenFields.add(fieldSym.name);
                    fieldType = fieldSym.type;
                }
            }

            if (valueNode) {
                this.elabExpr(valueNode, fieldType);
            }
        }

        const uninitializedFields = sym.fields.filter(field => !seenFields.has(field.name));
        if (sym.recordKind === RecordKind.Struct) {
            for (const field of uninitializedFields) {
                this.reportError(node, `Field '${field.name}' is not initialized.`);
            }
        } else {
            if (uninitializedFields.length === 0) {
                this.reportError(node, `No field is initialized.`);
            }
        }

        return mkRecordType(sym);
    }

    private elabRecordExprUnknown(node: RecordExprNode): Type {
        const fieldListNode = node.fields!;
        for (const fieldNode of fieldListNode.fieldInitNodes) {
            const valueNode = fieldNode.value;
            if (valueNode) {
                this.elabExprInfer(valueNode, { typeHint: undefined });
            }
        }
        return mkErrorType();
    }

    //==============================================================================
    //== Type checking

    private canCoerceWithCast(node: ExprNode, target: Type): boolean {
        return typeImplicitlyConvertible(this.getType(node), target);
    }

    private canCoerceToUnion(node: ExprNode, target: Type): boolean {
        if (target.kind !== TypeKind.Record || target.sym.recordKind !== RecordKind.Union) {
            return false;
        }
        const field = target.sym.fields.find(f => typeEq(f.type, this.getType(node)));
        return !!field;
    }

    private canCoerce(node: ExprNode, expected: Type) {
        const actual = this.getType(node);
        return typeEq(actual, expected)
            || this.canCoerceWithCast(node, expected)
            || this.canCoerceToUnion(node, expected);
    }

    private unifyTypes(node: ExprNode, e1: ExprNode | Nullish, e2: ExprNode | Nullish): Type {
        if (!(e1 && e2)) {
            return e1 ? this.getType(e1) : e2 ? this.getType(e2) : mkErrorType();
        }

        let t1 = this.getType(e1);
        let t2 = this.getType(e2);

        if (this.canCoerce(e1, t2)) {
            t1 = t2;
        }
        if (this.canCoerce(e2, t1)) {
            t2 = t1;
        }

        return tryUnifyTypes(t1, t2, () => {
            this.reportError(node, `Type mismatch. Cannot unify '${prettyType(t1)}' and '${prettyType(t2)}'.`);
        });
    }

    private checkType(node: ExprNode, expected: Type) {
        const actual = this.getType(node);
        if (this.canCoerce(node, expected)) {
            return;
        }

        if (expected.kind === TypeKind.Ptr && expected.pointeeType.kind === TypeKind.Void && actual.kind === TypeKind.Ptr) {
            return;
        }
        if (!typeLooseEq(actual, expected)) {
            this.reportError(node, `Type mismatch. Expected '${prettyType(expected)}', got '${prettyType(actual)}'.`);
        }
    }

    //==============================================================================
    //== Helper methods

    private setType(node: ExprNode | TypeNode, type: Type) {
        this.nodeTypeMap.set(node.syntax, type);
    }

    private getType(node: ExprNode | TypeNode): Type {
        const type = this.nodeTypeMap.get(node.syntax);
        assert(type, `Missing type for node: ${node.syntax.type}`);
        return type;
    }

    private trackTyping(node: ExprNode | TypeNode, f: () => Type): Type {
        const type = f();
        this.setType(node, type);
        return type;
    }

    private reportDiagnostic(range: PointRange, severity: Severity, message: string) {
        this.diagnostics.push({
            severity,
            message,
            location: {
                file: this.path,
                range,
            },
        });
    }

    private reportError(range: PointRange, message: string) {
        this.reportDiagnostic(range, 'error', message);
    }

    private reportWarning(range: PointRange, message: string) {
        this.reportDiagnostic(range, 'warning', message);
    }

    private isUnsizedType(type: Type): boolean {
        return type.kind !== TypeKind.Err
            && typeLayout(type) === undefined;
    }

    private createOrigin(node: SyntaxNode, nameNode: TokenNode | Nullish, isForwardDecl: boolean = false): Origin {
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
        return (JSON.parse(`"\\${c}"`) as string).charCodeAt(0);
    } else {
        return text.charCodeAt(1);
    }
}

function isLvalue(node: ExprNode | Nullish): boolean {
    if (!node)
        return true;
    if (node instanceof GroupedExprNode) {
        return isLvalue(node.exprNode);
    } else if (node instanceof NameExprNode) {
        return true;
    } else if (node instanceof IndexExprNode) {
        return true;
    } else if (node instanceof FieldExprNode) {
        return true;
    } else if (node instanceof UnaryExprNode) {
        return node.op?.text === '*';
    } else {
        return false;
    }
}

function isInvalidReturnType(type: Type): boolean {
    return type.kind !== TypeKind.Err && !isValidReturnType(type);
}

function typeLooseEq(t1: Type, t2: Type): boolean {
    return t1.kind === TypeKind.Err || t2.kind === TypeKind.Err || typeEq(t1, t2);
}

function paramsLooseEq(p1: FuncParamSym[], p2: FuncParamSym[]): boolean {
    return stream(p1).zipLongest(p2).every(([a, b]) => a && b && typeLooseEq(a.type, b.type));
}

function appendInWeakMap<K extends WeakKey, V>(map: WeakMap<K, V[]>, key: K, value: V): void {
    const values = map.get(key);
    if (values) {
        values.push(value);
    } else {
        map.set(key, [value]);
    }
}
