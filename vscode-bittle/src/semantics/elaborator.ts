import assert from 'assert';
import { basename as pathBasename, resolve as resolvePath } from 'path';
import { ParsingService } from '../services/parsingService';
import { PathResolver } from '../services/pathResolver';
import { PointRange, SyntaxNode } from '../syntax';
import { AstNode, TokenNode } from '../syntax/ast';
import { ArrayExprNode, ArrayTypeNode, BinaryExprNode, BlockStmtNode, BoolLiteralNode, BreakStmtNode, CallArgListNode, CallArgNode, CallExprNode, CastExprNode, CharLiteralNode, ConstDeclNode, ContinueStmtNode, DeclNode, EnumDeclNode, EnumMemberNode, ExprNode, ExprStmtNode, FieldExprNode, FieldNode, ForStmtNode, FuncDeclNode, FuncParamNode, GlobalDeclNode, GroupedExprNode, GroupedPatternNode, GroupedTypeNode, IfStmtNode, ImportDeclNode, IncludeDeclNode, IndexExprNode, IntLiteralNode, IsExprNode, LiteralExprNode, LiteralNode, LiteralPatternNode, LocalDeclNode, MatchCaseNode, MatchStmtNode, ModuleNameDeclNode, NameExprNode, NamePatternNode, NameTypeNode, NeverTypeNode, NormalFuncParamNode, NullLiteralNode, OrPatternNode, PatternNode, PointerTypeNode, RangePatternNode, RecordDeclNode, RecordExprNode, RestFuncParamNode, RestParamTypeNode, ReturnStmtNode, RootNode, SizeofExprNode, StmtNode, StringLiteralNode, TernaryExprNode, TypeArgListNode, TypeNode, TypeofTypeNode, TypeParamListNode, TypeParamNode, UnaryExprNode, VarPatternNode, WhileStmtNode, WildcardPatternNode } from '../syntax/generated';
import { Nullish, unreachable } from '../utils';
import { ReactiveCache } from '../utils/reactiveCache';
import { stream } from '../utils/stream';
import { ConstValue, ConstValueKind, mkIntConstValue } from './const';
import { ConstEvaluator } from './constEvaluator';
import { Scope } from './scope';
import { ConstSym, EnumSym, FuncParamSym, FuncSym, GlobalSym, LocalSym, Origin, RecordFieldSym, RecordKind, RecordSym, Sym, SymKind, TypeParamSym } from './sym';
import { canCoerce, containsTypeParam, createEmptySubstCtx, createInferCtx, createSubstCtx, createSubstCtxFromRecordType, isScalarType, isValidReturnType, mkArrayType, mkBoolType, mkEnumType, mkErrorType, mkIntType, mkNeverType, mkPointerType, mkRecordType, mkRestParamType, mkTypeParamType, mkVoidType, prettyType, primitiveTypes, RecordType, SubstCtx, tryAddInferenceConstraint, tryFinishInference, tryUnifyTypes, tryUnifyTypesWithCoercion, Type, typeCastable, typeEq, typeImplicitlyCastable, TypeKind, typeLayout, typeSubst } from './type';

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
    moduleName: string | undefined;
    imports: Map<string, ElaboratorResult>;
    rootScope: Scope;
    symbols: Map<string, Sym>;
    nodeSymMap: WeakMap<SyntaxNode, string[]>;
    nodeTypeMap: WeakMap<SyntaxNode, Type>;
    references: Map<string, SymReference[]>;
    diagnostics: ElaborationDiag[];
};

type IncludedDecl = {
    path: string;
    node: DeclNode;
};

export class Elaborator {
    private rootNode: RootNode;

    private scope: Scope;

    // Path -> ElaboratorResult
    private imports: Map<string, ElaboratorResult> = new Map();

    // Symbol.qualifiedName -> Symbol
    private symbols: Map<string, Sym> = new Map();
    // Symbol.qualifiedName -> Reference[]
    private references: Map<string, SymReference[]> = new Map();

    // SyntaxNode -> Symbol.qualifiedName
    private nodeSymMap: WeakMap<SyntaxNode, string[]> = new WeakMap();
    // SyntaxNode -> Type
    private nodeTypeMap: WeakMap<SyntaxNode, Type> = new WeakMap();

    private diagnostics: ElaborationDiag[] = [];

    // Current module
    moduleName: string | undefined;

    // Current function
    private currentFunc: FuncSym | undefined;
    private nextLocalIndex: number = 0;

    // Current 'in' expression
    inExprDepth: number = 0;

    // Current pattern
    orPatternDepth: number = 0;

    importChain: string[];

    private constructor(
        private parsingService: ParsingService,
        private pathResolver: PathResolver,
        private cache: ReactiveCache,
        private path: string,
        importChain: string[],
    ) {
        this.importChain = [...importChain, path];
        this.rootNode = this.parsingService.parseAsAst(path);
        this.scope = new Scope(this.path, this.rootNode.syntax);
    }

    private run(): ElaboratorResult {
        this.elabRoot(this.rootNode);
        return {
            moduleName: this.moduleName,
            imports: this.imports,
            rootScope: this.scope,
            symbols: this.symbols,
            nodeSymMap: this.nodeSymMap,
            nodeTypeMap: this.nodeTypeMap,
            references: this.references,
            diagnostics: this.diagnostics,
        };
    }

    public static elaborate(
        parsingService: ParsingService,
        pathResolver: PathResolver,
        cache: ReactiveCache,
        path: string,
        importChain: string[] = [],
    ): ElaboratorResult {
        return cache.compute('elaborate:' + path, () =>
            new Elaborator(parsingService, pathResolver, cache, path, importChain).run(),
        );
    }

    //==============================================================================
    //== Scopes and Symbols

    private pushScope(node: AstNode, scope?: Scope) {
        if (scope) {
            assert(this.scope === scope.parent);
            this.scope = scope;
        } else {
            this.scope = new Scope(this.path, node.syntax, this.scope);
        }
    }

    private popScope() {
        assert(this.scope.parent, `Cannot exit root scope.`);
        const scope = this.scope;
        this.scope = this.scope.parent;
        return scope;
    }

    private lookupSymbol(name: string) {
        const sym = this.lookupSymbolInCurrentModule(name);
        if (sym) {
            return [sym];
        }

        return stream(this.imports.values())
            .filterMap(result => result.rootScope.lookup(name))
            .map(qname => this.symbols.get(qname)!)
            .toArray();
    }

    private lookupSymbolInCurrentModule(name: string) {
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
        const syms = this.lookupSymbol(name);

        switch (syms.length) {
            case 1:
                this.recordNameResolution(syms[0], nameNode);
                return syms[0];
            case 0:
                this.reportError(nameNode, `Unknown symbol '${name}'.`);
                return undefined;
            default:
                this.reportError(nameNode, `Ambiguous symbol '${name}'.`);
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

    private addSym(sym: Sym, nameNode: SyntaxNode | undefined) {
        this.scope.add(sym.name, sym.qualifiedName);
        this.symbols.set(sym.qualifiedName, sym);
        if (nameNode) {
            this.recordNameIntroduction(sym, nameNode);
        }
    }

    private declareRecordSym(declNode: RecordDeclNode, nameNode: TokenNode | Nullish, typeParams: TypeParamSym[], isDefinition: boolean): RecordSym {
        const recordKind = declNode.structToken ? RecordKind.Struct : RecordKind.Union;

        if (!nameNode) {
            return {
                kind: SymKind.Record,
                recordKind,
                name: '',
                qualifiedName: '',
                origins: [],
                isDefined: false,
                base: undefined,
                fields: [],
                typeParams: [],
            };
        }

        const existing = this.lookupExistingSymbol(nameNode.text);
        if (existing) {
            if (existing.kind !== SymKind.Record) {
                this.reportError(nameNode, `Another symbol with the same name already exists.`);
            } else if (existing.recordKind !== recordKind) {
                this.reportError(nameNode, `Redefinition of '${existing.name}' with different kind.`);
            } else if (!typeParamsEq(existing.typeParams, typeParams)) {
                this.reportError(nameNode, `Redefinition of '${existing.name}' with different type parameters.`);
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
            qualifiedName: this.mkQualifiedName('record', nameNode.text),
            origins: [this.createOrigin(declNode.syntax, nameNode, !isDefinition)],
            isDefined: false,
            base: undefined,
            fields: [],
            typeParams,
        };
        this.addSym(sym, nameNode);
        return sym;
    }

    private defineRecordSym(sym: RecordSym, nameNode: TokenNode | Nullish) {
        if (!nameNode) {
            return;
        }
        if (sym.isDefined) {
            this.reportError(nameNode, `Redefinition of '${sym.name}'.`);
            return;
        }
        sym.isDefined = true;
    }

    private defineRecordFieldSym(declNode: FieldNode, nameNode: TokenNode | Nullish, type: Type, recordSym: RecordSym, defaultValue: ConstValue | undefined): RecordFieldSym {
        if (!nameNode) {
            return {
                kind: SymKind.RecordField,
                name: '',
                qualifiedName: '',
                origins: [],
                isDefined: true,
                type,
                defaultValue,
            };
        }

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
            qualifiedName: this.mkQualifiedName(recordSym.name, nameNode.text),
            origins: [this.createOrigin(declNode.syntax, nameNode)],
            isDefined: true,
            type,
            defaultValue,
        };
        if (!existing) {
            this.addSym(sym, nameNode);
        }
        return sym;
    }

    private declareEnumSym(declNode: EnumDeclNode, nameNode: TokenNode | Nullish): EnumSym {
        if (!nameNode) {
            return {
                kind: SymKind.Enum,
                name: '',
                qualifiedName: '',
                origins: [],
                isDefined: false,
                size: 32,
            };
        }

        const existing = this.lookupExistingSymbol(nameNode.text);
        if (existing) {
            if (existing.kind !== SymKind.Enum) {
                this.reportError(nameNode, `Another symbol with the same name already exists.`);
            } else {
                this.recordNameIntroduction(existing, nameNode);
                existing.origins.push(this.createOrigin(declNode.syntax, nameNode));
                return existing;
            }
        }
        const sym: EnumSym = {
            kind: SymKind.Enum,
            name: nameNode.text,
            qualifiedName: this.mkQualifiedName('enum', nameNode.text),
            origins: [this.createOrigin(declNode.syntax, nameNode)],
            isDefined: false,
            size: 32,
        };
        this.addSym(sym, nameNode);
        return sym;
    }

    private defineEnumSym(sym: EnumSym, nameNode: TokenNode | Nullish) {
        if (!nameNode) {
            return;
        }
        if (sym.isDefined) {
            this.reportError(nameNode, `Redefinition of '${sym.name}'.`);
            return;
        }
        sym.isDefined = true;
        return;
    }

    private defineTypeParamSym(parentQname: string, node: TypeParamNode): TypeParamSym {
        const nameNode = node.name;
        if (!nameNode) {
            return {
                kind: SymKind.TypeParam,
                name: '',
                qualifiedName: '',
                origins: [],
                isDefined: true,
            };
        }

        const existing = this.lookupExistingSymbol(nameNode.text);
        if (existing) {
            if (existing.kind !== SymKind.TypeParam) {
                this.reportError(nameNode, `Another symbol with the same name already exists.`);
            } else {
                this.reportError(nameNode, `Redefinition of '${existing.name}'.`);
            }
        }

        const sym: TypeParamSym = {
            kind: SymKind.TypeParam,
            name: nameNode.text,
            qualifiedName: `${parentQname}.typeParam:${nameNode.text}`,
            origins: [this.createOrigin(node.syntax, nameNode)],
            isDefined: true,
        };

        if (!existing) {
            this.addSym(sym, nameNode);
        }
        return sym;
    }

    private declareFuncSym(declNode: FuncDeclNode, nameNode: TokenNode | Nullish, typeParams: TypeParamSym[], params: FuncParamSym[], returnType: Type, restParamNode: RestFuncParamNode | undefined, isDefinition: boolean): FuncSym {
        const isVariadic = !!restParamNode;
        const restParamName = restParamNode?.name?.text;

        if (!nameNode) {
            return {
                kind: SymKind.Func,
                name: '',
                qualifiedName: '',
                origins: [],
                isDefined: false,
                params,
                returnType,
                isVariadic,
                restParamName,
                typeParams: [],
            };
        }

        const existing = this.lookupExistingSymbol(nameNode.text);
        if (existing) {
            if (existing.kind !== SymKind.Func) {
                this.reportError(nameNode, `Another symbol with the same name already exists.`);
            } else if (!typeParamsEq(existing.typeParams, typeParams) || !paramsEq(existing.params, params) || !typeLooseEq(existing.returnType, returnType) || existing.isVariadic !== isVariadic || existing.restParamName !== restParamName) {
                this.reportError(nameNode, `Redefinition of '${existing.name}' with different signature.`);
            } else {
                this.recordNameIntroduction(existing, nameNode);
                existing.origins.push(this.createOrigin(declNode.syntax, nameNode, !isDefinition));
                return existing;
            }
        }
        const sym: FuncSym = {
            kind: SymKind.Func,
            name: nameNode.text,
            qualifiedName: this.mkQualifiedName('func', nameNode.text),
            origins: [this.createOrigin(declNode.syntax, nameNode, !isDefinition)],
            isDefined: false,
            params,
            returnType,
            isVariadic,
            restParamName,
            typeParams,
        };
        this.addSym(sym, nameNode);
        return sym;
    }

    private defineFuncSym(sym: FuncSym, nameNode: TokenNode | Nullish) {
        if (!nameNode) {
            return;
        }
        if (sym.isDefined) {
            this.reportError(nameNode, `Redefinition of '${sym.name}'.`);
            return;
        }
        sym.isDefined = true;
    }

    private defineFuncParamSym(declNode: FuncParamNode, nameNode: TokenNode | Nullish, funcName: string, paramIndex: number, type: Type, defaultValue: ConstValue | undefined): FuncParamSym {
        if (!nameNode) {
            return {
                kind: SymKind.FuncParam,
                name: '',
                qualifiedName: '',
                origins: [],
                isDefined: true,
                type,
                defaultValue,
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
            qualifiedName: this.mkQualifiedName('func', funcName, `.param:${paramIndex}`),
            origins: [this.createOrigin(declNode.syntax, nameNode)],
            isDefined: true,
            type,
            defaultValue,
        };

        if (!existing) {
            this.addSym(sym, nameNode);
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
            } else {
                this.recordNameIntroduction(existing, nameNode);
                existing.origins.push(this.createOrigin(declNode.syntax, nameNode, !isDefinition));
                return existing;
            }
        }
        const sym: GlobalSym = {
            kind: SymKind.Global,
            name: nameNode.text,
            qualifiedName: this.mkQualifiedName('global', nameNode.text),
            origins: [this.createOrigin(declNode.syntax, nameNode, !isDefinition)],
            isDefined: false,
            type,
        };
        this.addSym(sym, nameNode);
        return sym;
    }

    private defineGlobalSym(sym: GlobalSym, nameNode: TokenNode | Nullish) {
        if (!nameNode) {
            return;
        }
        if (sym.isDefined) {
            this.reportError(nameNode, `Redefinition of '${sym.name}'.`);
            return;
        }
        sym.isDefined = true;
    }

    private declareConstSym(nameNode: TokenNode | Nullish): ConstSym {
        if (!nameNode) {
            return {
                kind: SymKind.Const,
                name: '',
                qualifiedName: '',
                origins: [],
                isDefined: false,
                value: undefined,
            };
        }

        const sym: ConstSym = {
            kind: SymKind.Const,
            name: nameNode.text,
            qualifiedName: this.mkQualifiedName('const', nameNode.text),
            origins: [this.createOrigin(nameNode, nameNode)],
            isDefined: false,
            value: undefined,
        };
        this.addSym(sym, nameNode);
        return sym;
    }

    private defineConstSym(sym: ConstSym, nameNode: TokenNode | Nullish, value: ConstValue | undefined) {
        if (!nameNode) {
            return;
        }
        if (sym.isDefined) {
            this.reportError(nameNode, `Redefinition of '${sym.name}'.`);
            return;
        }
        sym.isDefined = true;
        sym.value = value;
    }

    private defineLocalSym(declNode: LocalDeclNode | FuncParamNode | VarPatternNode, nameNode: TokenNode | Nullish, type: Type): LocalSym {
        if (!nameNode) {
            return {
                kind: SymKind.Local,
                name: '',
                qualifiedName: '',
                origins: [],
                isDefined: true,
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
            qualifiedName: this.mkQualifiedName('func', this.currentFunc!.name, `.local:${this.nextLocalIndex++}`),
            origins: [this.createOrigin(declNode.syntax, nameNode)],
            isDefined: true,
            type,
        };

        if (!isConflictingRedefinition) {
            this.addSym(sym, nameNode);
        }
        return sym;
    }

    private elabTypeParamList(parentQname: string, node: TypeParamListNode | undefined): TypeParamSym[] {
        if (!node) {
            return [];
        }
        return node.typeParamNodes.map(paramNode => this.defineTypeParamSym(parentQname, paramNode));
    }

    //==============================================================================
    //== Types

    private evalArraySize(expr: ExprNode | undefined): number | undefined {
        if (!expr) {
            return undefined;
        }

        let size: bigint | number | undefined = this.constEvalInt64(expr);
        size = Number(size);
        if (!Number.isSafeInteger(size)) {
            this.reportError(expr.syntax, `Value out of range.`);
            return undefined;
        }
        if (size !== undefined && size <= 0) {
            this.reportError(expr.syntax, `Array size must be positive.`);
            return undefined;
        }
        return size;
    }

    private typeEval(typeNode: TypeNode | Nullish): Type {
        if (!typeNode)
            return mkErrorType();

        return this.trackTyping(typeNode, () => {
            if (typeNode instanceof GroupedTypeNode) {
                const nestedTypeNode = typeNode.type;
                return this.typeEval(nestedTypeNode);
            } else if (typeNode instanceof NameTypeNode) {
                const nameNode = typeNode.name!;
                const typeArgsNode = typeNode.typeArgs;
                const name = nameNode.text;

                if (name in primitiveTypes) {
                    if (typeArgsNode) {
                        this.reportError(typeArgsNode, `'${name}' does not take type arguments.`);
                    }
                    return primitiveTypes[name]!;
                } else {
                    const sym = this.resolveName(nameNode);
                    if (!sym) {
                        return mkErrorType();
                    }
                    if (typeArgsNode && (sym.kind !== SymKind.Record || sym.typeParams.length === 0)) {
                        this.reportError(typeArgsNode, `'${name}' does not take type arguments.`);
                    }
                    switch (sym.kind) {
                        case SymKind.Record:
                            return this.elabRecordType(sym, typeNode);
                        case SymKind.Enum:
                            return mkEnumType(sym);
                        case SymKind.TypeParam:
                            return mkTypeParamType(sym);
                        default:
                            this.reportError(nameNode, `'${sym.name}' is not a type.`);
                            return mkErrorType();
                    }
                }
            } else if (typeNode instanceof PointerTypeNode) {
                const isMut = !!typeNode.mutToken;
                return mkPointerType(this.typeEval(typeNode.pointee), isMut);
            } else if (typeNode instanceof ArrayTypeNode) {
                const elemType = this.typeEval(typeNode.type);
                if (isUnsizedType(elemType)) {
                    this.reportError(typeNode, `The element type of an array must have a known size.`);
                }

                const size = this.evalArraySize(typeNode.size);
                return mkArrayType(elemType, size);
            } else if (typeNode instanceof TypeofTypeNode) {
                return this.elabExprInfer(typeNode.expr, { typeHint: undefined });
            } else if (typeNode instanceof NeverTypeNode) {
                return mkNeverType();
            } else if (typeNode instanceof RestParamTypeNode) {
                return mkRestParamType();
            } else {
                unreachable(typeNode);
            }
        });
    }

    private elabRecordType(sym: RecordSym, node: NameTypeNode): Type {
        const typeArgsNode = node.typeArgs;

        if (!typeArgsNode && sym.typeParams.length > 0) {
            this.reportError(node, `Type arguments are missing.`);
        } else if (typeArgsNode && typeArgsNode.typeNodes.length !== sym.typeParams.length) {
            this.reportError(typeArgsNode, `Type argument mismatch. Expecting ${sym.typeParams.length} type arguments.`);
        }

        const providedTypes = typeArgsNode?.typeNodes.map(typeNode => this.typeEval(typeNode)) ?? [];
        const typeArgs = sym.typeParams.map((_, i) => providedTypes[i] ?? mkErrorType());

        return mkRecordType(sym, typeArgs);
    }

    //==============================================================================
    //== Constants

    constEvalExpect(node: ExprNode | undefined, type: Type): ConstValue | undefined {
        if (!node) {
            return;
        }
        this.elabExpr(node, type);
        const value = this.getConstValue(node);
        if (!value) {
            this.reportError(node, `Expected a constant expression.`);
        }
        return value;
    }

    constEvalInfer(node: ExprNode | undefined, { typeHint }: { typeHint: Type | undefined }): ConstValue | undefined {
        if (!node) {
            return;
        }
        this.elabExprInfer(node, { typeHint });
        const value = this.getConstValue(node);
        if (!value) {
            this.reportError(node, `Expected a constant expression.`);
        }
        return value;
    }

    constEvalInferInt(node: ExprNode | undefined, { typeHint }: { typeHint: Type | undefined }): bigint | undefined {
        if (!node) {
            return;
        }
        this.elabExprInferInt(node, { typeHint });
        const value = this.getConstValue(node);
        if (!value) {
            this.reportError(node, `Expected a constant expression.`);
            return undefined;
        }
        return value?.kind === ConstValueKind.Int ? value.value : undefined;
    }

    constEvalInt64(node: ExprNode | undefined): bigint | undefined {
        const value = this.constEvalExpect(node, mkIntType(64));
        return value?.kind === ConstValueKind.Int ? value.value : undefined;
    }

    constEvalInt32(node: ExprNode | undefined): bigint | undefined {
        const value = this.constEvalExpect(node, mkIntType(32));
        return value?.kind === ConstValueKind.Int ? value.value : undefined;
    }

    getConstValue(node: ExprNode): ConstValue | undefined {
        const constEvaluator = new ConstEvaluator(
            node => {
                const qnames = this.nodeSymMap.get(node.identifierToken!);
                const syms = qnames?.map(qname => this.symbols.get(qname));
                return syms?.length === 1 ? syms[0] : undefined;
            },
            node => this.getType(node),
        );
        return constEvaluator.eval(node);
    }

    //==============================================================================
    //== Top-level

    private elabRoot(rootNode: RootNode) {
        const decls: IncludedDecl[] = [];
        this.expandIncludes(this.path, rootNode.declNodes, new Set(), decls);

        let hasModuleName = false;
        if (decls[0]?.node instanceof ModuleNameDeclNode) {
            hasModuleName = true;
            this.processModuleName(decls[0].node);
        }

        const moduleHeadersAndImports: IncludedDecl[] = [];
        const typesAndConsts: IncludedDecl[] = [];
        const funcsAndGlobals: IncludedDecl[] = [];

        for (const [i, decl] of decls.entries()) {
            if (hasModuleName && i === 0) {
                // Skip
            } else if (decl.node instanceof IncludeDeclNode) {
                // Skip
            } else if (decl.node instanceof ModuleNameDeclNode || decl.node instanceof ImportDeclNode) {
                moduleHeadersAndImports.push(decl);
            } else if (decl.node instanceof RecordDeclNode || decl.node instanceof EnumDeclNode || decl.node instanceof ConstDeclNode) {
                typesAndConsts.push(decl);
            } else if (decl.node instanceof FuncDeclNode || decl.node instanceof GlobalDeclNode) {
                funcsAndGlobals.push(decl);
            } else {
                unreachable(decl.node);
            }
        }

        this.elabDecls(moduleHeadersAndImports);
        this.elabDecls(typesAndConsts);
        this.elabDecls(funcsAndGlobals);
    }

    private elabDecls(includedDecls: IncludedDecl[]) {
        const completionCallbacks = includedDecls.map(({ path, node }) => {
            const complete = this.withPath(path, () => this.elabDecl(node));
            if (!complete) {
                return () => { /* skip */ };
            }
            return () => this.withPath(path, complete);
        });

        completionCallbacks.forEach((complete) => complete());
    }

    private expandIncludes(path: string, declNodes: DeclNode[], seenPaths: Set<string>, result: IncludedDecl[]) {
        const resolvedPath = resolvePath(path);

        seenPaths.add(resolvedPath);
        for (const node of declNodes) {
            if (node instanceof IncludeDeclNode) {
                this.processInclude(node, seenPaths, result);
            } else {
                result.push({ path, node });
            }
        }
    }

    private processInclude(node: IncludeDeclNode, seenPaths: Set<string>, result: IncludedDecl[]) {
        if (!node.path) {
            return;
        }

        const resolvedPath = this.pathResolver.resolveInclude(this.path, node.path);
        if (!resolvedPath) {
            this.reportError(node, `Cannot resolve include.`);
            return;
        }

        if (seenPaths.has(resolvedPath)) {
            return;
        }

        const tree = this.parsingService.parseAsAst(resolvedPath);
        return this.expandIncludes(resolvedPath, tree.declNodes, seenPaths, result);
    }

    private processModuleName(node: ModuleNameDeclNode) {
        const name = node.name?.text;
        if (!name) {
            return;
        }

        const expectedName = /^\w+/.exec(pathBasename(this.path))?.[0];
        if (name !== expectedName) {
            this.reportError(node, `Module name must match the file name.`);
        }

        this.moduleName = name;
    }

    private elabDecl(node: DeclNode): undefined | (() => void) {
        if (node instanceof IncludeDeclNode) {
            // Skip
        } else if (node instanceof ImportDeclNode) {
            this.elabImport(node);
        } else if (node instanceof ModuleNameDeclNode) {
            this.handleBadModuleName(node);
        } else if (node instanceof RecordDeclNode) {
            return this.elabRecord(node);
        } else if (node instanceof FuncDeclNode) {
            return this.elabFunc(node);
        } else if (node instanceof GlobalDeclNode) {
            return this.elabGlobal(node);
        } else if (node instanceof ConstDeclNode) {
            return this.elabConst(node);
        } else if (node instanceof EnumDeclNode) {
            return this.elabEnum(node);
        } else {
            unreachable(node);
        }
    }

    private handleBadModuleName(node: ModuleNameDeclNode) {
        this.reportError(node, `Module name must be declared at the beginning of the file.`);
    }

    private elabImport(node: ImportDeclNode) {
        const pathNode = node.path;
        if (!pathNode) {
            return;
        }
        const path = this.pathResolver.resolveImport(this.path, pathNode);
        if (!path) {
            this.reportError(node, `Cannot resolve import.`);
            return;
        }

        if (this.imports.has(path)) {
            return;
        }

        if (this.importChain.includes(path)) {
            const cycle = this.importChain.slice(this.importChain.indexOf(path));
            cycle.push(path);
            this.reportError(node, `Import cycle detected: ${cycle.join(' → ')}.`);
            return;
        }

        const elaboratorResult = Elaborator.elaborate(
            this.parsingService,
            this.pathResolver,
            this.cache,
            path,
            this.importChain,
        );
        if (!elaboratorResult.moduleName) {
            this.reportError(node, `Imported file is not a module.`);
            return;
        }

        this.imports.set(path, elaboratorResult);
        for (const [qname, sym] of elaboratorResult.symbols) {
            this.symbols.set(qname, sym);
        }
    }

    private elabRecord(node: RecordDeclNode) {
        const nameNode = node.name;
        const baseTypeNode = node.base;
        const bodyNode = node.body;
        const typeParamsNode = node.typeParams;

        this.pushScope(node);

        const name = nameNode?.text ?? '';
        const qname = this.mkQualifiedName('record', name);
        const typeParams = this.elabTypeParamList(qname, typeParamsNode);

        const isDefinition = !!(bodyNode || baseTypeNode);

        const scope = this.popScope();

        const sym = this.declareRecordSym(node, nameNode, typeParams, isDefinition);

        return () => {
            this.pushScope(node, scope);

            if (baseTypeNode) {
                this.elabRecordBase(baseTypeNode, sym);
            }

            if (bodyNode) {
                for (const fieldNode of bodyNode.fieldNodes) {
                    this.elabRecordField(fieldNode, sym);
                }

                if (sym.fields.length === 0) {
                    this.reportError(bodyNode, `Record must have at least one field.`);
                }
            }

            this.popScope();

            if (isDefinition) {
                this.defineRecordSym(sym, nameNode);
            }
        };
    }

    private elabRecordBase(
        baseTypeNode: TypeNode,
        recordSym: RecordSym,
    ) {
        const baseType = this.typeEval(baseTypeNode);
        if (baseType.kind === TypeKind.Err) {
            return;
        }
        if (baseType.kind !== TypeKind.Record) {
            this.reportError(baseTypeNode, `Base type must be a record.`);
            return;
        }
        if (isUnsizedType(baseType)) {
            this.reportError(baseTypeNode, `Base type has incomplete type.`);
            return;
        }
        if (baseType.sym.qualifiedName === recordSym.qualifiedName) {
            this.reportError(baseTypeNode, `Record cannot inherit from itself.`);
            return;
        }
        const baseSym = this.symbols.get(baseType.sym.qualifiedName);
        assert(baseSym?.kind === SymKind.Record);

        const substCtx = createSubstCtxFromRecordType(baseType);

        for (const field of baseSym.fields) {
            const newField: RecordFieldSym = {
                ...field,
                type: typeSubst(substCtx, field.type),
                defaultValue: field.defaultValue,
            };
            recordSym.fields.push(newField);
            this.addSym(newField, undefined);
        }

        recordSym.base = baseSym;
    }

    private elabRecordField(fieldNode: FieldNode, recordSym: RecordSym) {
        const nameNode = fieldNode.name;
        const typeNode = fieldNode.type;
        const valueNode = fieldNode.value;

        if (nameNode && !typeNode && valueNode) {
            this.elabRecordFieldDefaultValueDecl(recordSym, fieldNode);
        } else {
            this.elabRecordFieldRegularDecl(fieldNode, recordSym);
        }
    }

    private elabRecordFieldDefaultValueDecl(recordSym: RecordSym, fieldNode: FieldNode) {
        const nameNode = fieldNode.name!;
        const valueNode = fieldNode.value!;
        const fieldName = nameNode.text;

        const fieldSym = recordSym.fields.find(f => f.name === fieldName);
        if (!fieldSym) {
            this.reportError(nameNode, `No existing field to add default value to.`);
            return;
        }
        this.recordNameResolution(fieldSym, nameNode);
        if (fieldSym.defaultValue !== undefined) {
            this.reportError(nameNode, `Field already has a default value.`);
            return;
        }
        const defaultValue = this.constEvalExpect(valueNode, fieldSym.type);
        fieldSym.defaultValue = defaultValue;
    }

    private elabRecordFieldRegularDecl(fieldNode: FieldNode, recordSym: RecordSym) {
        const nameNode = fieldNode.name;
        const typeNode = fieldNode.type;
        const valueNode = fieldNode.value;

        let fieldType: Type | undefined = undefined;
        if (typeNode) {
            fieldType = this.typeEval(typeNode);
            if (isUnsizedType(fieldType)) {
                this.reportError(typeNode, `Field has incomplete type. Consider inserting an indirection.`);
                fieldType = mkErrorType();
            }
        } else {
            if (nameNode) {
                this.reportError(nameNode, `Missing field type.`);
            }
            fieldType = mkErrorType();
        }

        let defaultValue: ConstValue | undefined = undefined;
        if (valueNode) {
            defaultValue = this.constEvalExpect(valueNode, fieldType);
        }

        const fieldSym = this.defineRecordFieldSym(fieldNode, nameNode, fieldType, recordSym, defaultValue);
        recordSym.fields.push(fieldSym);
    }

    private elabEnum(node: EnumDeclNode) {
        let sym: EnumSym | undefined = undefined;
        if (node.name) {
            sym = this.declareEnumSym(node, node.name);
        }
        const memberSyms: ConstSym[] = [];
        for (const memberNode of node.body?.enumMemberNodes ?? []) {
            memberSyms.push(this.declareConstSym(memberNode.name));
        }

        return () => {
            if (sym) {
                this.defineEnumSym(sym, node.name);
            }

            const type = sym ? mkEnumType(sym) : mkIntType(32);

            if (node.body) {
                let nextValue = 0n;
                const memberNodes = node.body.enumMemberNodes;
                for (const [memberNode, memberSym] of stream(memberNodes).zip(memberSyms)) {
                    nextValue = this.elabEnumMember(memberNode, memberSym, type, nextValue);
                }
            }
        };
    }

    private elabEnumMember(node: EnumMemberNode, sym: ConstSym, type: Type, nextValue: bigint): bigint {
        const nameNode = node.name;
        const valueNode = node.value;

        const value = valueNode ? this.constEvalInt32(valueNode) : nextValue;
        const constValue = value !== undefined ? mkIntConstValue(value, type) : undefined;
        this.defineConstSym(sym, nameNode, constValue);
        return (value ?? nextValue) + 1n;
    }

    private elabFunc(node: FuncDeclNode) {
        const nameNode = node.name;
        const paramNodes = node.params?.funcParamNodes ?? [];
        const bodyNode = node.body;
        const typeParamsNode = node.typeParams;

        this.pushScope(node);

        const name = nameNode?.text ?? '';
        const qname = this.mkQualifiedName('func', name);
        const typeParams = this.elabTypeParamList(qname, typeParamsNode);

        const params = stream(paramNodes)
            .filter(paramNode => paramNode instanceof NormalFuncParamNode)
            .map<FuncParamSym>((paramNode, index) => this.elabFuncParam(paramNode, name, index))
            .toArray();

        this.checkDefaultParamsOrder(paramNodes);

        const restParamNode = this.handleRestParamNodes(paramNodes);

        const returnType: Type = node.returnType ? this.typeEval(node.returnType) : mkVoidType();

        if (isInvalidReturnType(returnType)) {
            this.reportError(node.returnType!, `Function return type must have known size.`);
        }

        const innerScope = this.popScope();

        const sym = this.declareFuncSym(node, nameNode, typeParams, params, returnType, restParamNode, !!bodyNode);

        if (name === 'main') {
            this.verify_main_signature(node, sym);
        }

        return () => {
            this.currentFunc = sym;
            this.nextLocalIndex = 0;

            this.pushScope(node, innerScope);

            if (restParamNode) {
                this.defineLocalSym(restParamNode, restParamNode.name, mkRestParamType());
            }

            if (bodyNode) {
                this.elabBlockStmt(bodyNode);
                this.defineFuncSym(sym, node.name);
            }

            this.popScope();

            this.currentFunc = undefined;
            this.nextLocalIndex = undefined!;
        };
    }

    private checkDefaultParamsOrder(paramNodes: FuncParamNode[]) {
        let hasSeenDefaultParam = false;
        for (const paramNode of paramNodes) {
            if (paramNode instanceof NormalFuncParamNode) {
                if (hasSeenDefaultParam && !paramNode.value) {
                    this.reportError(paramNode, `Non-default parameter cannot follow a default parameter.`);
                }
                hasSeenDefaultParam ||= !!paramNode.value;
            }
        }
    }

    private handleRestParamNodes(paramNodes: FuncParamNode[]): RestFuncParamNode | undefined {
        const lastParam = paramNodes[paramNodes.length - 1];
        for (const paramNode of paramNodes) {
            if (!(paramNode instanceof RestFuncParamNode)) {
                continue;
            }
            if (paramNode != lastParam) {
                this.reportError(paramNode, `Variadic parameter must be the last parameter.`);
            }
        }
        if (!(lastParam instanceof RestFuncParamNode)) {
            return undefined;
        }
        return lastParam;
    }

    private elabFuncParam(paramNode: NormalFuncParamNode, funcName: string, paramIndex: number): FuncParamSym {
        const nameNode = paramNode.name;
        const typeNode = paramNode.type;

        const type = this.typeEval(typeNode);
        if (isUnsizedType(type)) {
            this.reportError(paramNode, `Parameter must have a known size.`);
        }

        let defaultValue: ConstValue | undefined = undefined;
        if (paramNode.value) {
            defaultValue = this.constEvalExpect(paramNode.value, type);
        }

        return this.defineFuncParamSym(paramNode, nameNode, funcName, paramIndex, type, defaultValue);
    }

    private verify_main_signature(node: FuncDeclNode, sym: FuncSym) {
        if (!typeEq(sym.returnType, mkIntType(32))) {
            const spanNode = node.returnType ?? node.name ?? node;
            this.reportError(spanNode, `Return type of 'main' must be 'Int32'.`);
        }

        const normalParamNodes = node.params!.funcParamNodes.filter(paramNode => paramNode instanceof NormalFuncParamNode);
        for (let i = 0; i < sym.params.length; i++) {
            const paramNode = normalParamNodes[i];
            const param = sym.params[i];
            if (i === 0) {
                if (!typeEq(param.type, mkIntType(32))) {
                    this.reportError(paramNode, `The arg count parameter of 'main' must have type 'Int32'.`);
                }
            } else if (i === 1) {
                if (!typeEq(param.type, mkPointerType(mkPointerType(mkIntType(8), false), false))) {
                    this.reportError(paramNode, `The arg vector parameter of 'main' must have type '**Char'.`);
                }
            } else {
                this.reportError(paramNode, `The 'main' function can only have parameters 'argc: Int32' and 'argv: **Char'.`);
            }
        }

        if (sym.isVariadic) {
            const restParamNode = stream(node.params!.funcParamNodes)
                .filter(paramNode => paramNode instanceof RestParamTypeNode)
                .last()!;
            this.reportError(restParamNode, `The 'main' function cannot have a variadic parameter.`);
        }
    }

    private elabGlobal(node: GlobalDeclNode) {
        const nameNode = node.name;
        const typeNode = node.type;

        const isDefinition = !node.externToken;

        const type = this.typeEval(typeNode);
        if (isUnsizedType(type)) {
            this.reportError(node, `Variable must have a known size.`);
        }

        const sym = this.declareGlobalSym(node, nameNode, type, isDefinition);

        return () => {
            if (isDefinition) {
                this.defineGlobalSym(sym, node.name);
            }
        };
    }

    private elabConst(node: ConstDeclNode) {
        const nameNode = node.name;
        const typeNode = node.type;
        const valueNode = node.value;
        const sym = this.declareConstSym(nameNode);

        return () => {
            let type: Type | undefined = undefined;
            if (typeNode) {
                type = this.typeEval(typeNode);
                if (type.kind != TypeKind.Err && !isScalarType(type)) {
                    this.reportError(typeNode, `Constant must have a scalar type.`);
                    type = mkErrorType();
                }
            }

            let value: ConstValue | undefined = undefined;
            if (valueNode) {
                if (type) {
                    value = this.constEvalExpect(valueNode, type);
                } else {
                    value = this.constEvalInfer(valueNode, { typeHint: type });
                }
            }

            this.defineConstSym(sym, nameNode, value);
        };
    }

    //==============================================================================
    //== Statements

    private elabStmt(node: StmtNode | Nullish) {
        if (!node)
            return;

        if (node instanceof BlockStmtNode) {
            this.elabBlockStmt(node);
        } else if (node instanceof ConstDeclNode) {
            this.elabConst(node)();
        } else if (node instanceof LocalDeclNode) {
            this.elabLocalDecl(node);
        } else if (node instanceof IfStmtNode) {
            this.elabIfStmt(node);
        } else if (node instanceof MatchStmtNode) {
            this.elabMatchStmt(node);
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
        this.pushScope(node);
        for (const stmtNode of node.stmtNodes) {
            this.elabStmt(stmtNode);
        }
        this.popScope();
    }

    private elabStmtWithScope(node: StmtNode | Nullish) {
        if (!node)
            return;

        this.pushScope(node);
        this.elabStmt(node);
        this.popScope();
    }

    private elabLocalDecl(node: LocalDeclNode) {
        const nameNode = node.name;
        const typeNode = node.type;
        const initNode = node.value;

        const declaredType = typeNode ? this.typeEval(typeNode) : undefined;

        const inferedType = initNode ? this.elabExprInfer(initNode, { typeHint: declaredType }) : undefined;

        if (declaredType && inferedType) {
            this.checkExprType(initNode!, declaredType);
        }
        let type = declaredType ?? inferedType;

        if (!type) {
            this.reportError(node, `Missing type in local declaration.`);
            type ??= mkErrorType();
        }
        if (isUnsizedType(type)) {
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

    private elabMatchStmt(node: MatchStmtNode) {
        const valueNode = node.value;
        const bodyNode = node.body;

        const valueType = this.elabExprInfer(valueNode, { typeHint: undefined });

        this.pushScope(node);
        for (const caseNode of bodyNode?.matchCaseNodes ?? []) {
            this.elabMatchCase(caseNode, valueType);
        }
        this.popScope();
    }

    private elabMatchCase(caseNode: MatchCaseNode, valueType: Type) {
        const patternNode = caseNode.pattern;
        const guardNode = caseNode.guard;
        const bodyNode = caseNode.body;

        this.pushScope(caseNode);
        this.elabPatternExpect(patternNode, valueType);
        this.elabExprBool(guardNode);
        this.elabStmt(bodyNode);
        this.popScope();
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

        this.pushScope(node);
        this.elabStmt(initNode);
        this.elabExprBool(condNode);
        this.elabExprInfer(stepNode, { typeHint: undefined });
        this.elabStmtWithScope(bodyNode);
        this.popScope();
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
        this.checkExprType(node, expectedType);
    }

    private elabExprBool(node: ExprNode | Nullish): Type {
        this.elabExpr(node, mkBoolType());
        return mkBoolType();
    }

    private elabExprInferInt(node: ExprNode | Nullish, { typeHint }: { typeHint: Type | undefined }): Type {
        if (!node)
            return mkErrorType();

        this.elabExprInfer(node, { typeHint });
        return this.checkExprTypeInt(node);
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
            } else if (node instanceof UnaryExprNode) {
                return this.elabUnaryExpr(node, typeHint);
            } else if (node instanceof BinaryExprNode) {
                return this.elabBinaryExpr(node, typeHint);
            } else if (node instanceof TernaryExprNode) {
                return this.elabTernaryExpr(node, typeHint);
            } else if (node instanceof IsExprNode) {
                return this.elabIsExpr(node);
            } else if (node instanceof CallExprNode) {
                return this.elabCallExpr(node, typeHint);
            } else if (node instanceof IndexExprNode) {
                return this.elabIndexExpr(node);
            } else if (node instanceof FieldExprNode) {
                return this.elabFieldExpr(node);
            } else if (node instanceof CastExprNode) {
                return this.elabCastExpr(node);
            } else if (node instanceof RecordExprNode) {
                return this.elabRecordExpr(node, typeHint);
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
                return sym.value?.type ?? mkErrorType();
            case SymKind.Global:
            case SymKind.Local:
            case SymKind.FuncParam:
                return sym.type;
            case SymKind.Enum:
            case SymKind.Record:
            case SymKind.Func:
            case SymKind.RecordField:
            case SymKind.TypeParam:
                this.reportError(nameNode, `Expected a variable or a constant.`);
                return mkErrorType();
            default: {
                unreachable(sym);
            }
        }
    }

    private elabSizeofExpr(node: SizeofExprNode): Type {
        const resultType = mkIntType(64);

        const evaluatedType = this.typeEval(node.type);
        if (isUnsizedType(evaluatedType)) {
            this.reportError(node, `Size of type cannot be determined.`);
        }

        return resultType;
    }

    private elabLiteralExpr(node: LiteralExprNode, typeHint: Type | undefined): Type {
        return this.elabLiteral(node.literalNode!, typeHint);
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
                const isMut = this.checkIfLvalue(operandNode)?.isMut ?? false;
                return mkPointerType(operandType, isMut);
            }
            case '*': {
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
            case '%=': {
                const leftNode = node.left;
                const rightNode = node.right;

                const leftType = op !== '='
                    ? this.elabExprInferInt(leftNode, { typeHint })
                    : this.elabExprInfer(leftNode, { typeHint: undefined });

                if (rightNode) {
                    this.elabExpr(rightNode, leftType);
                }

                const lvalueResult = this.checkIfLvalue(leftNode);
                if (!lvalueResult.isLvalue) {
                    this.reportError(leftNode ?? node, `L-value expected.`);
                }
                if (lvalueResult.isMut === false) {
                    this.reportError(leftNode ?? node, `Target is not mutable.`);
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
            case '^': {
                const leftNode = node.left;
                const rightNode = node.right;
                const leftType = this.elabExprInferInt(leftNode, { typeHint });
                const rightType = this.elabExprInferInt(rightNode, { typeHint: leftType });
                return this.unifyTypesWithCoercion(node, leftType, rightType);
            }
            case '==':
            case '!=':
            case '<':
            case '<=':
            case '>':
            case '>=': {
                const leftNode = node.left;
                const rightNode = node.right;
                const leftType = this.elabExprInfer(leftNode, { typeHint: undefined });
                const rightType = this.elabExprInfer(rightNode, { typeHint: leftType });
                const cmpType = this.unifyTypesWithCoercion(node, leftType, rightType);
                if (cmpType.kind !== TypeKind.Err && !isScalarType(cmpType)) {
                    this.reportError(node, `${prettyType(cmpType)} is not comparable.`);
                }
                return mkBoolType();
            }
            case '&&':
            case '||': {
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
        const elseType = this.elabExprInfer(elseNode, { typeHint: thenType });
        return this.unifyTypesWithCoercion(node, thenType, elseType);
    }

    private elabIsExpr(node: IsExprNode): Type {
        this.inExprDepth++;
        try {
            const exprNode = node.expr;
            const patternNode = node.pattern;

            const exprType = this.elabExprInfer(exprNode, { typeHint: undefined });
            this.elabPatternExpect(patternNode, exprType);

            return mkBoolType();
        } finally {
            this.inExprDepth--;
        }
    }

    private elabCallExpr(node: CallExprNode, typeHint: Type | undefined): Type {
        const calleeNode = node.callee;
        const argListNode = node.args;
        assert(argListNode);

        const sym = this.validateCallee(calleeNode, node);
        if (!sym) {
            return this.elabCallExprUnknown(node);
        }

        const initializedParams = this.elabCallArgs(sym, argListNode);
        const substCtx = this.inferFuncCallTypeArgs(node, sym, initializedParams, typeHint);
        this.checkArgumentTypes(sym, initializedParams, substCtx);
        return typeSubst(substCtx, sym.returnType);
    }

    private validateCallee(calleeNode: ExprNode | undefined, node: CallExprNode): FuncSym | null {
        if (!calleeNode || !(calleeNode instanceof NameExprNode)) {
            this.reportError(calleeNode ?? node, 'Expected function name.');
            return null;
        }

        const sym = this.resolveName(calleeNode.identifierToken!);
        if (!sym || sym.kind !== SymKind.Func) {
            this.reportError(calleeNode, 'Expected a function.');
            return null;
        }
        return sym;
    }

    private elabCallExprUnknown(node: CallExprNode): Type {
        const argListNode = node.args!;
        for (const argNode of argListNode.callArgNodes) {
            if (argNode.value) {
                this.elabExprInfer(argNode.value, { typeHint: undefined });
            }
        }
        return mkErrorType();
    }

    private elabCallArgs(sym: FuncSym, argListNode: CallArgListNode): (CallArgNode | undefined)[] {
        const params = sym.params;
        const argNodes = argListNode.callArgNodes;
        const initializedParams: (CallArgNode | undefined)[] = Array(params.length).fill(undefined);
        let seenNamedArg = false;

        for (let i = 0; i < argNodes.length; i++) {
            const argNode = argNodes[i];

            if (argNode.label) {
                const argLabel = argNode.label.text;
                const paramIndex = params.findIndex(p => p.name === argLabel);
                if (paramIndex === -1) {
                    this.reportError(argNode.label, `Unknown parameter '${argLabel}'`);
                    this.elabExprInfer(argNode.value, { typeHint: undefined });
                } else if (initializedParams[paramIndex]) {
                    this.reportError(argNode.label, `Parameter '${argLabel}' is already initialized`);
                    this.elabExprInfer(argNode.value, { typeHint: undefined });
                } else {
                    this.recordNameResolution(params[paramIndex], argNode.label);
                    this.elaborateCallArgument(sym, paramIndex, argNode);
                    initializedParams[paramIndex] = argNode;
                }
                seenNamedArg = true;
            } else if (seenNamedArg) {
                this.reportError(argNode, 'Positional argument cannot follow a named argument.');
                this.elabExprInfer(argNode.value, { typeHint: undefined });
            } else if (i >= params.length) {
                if (!sym.isVariadic) {
                    this.reportError(argNode, 'Too many arguments provided.');
                    this.elabExprInfer(argNode.value, { typeHint: undefined });
                } else {
                    this.elaborateCallArgument(sym, -1, argNode);
                }
            } else {
                this.elaborateCallArgument(sym, i, argNode);
                initializedParams[i] = argNode;
            }
        }

        for (let i = 0; i < params.length; i++) {
            if (!initializedParams[i] && !params[i].defaultValue) {
                const errorNode = argListNode.rParToken ?? argNodes[argNodes.length - 1] ?? argListNode;
                this.reportError(errorNode, `Missing argument for parameter '${params[i].name}'`);
            }
        }

        return initializedParams;
    }

    private elaborateCallArgument(
        sym: FuncSym,
        paramIndex: number,
        arg: CallArgNode,
    ): void {
        if (paramIndex !== -1) {
            const param = sym.params[paramIndex];
            const typeHint = containsTypeParam(param.type, sym.typeParams) ? undefined : param.type;
            if (arg.value) {
                this.elabExprInfer(arg.value, { typeHint });
            }
        } else if (arg.value) {
            const argType = this.elabExprInfer(arg.value, { typeHint: undefined });
            if (isUnsizedType(argType)) {
                this.reportError(arg.value, 'Cannot pass an unsized type as a variadic argument.');
            }
        }
    }

    private inferFuncCallTypeArgs(
        node: CallExprNode,
        sym: FuncSym,
        initializedParams: (CallArgNode | undefined)[],
        typeHint: Type | undefined,
    ): SubstCtx {
        if (sym.typeParams.length === 0) {
            return createEmptySubstCtx();
        }

        const inferCtx = createInferCtx(sym.typeParams);

        if (typeHint) {
            tryAddInferenceConstraint(inferCtx, sym.returnType, typeHint);
        }

        for (let i = 0; i < sym.params.length; i++) {
            const param = sym.params[i];
            const arg = initializedParams[i];
            if (arg?.value) {
                tryAddInferenceConstraint(inferCtx, param.type, this.getType(arg.value));
            }
        }

        if (!tryFinishInference(inferCtx)) {
            this.reportError(node, 'Unable to infer type arguments.');
        }

        const args = inferCtx.args.map(arg => arg ?? mkErrorType());
        const substCtx = createSubstCtx(sym.typeParams, args);

        return substCtx;
    }

    private checkArgumentTypes(
        sym: FuncSym,
        initializedParams: (CallArgNode | undefined)[],
        substCtx: SubstCtx | null,
    ): void {
        for (let i = 0; i < sym.params.length; i++) {
            const arg = initializedParams[i];
            if (!arg || !arg.value)
                continue;

            const param = sym.params[i];
            const paramType = substCtx ? typeSubst(substCtx, param.type) : param.type;
            this.checkExprType(arg.value, paramType);
        }
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

    private elabFieldExpr(node: FieldExprNode): Type {
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
            return mkErrorType();
        }

        if (!nameNode) {
            return mkErrorType();
        }
        const field = this.resolveRecordField(leftType.sym.qualifiedName, nameNode);
        if (!field) {
            return mkErrorType();
        }

        const substCtx = createSubstCtxFromRecordType(leftType);
        return typeSubst(substCtx, field.type);
    }

    private elabCastExpr(node: CastExprNode): Type {
        const typeNode = node.type;
        const keywordNode = node.asToken!;
        const exprNode = node.expr;

        const castType = this.typeEval(typeNode);
        const exprType = this.elabExprInfer(exprNode, { typeHint: undefined });

        if (!typeCastable(exprType, castType)) {
            this.reportError(node, `Invalid cast type.`);
        }

        if (typeImplicitlyCastable(exprType, castType)) {
            this.reportWarning(keywordNode, `Redundant cast.`);
        }

        return castType;
    }

    private elabRecordExpr(node: RecordExprNode, typeHint: Type | undefined): Type {
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

        let recordType: RecordType | undefined;
        if (sym.typeParams.length === 0) {
            recordType = mkRecordType(sym, []);
        } else if (typeHint?.kind === TypeKind.Record && typeHint.sym === sym) {
            recordType = typeHint;
        } else {
            recordType = mkRecordType(sym, sym.typeParams.map(tp => mkErrorType()));
        }

        const seenFields = new Set<string>();
        const substCtx = createSubstCtxFromRecordType(recordType);

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
                    fieldType = typeSubst(substCtx, fieldSym.type);
                }
            }

            if (valueNode) {
                this.elabExpr(valueNode, fieldType);
            }
        }

        const uninitializedFields = sym.fields.filter(field =>
            !seenFields.has(field.name)
            && field.defaultValue === undefined,
        );
        if (sym.recordKind === RecordKind.Struct) {
            for (const field of uninitializedFields) {
                this.reportError(node, `Field '${field.name}' is not initialized.`);
            }
        } else {
            if (uninitializedFields.length === 0) {
                this.reportError(node, `No field is initialized.`);
            }
        }

        return recordType;
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
    //== Patterns

    private elabPatternExpect(node: PatternNode | Nullish, expectedType: Type) {
        if (!node)
            return;
        const type = this.elabPatternInfer(node, { typeHint: expectedType });
        this.checkPatternType(node, expectedType);
        return type;
    }

    private elabPatternInfer(node: PatternNode | Nullish, { typeHint }: { typeHint: Type }): Type {
        if (!node)
            return mkErrorType();
        return this.trackTyping(node, () => {
            if (node instanceof GroupedPatternNode) {
                return this.elabGroupedPattern(node, typeHint);
            } else if (node instanceof LiteralPatternNode) {
                return this.elabLiteralPattern(node, typeHint);
            } else if (node instanceof NamePatternNode) {
                return this.elabIdentifierPattern(node, typeHint);
            } else if (node instanceof WildcardPatternNode) {
                return this.elabWildcardPattern(node, typeHint);
            } else if (node instanceof VarPatternNode) {
                return this.elabVarPattern(node, typeHint);
            } else if (node instanceof RangePatternNode) {
                return this.elabRangePattern(node, typeHint);
            } else if (node instanceof OrPatternNode) {
                return this.elabOrPattern(node, typeHint);
            } else {
                unreachable(node);
            }
        });
    }

    private elabGroupedPattern(node: GroupedPatternNode, typeHint: Type): Type {
        return this.elabPatternInfer(node.pattern, { typeHint });
    }

    private elabLiteralPattern(node: LiteralPatternNode, typeHint: Type): Type {
        return this.elabLiteral(node.literalNode!, typeHint);
    }

    private elabIdentifierPattern(node: NamePatternNode, typeHint: Type): Type {
        const nameNode = node.identifierToken!;
        const sym = this.resolveName(nameNode);
        if (!sym) {
            return mkErrorType();
        }
        if (sym.kind !== SymKind.Const) {
            this.reportError(nameNode, `Pattern identifier '${nameNode.text}' must refer to a constant.`);
            return mkErrorType();
        }
        const constType = sym.value?.type ?? mkErrorType();
        return constType;
    }

    private elabWildcardPattern(node: WildcardPatternNode, typeHint: Type): Type {
        return typeHint;
    }

    private elabVarPattern(node: VarPatternNode, typeHint: Type): Type {
        const nameNode = node.name;
        const subpattern = node.pattern;

        const patternType = this.elabPatternInfer(subpattern, { typeHint: typeHint });

        if (this.orPatternDepth != 0) {
            this.reportError(node, `Variable pattern is not allowed in an or-pattern.`);
            return patternType;
        }

        this.defineLocalSym(node, nameNode, patternType);

        return patternType;
    }

    private elabRangePattern(node: RangePatternNode, typeHint: Type): Type {
        const lowerNode = node.lower;
        const upperNode = node.upper;

        if (!lowerNode && !upperNode) {
            this.reportError(node, `Range pattern must have at least one bound.`);
            return mkErrorType();
        }

        const lowerValue = this.constEvalInfer(lowerNode, { typeHint });
        const upperValue = this.constEvalInfer(upperNode, { typeHint });

        const lowerType = lowerNode ? this.getType(lowerNode) : mkErrorType();
        const upperType = upperNode ? this.getType(upperNode) : mkErrorType();
        const type = this.unifyTypes(node, lowerType, upperType);

        if (isNonIntegerType(type)) {
            this.reportError(node, `Integer range pattern expected.`);
        }

        if (lowerValue !== undefined && upperValue !== undefined) {
            if (lowerValue > upperValue) {
                this.reportWarning(node, `Range '${lowerValue}..${upperValue}' is empty.`);
            }
        }

        return type;
    }

    private elabOrPattern(node: OrPatternNode, typeHint: Type): Type {
        const patternNodes = node.patternNodes;
        assert(patternNodes.length > 0);

        try {
            this.orPatternDepth++;
            const firstPattern = patternNodes[0];
            const firstPatternType = this.elabPatternInfer(firstPattern, { typeHint });

            let type = firstPatternType;
            for (let i = 1; i < patternNodes.length; i++) {
                const pattern = patternNodes[i];
                const patternType = this.elabPatternInfer(pattern, { typeHint });
                type = tryUnifyTypes(type, patternType, () => {
                    this.reportTypeUnificationError(node, type, patternType);
                });
            }

            return type;
        } finally {
            this.orPatternDepth--;
        }
    }

    //==============================================================================
    //== Literals

    private elabLiteral(node: LiteralNode, typeHint: Type | undefined): Type {
        if (node instanceof BoolLiteralNode) {
            return mkBoolType();
        } else if (node instanceof IntLiteralNode) {
            return typeHint?.kind === TypeKind.Int ? typeHint : mkIntType(64);
        } else if (node instanceof CharLiteralNode) {
            return mkIntType(8);
        } else if (node instanceof StringLiteralNode) {
            return mkPointerType(mkIntType(8), false);
        } else if (node instanceof NullLiteralNode) {
            return typeHint?.kind === TypeKind.Ptr ? typeHint : mkPointerType(mkVoidType(), true);
        } else {
            unreachable(node);
        }
    }

    //==============================================================================
    //== Type checking

    private unifyTypesWithCoercion(node: AstNode, t1: Type, t2: Type): Type {
        return tryUnifyTypesWithCoercion(t1, t2, () => {
            this.reportTypeUnificationError(node, t1, t2);
        });
    }

    private unifyTypes(node: AstNode, t1: Type, t2: Type): Type {
        return tryUnifyTypes(t1, t2, () => {
            this.reportTypeUnificationError(node, t1, t2);
        });
    }

    private canCoerceExpr(node: ExprNode, expected: Type) {
        return canCoerce(this.getType(node), expected);
    }

    private checkExprType(node: ExprNode, expected: Type) {
        const actual = this.getType(node);
        if (this.canCoerceExpr(node, expected)) {
            return;
        }

        if (!typeLooseEq(actual, expected)) {
            this.reportTypeError(node, expected, actual);
        }
    }

    private checkExprTypeInt(node: ExprNode): Type {
        const actual = this.getType(node);
        for (let i = 1; i <= 8; i *= 2) {
            const target = mkIntType(i * 8);
            if (this.canCoerceExpr(node, target)) {
                return target;
            }
        }
        this.reportError(node, `Expected integer expression, got '${prettyType(actual)}'.`);
        return mkErrorType();
    }

    private checkPatternType(node: PatternNode, expected: Type) {
        const actual = this.getType(node);
        if (!typeLooseEq(actual, expected)) {
            this.reportTypeError(node, expected, actual);
        }
    }

    private reportTypeError(node: AstNode, expected: Type, actual: Type) {
        this.reportError(node, `Type mismatch. Expected '${prettyType(expected)}', got '${prettyType(actual)}'.`);
    }

    private reportTypeUnificationError(node: AstNode, t1: Type, t2: Type) {
        this.reportError(node, `Type mismatch. Cannot unify '${prettyType(t1)}' and '${prettyType(t2)}'.`);
    }

    //==============================================================================
    //== Helper methods

    checkIfLvalue(node: ExprNode | Nullish): { isLvalue: boolean; isMut?: boolean } {
        if (!node) {
            return { isLvalue: false };
        } else if (node instanceof GroupedExprNode) {
            return this.checkIfLvalue(node.exprNode);
        } else if (node instanceof NameExprNode) {
            const sym = this.resolveName(node.identifierToken!);
            if (!sym || ![SymKind.Local, SymKind.Global, SymKind.FuncParam].includes(sym.kind)) {
                return { isLvalue: false };
            }
            return { isLvalue: true, isMut: true };
        } else if (node instanceof FieldExprNode) {
            if (!node.left) {
                return { isLvalue: true };
            }
            const leftType = this.getType(node.left);
            if (leftType.kind === TypeKind.Ptr) {
                return { isLvalue: true, isMut: leftType.isMut };
            }
            return this.checkIfLvalue(node.left);
        } else if (node instanceof IndexExprNode) {
            if (!node.indexee) {
                return { isLvalue: true };
            }
            const indexeeType = this.getType(node.indexee);
            if (indexeeType.kind === TypeKind.Ptr) {
                return { isLvalue: true, isMut: indexeeType.isMut };
            }
            return this.checkIfLvalue(node.indexee);
        } else if (node instanceof UnaryExprNode && node.op?.text === '*') {
            if (!node.right) {
                return { isLvalue: true };
            }
            const rightType = this.getType(node.right);
            return rightType.kind === TypeKind.Ptr
                ? { isLvalue: true, isMut: rightType.isMut }
                : { isLvalue: false };
        } else {
            return { isLvalue: false };
        }
    }

    private setType(node: ExprNode | PatternNode | TypeNode, type: Type) {
        this.nodeTypeMap.set(node.syntax, type);
    }

    private getType(node: ExprNode | PatternNode | TypeNode): Type {
        const type = this.nodeTypeMap.get(node.syntax);
        assert(type, `Missing type for node: ${node.syntax.type}`);
        return type;
    }

    private trackTyping(node: ExprNode | PatternNode | TypeNode, f: () => Type): Type {
        const type = f();
        this.setType(node, type);
        return type;
    }

    private withPath<T>(path: string, callback: () => T): T {
        const oldPath = this.path;
        this.path = path;
        const result = callback();
        this.path = oldPath;
        return result;
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

    private createOrigin(node: SyntaxNode, nameNode: TokenNode | Nullish, isForwardDecl: boolean = false): Origin {
        return {
            file: this.path,
            node,
            nameNode: nameNode ?? undefined,
            isForwardDecl,
        };
    }

    mkQualifiedName(type: string, name: string, suffix = '') {
        const module = this.moduleName ?? '';
        if (module) {
            type = '.' + type;
        }
        if (name) {
            name = '.' + name;
        }
        return `${module}${type}${name}${suffix}`;
    }
}

//================================================================================
//== Utility functions

function isInvalidReturnType(type: Type): boolean {
    return type.kind !== TypeKind.Err && !isValidReturnType(type);
}

function isNonIntegerType(type: Type): boolean {
    return type.kind !== TypeKind.Err && type.kind !== TypeKind.Int;
}

function isUnsizedType(type: Type): boolean {
    return type.kind !== TypeKind.Err && typeLayout(type) === undefined;
}

function typeLooseEq(t1: Type, t2: Type): boolean {
    return t1.kind === TypeKind.Err || t2.kind === TypeKind.Err || typeEq(t1, t2);
}

function typeParamsEq(p1: TypeParamSym[], p2: TypeParamSym[]): boolean {
    return stream(p1).zipLongest(p2).every(([a, b]) => a && b && a === b);
}

function paramsEq(p1: FuncParamSym[], p2: FuncParamSym[]): boolean {
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
