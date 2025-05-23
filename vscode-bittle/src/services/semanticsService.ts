import { analyzeControlFlow } from '../semantics/controlFlowAnalyzer';
import { ElaborationDiag, Elaborator, ElaboratorResult, SymReference } from '../semantics/elaborator';
import { Scope } from '../semantics/scope';
import { RecordFieldSym, Sym, SymKind } from '../semantics/sym';
import { mkErrorType, Type } from '../semantics/type';
import { SyntaxNode } from '../syntax';
import { ExprNodeTypes } from '../syntax/nodeTypes';
import { Nullish } from '../utils';
import { ReactiveCache } from '../utils/reactiveCache';
import { Stream, stream } from '../utils/stream';
import { ParsingService } from './parsingService';
import { PathResolver } from './pathResolver';

export class SemanticsService {
    constructor(
        private parsingService: ParsingService,
        private pathResolver: PathResolver,
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
        const innerScope = module.rootScope.findScopeForPosition(path, node.startPosition);
        if (!innerScope) {
            return stream([]);
        }
        return stream(function* go(scope: Scope | Nullish): Iterable<Sym> {
            if (!scope) {
                for (const [_, importedModule] of module.imports) {
                    yield * stream(getSymbolsInScope(importedModule.rootScope));
                }
                return;
            }
            yield * stream(getSymbolsInScope(scope));
            yield * go(scope.parent);
        }(innerScope));

        function getSymbolsInScope(scope: Scope): Iterable<Sym> {
            return stream(scope.symbols.values()).map(qname => module.symbols.get(qname)!);
        }
    }

    resolveSymbol(path: string, nameNode: SyntaxNode): Sym[] {
        if (isFieldName(nameNode)) {
            return this.resolveFieldName(path, nameNode);
        } else {
            return this.resolveName(path, nameNode);
        }
    }

    resolveUnambiguousSymbol(path: string, nameNode: SyntaxNode): Sym | undefined {
        const symbols = this.resolveSymbol(path, nameNode);
        return symbols.length === 1 ? symbols[0] : undefined;
    }

    private resolveFieldName(path: string, nameNode: SyntaxNode): RecordFieldSym[] {
        const module = this.elaborateFile(path);
        const qnames = module.nodeSymMap.get(nameNode) ?? [];
        return qnames
            .map(qname => module.symbols.get(qname)!)
            .filter(sym => sym.kind === SymKind.RecordField);
    }

    public resolveName(path: string, nameNode: SyntaxNode): Sym[] {
        const module = this.elaborateFile(path);
        const qnames = module.nodeSymMap.get(nameNode) ?? [];
        return qnames.map(qname => module.symbols.get(qname)!);
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
        return Elaborator.elaborate(this.parsingService, this.pathResolver, this.cache, path);
    }
}

//================================================================================
//= Helpers

function isFieldName(nameNode: SyntaxNode): boolean {
    return nameNode.parent!.type === ExprNodeTypes.FieldExpr;
}
