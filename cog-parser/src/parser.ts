import assert from 'assert';
import { CompositeNodeKind, namedTokenKinds } from './compositeNodeKind.js';
import { Token, TokenKind } from './token.js';
import { Point, Tree } from './tree.js';
import { CompositeNodeImpl, MissingTokenNodeImpl, pointEqual, SyntaxNodeImpl, TokenNodeImpl, TreeImpl } from './tree/impl.js';
import { ErrorSink } from './ErrorSink.js';

//=========================================================================
//== Node building

type SyntaxNodeChild = {
    field?: string;
    node: SyntaxNodeImpl;
};

type IncompleteCompositeNode = {
    kind: CompositeNodeKind;
    children: SyntaxNodeChild[];
    currentField?: string;
    startPosition: Point;
    startIndex: number;
};

type IncompleteNode =
    | IncompleteCompositeNode;

function tokenToSyntaxNode(tree: Tree, token: Token): SyntaxNodeImpl {
    return new TokenNodeImpl(tree, token, namedTokenKinds[token.kind]);
}

function missingTokenNode(kind: TokenKind, tree: Tree, startPosition: Point, startIndex: number): SyntaxNodeImpl {
    return new MissingTokenNodeImpl(kind, startPosition, startIndex, tree);
}

function incompleteNodeToSyntaxNode(tree: Tree, node: IncompleteNode): SyntaxNodeImpl {
    return new CompositeNodeImpl(
        node.kind,
        true,
        node.startPosition,
        node.startIndex,
        tree,
        node.children,
    );
}

type Checkpoint = {
    index: number;
    parent: IncompleteCompositeNode;
    startPosition: Point;
    startIndex: number;
};

abstract class NodeBuilder {
    protected currentNodes: IncompleteNode[];

    constructor(
        protected tree: TreeImpl,
        startNode: IncompleteNode,
    ) {
        this.currentNodes = [startNode];
    }

    abstract get pos(): Point;

    abstract get index(): number;

    get currentNode() {
        return this.currentNodes[this.currentNodes.length - 1];
    }

    set currentNode(node: IncompleteNode) {
        this.currentNodes[this.currentNodes.length - 1] = node;
    }

    addChild(node: SyntaxNodeImpl) {
        this.currentNode.children.push({
            node,
            field: this.currentNode.currentField,
        });
    }

    addChildren(nodes: SyntaxNodeImpl[]) {
        for (const node of nodes) {
            this.addChild(node);
        }
    }

    beginNode(nodeType: CompositeNodeKind) {
        this.currentNodes.push(<IncompleteCompositeNode>{
            isPlaceholder: false,
            kind: nodeType,
            children: [],
            startPosition: this.pos,
            startIndex: this.index,
        });
    }

    beginNodeAt(nodeType: CompositeNodeKind, checkpoint: Checkpoint | undefined) {
        if (!checkpoint) {
            this.beginNode(nodeType);
            return;
        }

        assert(checkpoint.parent === this.currentNode);

        const groupedNodes = this.currentNode.children.splice(checkpoint.index, this.currentNode.children.length - checkpoint.index);
        this.currentNodes.push(<IncompleteCompositeNode>{
            isPlaceholder: false,
            kind: nodeType,
            children: groupedNodes,
            startPosition: checkpoint.startPosition,
            startIndex: checkpoint.startIndex,
        });
    }

    finishNode(nodeType: CompositeNodeKind) {
        if (nodeType !== this.currentNode.kind) {
            throw new Error(`Expected node of type ${nodeType}, got ${this.currentNode.kind}`);
        }
        const node = this.currentNodes.pop()!;
        this.addChild(incompleteNodeToSyntaxNode(this.tree, node));
    }

    beginField(fieldName: string) {
        if (this.currentNode.currentField) {
            throw new Error(`Already in field ${this.currentNode.currentField}`);
        }
        this.currentNode.currentField = fieldName;
    }

    finishField(fieldName: string) {
        if (!this.currentNode.currentField) {
            throw new Error(`Not in a field`);
        }
        if (this.currentNode.currentField !== fieldName) {
            throw new Error(`Expected field ${fieldName}, got ${this.currentNode.currentField}`);
        }
        this.currentNode.currentField = undefined;
    }

    createCheckpoint(): Checkpoint {
        return {
            index: this.currentNode.children.length,
            parent: this.currentNode,
            startPosition: this.pos,
            startIndex: this.index,
        };
    }

    // For grouping existing children of a node that was created before the type was known
    groupExistingChildren(fieldName: string) {
        this.currentNode.children.forEach((child, index) => {
            child.field = fieldName;
        });
    }
}

class ParserBase extends NodeBuilder {
    tok: Token;
    lastErrorPosition: Point = { row: -1, column: -1 };

    constructor(
        text: string,
        protected tokens: Iterator<Token, Token>,
        protected errorSink: ErrorSink,
    ) {
        const token = tokens.next().value;
        assert(token);

        super(
            new TreeImpl(text, null!),
            {
                kind: CompositeNodeKind.Root,
                children: [],
                startPosition: token.startPosition,
                startIndex: token.startIndex,
            },
        );

        this.tok = token;
    }

    get isAtEnd() {
        return this.tok.kind === '<eof>';
    }

    override get pos() {
        return this.tok.startPosition;
    }

    override get index() {
        return this.tok.startIndex;
    }

    match(kind: TokenKind): boolean;
    match(kinds: TokenKindSet): boolean;
    match(test: (kind: TokenKind) => boolean): boolean;
    match(test: TokenKind | TokenKindSet | ((kind: TokenKind) => boolean)): boolean {
        if (typeof test === 'function') {
            return test(this.tok.kind);
        } else if (test instanceof TokenKindSet) {
            return test.has(this.tok.kind);
        } else {
            return this.tok.kind === test;
        }
    }

    bump(assertedToken?: TokenKind) {
        if (assertedToken) {
            assert(this.tok.kind === assertedToken);
        }
        this.addChild(tokenToSyntaxNode(this.tree, this.tok));
        this.tok = this.tokens.next().value!;
    }

    addError(position: Point, message: string) {
        if (pointEqual(position, this.lastErrorPosition)) {
            return;
        }
        this.errorSink.add({ position, message });
        this.lastErrorPosition = position;
    }

    addErrorAndTryBump(message: string, { set: recoverySet }: { set: TokenKindSet } = { set: defaultRecovery }) {
        this.addError(this.pos, message);

        if (recoverySet.has(this.tok.kind)) {
            return;
        }

        this.beginNode(CompositeNodeKind.Error);
        this.bump();
        this.finishNode(CompositeNodeKind.Error);
    }

    addErrorAndBump(message: string) {
        this.addErrorAndTryBump(message, { set: emptyRecovery });
    }

    expect(tokenKind: TokenKind) {
        if (!this.match(tokenKind)) {
            this.addError(this.pos, `Expected '${tokenKind}', got '${this.tok.kind}' while parsing ${this.currentNode.kind}`);
            this.addChild(missingTokenNode(tokenKind, this.tree, this.pos, this.index));
            return false;
        }
        this.bump();
        return true;
    }

    delimited(open: TokenKind, close: TokenKind, sep: TokenKind, p: () => void) {
        this.bump(open);
        while (!this.match(close)) {
            const startIndex = this.index;

            if (this.match(sep)) {
                this.addErrorAndBump(`Unexpected '${sep}'.`);
                continue;
            }
            p();
            if (!this.match(close)) {
                this.expect(sep);
            }

            // No progress
            if (this.index === startIndex) {
                break;
            }
        }
        this.expect(close);
    }
}

export class Parser extends ParserBase {
    //=========================================================================
    // Entry point

    top(): Tree {
        while (!this.isAtEnd) {
            this.topLevelDecl();
        }
        assert(this.tok.kind === '<eof>');
        this.addChild(tokenToSyntaxNode(this.tree, this.tok));

        assert(this.currentNodes.length === 1);
        assert(this.currentNode.kind === CompositeNodeKind.Root);
        this.tree.rootNode = incompleteNodeToSyntaxNode(this.tree, this.currentNode);
        return this.tree;
    }

    //=========================================================================
    // Top-level declarations

    topLevelDecl() {
        if (this.match('include')) {
            this.includeDecl();
        } else if (this.match('enum')) {
            this.enumDecl();
        } else if (this.match('struct')) {
            this.structDecl();
        } else if (this.match('func')) {
            this.funcDecl();
        } else if (this.match('var')) {
            this.globalDecl();
        } else if (this.match('const')) {
            this.constDecl();
        } else if (this.match('extern')) {
            this.externDecl();
        } else {
            this.addErrorAndBump(`Unexpected start of top-level declaration: '${this.tok.kind}'.`);
        }
    }

    externDecl() {
        const checkpoint = this.createCheckpoint();
        this.bump('extern');
        if (this.match('func')) {
            this.funcDecl(checkpoint);
        } else if (this.match('var')) {
            this.globalDecl(checkpoint);
        } else {
            this.addErrorAndTryBump(`Expected 'func' or 'var' after 'extern'.`);
        }
    }

    includeDecl() {
        this.beginNode(CompositeNodeKind.IncludeDecl);
        this.bump('include');
        this.beginField('path');
        this.expect('string_literal');
        this.finishField('path');
        this.expect(';');
        this.finishNode(CompositeNodeKind.IncludeDecl);
    }

    enumDecl() {
        this.beginNode(CompositeNodeKind.EnumDecl);
        this.bump('enum');
        if (!this.match('{')) {
            this.addErrorAndTryBump(`Expected enum body.`);
        }
        if (this.match('{')) {
            this.beginField('body');
            this.enumBody();
            this.finishField('body');
        }
        this.finishNode(CompositeNodeKind.EnumDecl);
    }

    enumBody() {
        this.beginNode(CompositeNodeKind.EnumBody);
        this.delimited('{', '}', ',', () => this.enumMember());
        this.finishNode(CompositeNodeKind.EnumBody);
    }

    enumMember() {
        if (!this.match('identifier') && !this.match('=')) {
            this.addErrorAndTryBump(`Expected enum member.`);
            return;
        }
        this.beginNode(CompositeNodeKind.EnumMember);
        this.beginField('name');
        this.bump('identifier');
        this.finishField('name');
        if (this.match('=')) {
            this.expect('=');
            this.beginField('value');
            this.expr();
            this.finishField('value');
        }
        this.finishNode(CompositeNodeKind.EnumMember);
    }

    structDecl() {
        this.beginNode(CompositeNodeKind.StructDecl);
        this.bump('struct');
        this.beginField('name');
        this.expect('identifier');
        this.finishField('name');
        if (!this.match('{') && !this.match(';')) {
            this.addErrorAndTryBump(`Expected struct body.`);
        }
        if (this.match(';')) {
            this.bump(';');
        } else if (this.match('{')) {
            this.beginField('body');
            this.structBody();
            this.finishField('body');
        }
        this.finishNode(CompositeNodeKind.StructDecl);
    }

    structBody() {
        this.beginNode(CompositeNodeKind.StructBody);
        this.delimited('{', '}', ',', () => this.structMember());
        this.finishNode(CompositeNodeKind.StructBody);
    }

    structMember() {
        if (!this.match('identifier') && !this.match(':')) {
            this.addErrorAndTryBump(`Expected struct member.`);
            return;
        }
        this.beginNode(CompositeNodeKind.StructMember);
        this.beginField('name');
        this.expect('identifier');
        this.finishField('name');
        this.expect(':');
        this.beginField('type');
        this.type();
        this.finishField('type');
        this.finishNode(CompositeNodeKind.StructMember);
    }

    funcDecl(checkpoint?: Checkpoint) {
        this.beginNodeAt(CompositeNodeKind.FuncDecl, checkpoint);
        this.bump('func');
        this.beginField('name');
        this.expect('identifier');
        this.finishField('name');
        this.beginField('params');
        this.paramList();
        this.finishField('params');
        if (this.match(':')) {
            this.expect(':');
            this.beginField('return_type');
            this.type();
            this.finishField('return_type');
        }
        if (!this.match('{') && !this.match(';')) {
            this.addErrorAndTryBump(`Expected function body or ';'`);
        }
        if (this.match(';')) {
            this.bump(';');
        } else if (this.match(stmtFirst)) {
            this.beginField('body');
            this.blockStmt();
            this.finishField('body');
        }
        this.finishNode(CompositeNodeKind.FuncDecl);
    }

    private paramList() {
        if (!this.match('(')) {
            this.addErrorAndTryBump(`Expected parameter list.`);
        }
        if (this.match('(')) {
            this.delimited('(', ')', ',', () => this.funcParam());
        }
    }

    private funcParam() {
        if (this.match('...')) {
            this.bump('...');
        } else {
            this.paramDecl();
        }
    }

    paramDecl() {
        if (!this.match('identifier') && !this.match(':')) {
            this.addErrorAndTryBump(`Expected parameter.`);
            return;
        }
        this.beginNode(CompositeNodeKind.FuncParam);
        this.beginField('name');
        this.expect('identifier');
        this.finishField('name');
        this.expect(':');
        this.beginField('type');
        this.type();
        this.finishField('type');
        this.finishNode(CompositeNodeKind.FuncParam);
    }

    globalDecl(checkpoint?: Checkpoint) {
        this.beginNodeAt(CompositeNodeKind.GlobalDecl, checkpoint);
        this.expect('var');
        this.beginField('name');
        this.expect('identifier');
        this.finishField('name');
        this.expect(':');
        this.beginField('type');
        this.type();
        this.finishField('type');
        this.expect(';');
        this.finishNode(CompositeNodeKind.GlobalDecl);
    }

    constDecl() {
        this.beginNode(CompositeNodeKind.ConstDecl);
        this.bump('const');
        this.beginField('name');
        this.expect('identifier');
        this.finishField('name');
        this.expect('=');
        this.beginField('value');
        this.expr();
        this.finishField('value');
        this.expect(';');
        this.finishNode(CompositeNodeKind.ConstDecl);
    }

    //=========================================================================
    // Statements

    stmt() {
        if (this.match('var')) {
            this.varStmt();
        } else if (this.match('{')) {
            this.blockStmt();
        } else if (this.match('if')) {
            this.ifStmt();
        } else if (this.match('while')) {
            this.whileStmt();
        } else if (this.match('return')) {
            this.returnStmt();
        } else if (this.match('break')) {
            this.breakStmt();
        } else if (this.match('continue')) {
            this.continueStmt();
        } else if (this.match(exprFirst)) {
            this.exprStmt();
        } else {
            this.addErrorAndTryBump(`Unexpected start of statement: '${this.tok.kind}'.`, { set: stmtRecovery });
        }
    }

    varStmt() {
        this.beginNode(CompositeNodeKind.VarStmt);
        this.bump('var');
        this.beginField('name');
        this.expect('identifier');
        this.finishField('name');
        if (this.match(':')) {
            this.expect(':');
            this.beginField('type');
            this.type();
            this.finishField('type');
        }
        if (this.match('=')) {
            this.expect('=');
            this.beginField('value');
            this.expr();
            this.finishField('value');
        }
        this.expect(';');
        this.finishNode(CompositeNodeKind.VarStmt);
    }

    blockStmt() {
        this.beginNode(CompositeNodeKind.BlockStmt);
        this.expect('{');
        while (!this.match('}')) {
            const startIndex = this.index;

            this.stmt();

            if (this.index === startIndex) {
                break;
            }
        }
        this.expect('}');
        this.finishNode(CompositeNodeKind.BlockStmt);
    }

    ifStmt() {
        this.beginNode(CompositeNodeKind.IfStmt);
        this.bump('if');
        this.expect('(');
        this.beginField('cond');
        this.expr();
        this.finishField('cond');
        this.expect(')');
        this.beginField('then');
        this.stmt();
        this.finishField('then');
        if (this.match('else')) {
            this.bump('else');
            this.beginField('else');
            this.stmt();
            this.finishField('else');
        }
        this.finishNode(CompositeNodeKind.IfStmt);
    }

    whileStmt() {
        this.beginNode(CompositeNodeKind.WhileStmt);
        this.bump('while');
        this.expect('(');
        this.beginField('cond');
        this.expr();
        this.finishField('cond');
        this.expect(')');
        this.beginField('body');
        this.stmt();
        this.finishField('body');
        this.finishNode(CompositeNodeKind.WhileStmt);
    }

    returnStmt() {
        this.beginNode(CompositeNodeKind.ReturnStmt);
        this.bump('return');
        if (!this.match(';')) {
            this.beginField('value');
            this.expr();
            this.finishField('value');
        }
        this.expect(';');
        this.finishNode(CompositeNodeKind.ReturnStmt);
    }

    breakStmt() {
        this.beginNode(CompositeNodeKind.BreakStmt);
        this.bump('break');
        this.expect(';');
        this.finishNode(CompositeNodeKind.BreakStmt);
    }

    continueStmt() {
        this.beginNode(CompositeNodeKind.ContinueStmt);
        this.bump('continue');
        this.expect(';');
        this.finishNode(CompositeNodeKind.ContinueStmt);
    }

    exprStmt() {
        this.beginNode(CompositeNodeKind.ExprStmt);
        this.beginField('expr');
        this.expr();
        this.finishField('expr');
        this.expect(';');
        this.finishNode(CompositeNodeKind.ExprStmt);
    }

    //=========================================================================
    // Expressions

    expr(minBp = 0) {
        const checkpoint = this.createCheckpoint();

        const nud = nudTable[this.tok.kind];
        if (!nud) {
            this.addErrorAndTryBump(`Unexpected start of expression: '${this.tok.kind}'.`, { set: exprRecovery });
            return;
        }
        nud.apply(this);

        let maxBp = Number.POSITIVE_INFINITY;
        while (true) {
            const led = ledTable[this.tok.kind];
            if (!led || led.lbp < minBp || led.lbp > maxBp) {
                break;
            }
            led.apply(this, checkpoint);
            maxBp = led.nbp;
        }
    }

    groupExpr() {
        this.beginNode(CompositeNodeKind.GroupExpr);
        this.bump('(');
        this.expr();
        this.expect(')');
        this.finishNode(CompositeNodeKind.GroupExpr);
    }

    nameExpr() {
        this.beginNode(CompositeNodeKind.NameExpr);
        this.bump('identifier');
        this.finishNode(CompositeNodeKind.NameExpr);
    }

    literalExpr() {
        this.beginNode(CompositeNodeKind.LiteralExpr);
        this.literal();
        this.finishNode(CompositeNodeKind.LiteralExpr);
    }

    unaryExpr(op: TokenKind) {
        this.beginNode(CompositeNodeKind.UnaryExpr);
        this.beginField('operator');
        this.bump(op);
        this.finishField('operator');
        this.beginField('operand');
        this.expr();
        this.finishField('operand');
        this.finishNode(CompositeNodeKind.UnaryExpr);
    }

    sizeofExpr() {
        this.beginNode(CompositeNodeKind.SizeofExpr);
        this.bump('sizeof');
        this.beginField('expr');
        this.expr();
        this.finishField('expr');
        this.finishNode(CompositeNodeKind.SizeofExpr);
    }

    binaryExpr(op: TokenKind, rbp: number, checkpoint: Checkpoint) {
        this.beginNodeAt(CompositeNodeKind.BinaryExpr, checkpoint);
        this.groupExistingChildren('left');
        this.beginField('operator');
        this.expect(op);
        this.finishField('operator');
        this.beginField('right');
        this.expr(rbp);
        this.finishField('right');
        this.finishNode(CompositeNodeKind.BinaryExpr);
    }

    ternaryExpr(rbp: number, checkpoint: Checkpoint) {
        this.beginNodeAt(CompositeNodeKind.TernaryExpr, checkpoint);
        this.groupExistingChildren('condition');
        this.expect('?');
        this.beginField('then');
        this.expr(rbp);
        this.finishField('then');
        this.expect(':');
        this.beginField('else');
        this.expr(rbp);
        this.finishField('else');
        this.finishNode(CompositeNodeKind.TernaryExpr);
    }

    callExpr(checkpoint: Checkpoint) {
        this.beginNodeAt(CompositeNodeKind.CallExpr, checkpoint);
        this.groupExistingChildren('callee');
        this.beginField('args');
        this.delimited('(', ')', ',', () => this.expr());
        this.finishField('args');
        this.finishNode(CompositeNodeKind.CallExpr);
    }

    indexExpr(checkpoint: Checkpoint) {
        this.beginNodeAt(CompositeNodeKind.IndexExpr, checkpoint);
        this.groupExistingChildren('indexee');
        this.expect('[');
        this.beginField('index');
        this.expr();
        this.finishField('index');
        this.expect(']');
        this.finishNode(CompositeNodeKind.IndexExpr);
    }

    memberExpr(checkpoint: Checkpoint) {
        this.beginNodeAt(CompositeNodeKind.FieldExpr, checkpoint);
        this.groupExistingChildren('left');
        this.expect('.');
        this.beginField('name');
        this.expect('identifier');
        this.finishField('name');
        this.finishNode(CompositeNodeKind.FieldExpr);
    }

    castExpr(checkpoint: Checkpoint) {
        this.beginNodeAt(CompositeNodeKind.CastExpr, checkpoint);
        this.groupExistingChildren('expr');
        this.expect('as');
        this.beginField('type');
        this.type();
        this.finishField('type');
        this.finishNode(CompositeNodeKind.CastExpr);
    }

    //=========================================================================
    // Types

    type() {
        if (this.match('(')) {
            this.groupType();
        } else if (this.match('identifier')) {
            this.nameType();
        } else if (this.match('*')) {
            this.pointerType();
        } else if (this.match('[')) {
            this.arrayType();
        } else {
            this.addErrorAndTryBump(`Unexpected start of type: '${this.tok.kind}'.`);
        }
    }

    groupType() {
        this.beginNode(CompositeNodeKind.GroupType);
        this.bump('(');
        this.beginField('type');
        this.type();
        this.finishField('type');
        this.expect(')');
        this.finishNode(CompositeNodeKind.GroupType);
    }

    nameType() {
        this.beginNode(CompositeNodeKind.NameType);
        this.bump('identifier');
        this.finishNode(CompositeNodeKind.NameType);
    }

    pointerType() {
        this.beginNode(CompositeNodeKind.PointerType);
        this.bump('*');
        this.beginField('pointee');
        this.type();
        this.finishField('pointee');
        this.finishNode(CompositeNodeKind.PointerType);
    }

    arrayType() {
        this.beginNode(CompositeNodeKind.ArrayType);
        this.bump('[');
        this.beginField('type');
        this.type();
        this.finishField('type');
        this.expect(';');
        this.beginField('size');
        this.expr();
        this.finishField('size');
        this.expect(']');
        this.finishNode(CompositeNodeKind.ArrayType);
    }

    //=========================================================================
    // Literals

    literal() {
        if (this.match('number_literal')) {
            this.intLiteral();
        } else if (this.match('string_literal')) {
            this.stringLiteral();
        } else if (this.match('char_literal')) {
            this.charLiteral();
        } else if (this.match('null')) {
            this.nullLiteral();
        } else if (this.match('true') || this.match('false')) {
            this.boolLiteral();
        } else {
            throw new Error('Expected literal');
        }
    }

    intLiteral() {
        this.beginNode(CompositeNodeKind.IntLiteral);
        this.bump('number_literal');
        this.finishNode(CompositeNodeKind.IntLiteral);
    }

    stringLiteral() {
        this.beginNode(CompositeNodeKind.StringLiteral);
        this.bump('string_literal');
        this.finishNode(CompositeNodeKind.StringLiteral);
    }

    charLiteral() {
        this.beginNode(CompositeNodeKind.CharLiteral);
        this.bump('char_literal');
        this.finishNode(CompositeNodeKind.CharLiteral);
    }

    nullLiteral() {
        this.beginNode(CompositeNodeKind.NullLiteral);
        this.bump('null');
        this.finishNode(CompositeNodeKind.NullLiteral);
    }

    boolLiteral() {
        this.beginNode(CompositeNodeKind.BoolLiteral);
        this.bump(this.match('true') ? 'true' : 'false');
        this.finishNode(CompositeNodeKind.BoolLiteral);
    }

}

//=========================================================================/
//== Pratt parsing primitives

// Null denotation
type Nud = {
    apply(parser: Parser): void;
};

// Left denotation
type Led = {
    apply(parser: Parser, checkpoint: Checkpoint): void;
    // Left binding power
    lbp: number;
    // Right binding power
    rbp: number;
    // Next binding power
    nbp: number;
};

enum Assoc {
    Left,
    Right,
    None,
}

const Prec = {
    Assign: 1,
    Cond: 2,
    CondOr: 3,
    CondAnd: 4,
    BitOr: 5,
    BitXor: 6,
    BitAnd: 7,
    Cmp: 8,
    Shift: 9,
    Add: 10,
    Mul: 11,
    Cast: 12,
    Unary: 13,
    Postfix: 14,
    Primary: 15,
};

const nudTable: Record<TokenKind, Nud> = (function () {
    return createTable(
        mkRow('(', parser => parser.groupExpr()),
        mkRow('identifier', parser => parser.nameExpr()),
        ...(['number_literal', 'string_literal', 'char_literal', 'null', 'true', 'false'] as const)
            .map(kind => mkRow(kind, parser => parser.literalExpr())),
        ...(['-', '~', '!', '&', '*'] as const)
            .map(op => mkUnaryOp(op)),
        mkRow('sizeof', parser => parser.sizeofExpr()),
    );

    type TableRow = {
        token: TokenKind;
        nud: Nud;
    };

    function createTable(...entries: TableRow[]): Record<TokenKind, Nud> {
        return Object.fromEntries(
            entries.map(entry => [entry.token, entry.nud]),
        ) as Record<TokenKind, Nud>;
    }

    function mkRow(token: TokenKind, apply: (parser: Parser) => void): TableRow {
        return {
            token,
            nud: { apply },
        };
    }

    function mkUnaryOp(kind: TokenKind): TableRow {
        return mkRow(kind, parser => parser.unaryExpr(kind));
    }
}());

const ledTable: Record<TokenKind, Led> = (function () {
    return createTable(
        ...(['=', '+=', '-='] as const).map(op => mkBinaryOp(op, Prec.Assign, Assoc.Right)),
        mkRow('?', Prec.Cond, Assoc.Right, (parser, led, checkpoint) => parser.ternaryExpr(led.rbp, checkpoint)),
        mkBinaryOp('?', Prec.Cond, Assoc.Right),
        mkBinaryOp('||', Prec.CondOr, Assoc.Left),
        mkBinaryOp('&&', Prec.CondAnd, Assoc.Left),
        mkBinaryOp('|', Prec.BitOr, Assoc.Left),
        mkBinaryOp('^', Prec.BitXor, Assoc.Left),
        mkBinaryOp('&', Prec.BitAnd, Assoc.Left),
        ...(['==', '!=', '<', '<=', '>', '>='] as const).map(op => mkBinaryOp(op, Prec.Cmp, Assoc.Left)),
        ...(['<<', '>>'] as const).map(op => mkBinaryOp(op, Prec.Shift, Assoc.Left)),
        ...(['+', '-'] as const).map(op => mkBinaryOp(op, Prec.Add, Assoc.Left)),
        ...(['*', '/', '%'] as const).map(op => mkBinaryOp(op, Prec.Mul, Assoc.Left)),
        mkRow('as', Prec.Cast, Assoc.Left, (parser, _, checkpoint) => parser.castExpr(checkpoint)),
        mkRow('.', Prec.Postfix, Assoc.Left, (parser, _, checkpoint) => parser.memberExpr(checkpoint)),
        mkRow('(', Prec.Postfix, Assoc.Left, (parser, _, checkpoint) => parser.callExpr(checkpoint)),
        mkRow('[', Prec.Postfix, Assoc.Left, (parser, _, checkpoint) => parser.indexExpr(checkpoint)),
    );

    type TableRow = {
        token: TokenKind;
        led: Led;
    };

    function createTable(...entries: TableRow[]): Record<TokenKind, Led> {
        return Object.fromEntries(
            entries.map(entry => [entry.token, entry.led]),
        ) as Record<TokenKind, Led>;
    }

    function mkRow(token: TokenKind, lbp: number, assoc: Assoc, invoke: (parser: Parser, led: Led, checkpoint: Checkpoint) => void): TableRow {
        const led: Led = {
            lbp,
            rbp: calculateRbp(lbp, assoc),
            nbp: calculateNbp(lbp, assoc),
            apply: (parser, checkpoint) => invoke(parser, led, checkpoint),
        };
        return { token, led };
    }

    function mkBinaryOp(op: TokenKind, lbp: number, assoc: Assoc): TableRow {
        return mkRow(op, lbp, assoc, (parser, led, checkpoint) => parser.binaryExpr(op, led.rbp, checkpoint));
    }

    function calculateRbp(lbp: number, assoc: Assoc): number {
        return assoc === Assoc.Right ? lbp : lbp + 1;
    }

    function calculateNbp(lbp: number, assoc: Assoc): number {
        return assoc === Assoc.None ? lbp - 1 : lbp;
    }
}());

//=========================================================================
//== Recovery

class TokenKindSet implements Iterable<TokenKind> {
    private set: Set<TokenKind>;

    constructor(...tokens: TokenKind[]);
    constructor(tokens: Iterable<TokenKind>);
    constructor(...args: [Iterable<TokenKind>] | TokenKind[]) {
        this.set = typeof args[0] === 'object'
            ? new Set(args[0] as Iterable<TokenKind>)
            : new Set(args as TokenKind[]);
        assert([...this.set].every(kind => typeof kind === 'string'));
    }

    has(kind: TokenKind) {
        return this.set.has(kind);
    }

    [Symbol.iterator]() {
        return this.set[Symbol.iterator]();
    }

    union(...kinds: TokenKind[]): TokenKindSet;
    union(kinds: Iterable<TokenKind>): TokenKindSet;
    union(...args: [Iterable<TokenKind>] | TokenKind[]) {
        const sequence = typeof args[0] === 'object'
            ? args[0]
            : args as TokenKind[];
        return new TokenKindSet(...this.set, ...sequence);
    }

    except(...kinds: TokenKind[]): TokenKindSet;
    except(kinds: Iterable<TokenKind>): TokenKindSet;
    except(...args: [Iterable<TokenKind>] | TokenKind[]) {
        const set = typeof args[0] === 'object'
            ? new Set(args[0] as Iterable<TokenKind>)
            : new Set(args as TokenKind[]);
        assert([...this.set].every(kind => typeof kind === 'string'));
        return this.filter(kind => !set.has(kind));
    }

    filter(predicate: (token: TokenKind) => boolean) {
        return new TokenKindSet([...this.set].filter(predicate));
    }
}

// First sets

const topLevelFirst = new TokenKindSet('include', 'enum', 'struct', 'func', 'var', 'const', 'extern');

const exprFirst = new TokenKindSet(...Object.keys(nudTable) as TokenKind[]);

const stmtFirst = new TokenKindSet('var', '{', 'if', 'while', 'return', 'break', 'continue', ...exprFirst);

// Recovery sets

const onlyTopLevel = topLevelFirst.except('var', 'const');

const emptyRecovery = new TokenKindSet();

const defaultRecovery = onlyTopLevel.union('{', '}');

const exprRecovery = defaultRecovery.union(')', ']', ';');

const stmtRecovery = defaultRecovery;
