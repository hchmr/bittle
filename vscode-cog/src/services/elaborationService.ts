import { analyzeControlFlow } from '../semantics/controlFlowAnalyzer';
import { ElaborationDiag, Elaborator, ElaboratorResult, SymReference } from '../semantics/elaborator';
import { StructFieldSym, Sym, SymKind } from '../semantics/sym';
import { mkErrorType, Type, typeLayout, TypeLayout } from '../semantics/type';
import { SyntaxNode } from '../syntax';
import { ExprNodeTypes } from '../syntax/nodeTypes';
import { ReactiveCache } from '../utils/reactiveCache';
import { Stream, stream } from '../utils/stream';
import { IncludeResolver } from './IncludeResolver';
import { ParsingService } from './parsingService';

export class ElaborationService {
    constructor(
        private parsingService: ParsingService,
        private includeResolver: IncludeResolver,
        private cache: ReactiveCache,
    ) { }

    getDiagnostics(path: string): ElaborationDiag[] {
        const elaborationDiags = this.elaborateFile(path).diagnostics;
        const flowAnalysisDiags = analyzeControlFlow(
            path,
            this.parsingService.parseAsAst(path),
            this.elaborateFile(path),
        );
        return [...elaborationDiags, ...flowAnalysisDiags];
    }

    getSymbolsAtNode(path: string, node: SyntaxNode): Stream<Sym> {
        const module = this.elaborateFile(path);
        const innerScope = module.scope.findScopeForPosition(path, node.startPosition);
        if (!innerScope) {
            return stream([]);
        }
        return stream(function* go(scope): Iterable<Sym> {
            if (!scope) {
                return;
            }
            yield * stream(scope.symbols.values()).map(qname => module.symbols.get(qname)!);
            yield * go(scope.parent!);
        }(innerScope));
    }

    resolveSymbol(path: string, nameNode: SyntaxNode): Sym | undefined {
        if (isFieldName(nameNode)) {
            return this.resolveFieldName(path, nameNode);
        } else {
            return this.resolveName(path, nameNode);
        }
    }

    private resolveFieldName(path: string, nameNode: SyntaxNode): StructFieldSym | undefined {
        const module = this.elaborateFile(path);
        const qname = module.nodeSymMap.get(nameNode);
        if (!qname) {
            return;
        }
        const sym = module.symbols.get(qname)!;
        if (sym.kind !== SymKind.StructField) {
            return;
        }
        return sym;
    }

    public resolveName(path: string, nameNode: SyntaxNode): Sym | undefined {
        const module = this.elaborateFile(path);
        const qname = module.nodeSymMap.get(nameNode);
        if (!qname) {
            return;
        }
        return module.symbols.get(qname)!;
    }

    public getSymbol(path: string, qualifiedName: string): Sym | undefined {
        const module = this.elaborateFile(path);
        return module.symbols.get(qualifiedName);
    }

    inferType(path: string, exprNode: SyntaxNode): Type {
        const module = this.elaborateFile(path);
        return module.nodeTypeMap.get(exprNode) ?? mkErrorType();
    }

    evalType(path: string, node: SyntaxNode): Type {
        const module = this.elaborateFile(path);
        return module.nodeTypeMap.get(node) ?? mkErrorType();
    }

    public references(path: string, qname: string): SymReference[] {
        const module = this.elaborateFile(path);
        return module.references.get(qname) ?? [];
    }

    private elaborateFile(path: string): ElaboratorResult {
        return this.cache.compute('elaborationService:elaborateFile:' + path, () =>
            Elaborator.elaborate(this.parsingService, this.includeResolver, path),
        );
    }
}

//================================================================================
//= Helpers

function isFieldName(nameNode: SyntaxNode): boolean {
    return nameNode.parent!.type === ExprNodeTypes.FieldExpr;
}
