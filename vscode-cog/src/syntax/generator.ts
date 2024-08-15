import { AstDef, Field } from './generator/model';

function renderString(s: string): string {
    return '\'' + s.replace(/'/g, '\\\'') + '\'';
}

function renderTokenChoice(names: string[]): string {
    return names.map(renderString).join(' | ');
}

function renderFieldType(field: Field): string {
    if (field.kind === 'T') {
        return `TokenNode<${renderTokenChoice(field.tokenTypes)}> | undefined`;
    } else if (field.kind === 'N') {
        if (field.cardinality === 'Many') {
            return `${field.nodeType}Node[]`;
        } else {
            return `${field.nodeType}Node | undefined`;
        }
    } else {
        const unreachable: never = field;
        throw new Error(`Unknown field type kind: ${unreachable}`);
    }
}

export function emitAstDef(astDef: AstDef) {
    let text = '';
    function println(line: string = '') {
        text += line + '\n';
    }
    function section(title: string) {
        println('//' + '='.repeat(78));
        println(`//== ${title}`);
        println();
    }

    println(`/* eslint-disable @stylistic/lines-between-class-members */`);
    println(`import { AstNode, TokenNode } from './ast';`);
    println(`import { SyntaxNode } from './tree';`);
    println();

    // Node types

    section('Node types');
    println(`export enum AstNodeTypes {`);
    for (const node of astDef.nodes) {
        println(`    ${node.name} = '${node.name}',`);
    }
    println(`}`);
    println();

    println(`export type AstNodeType = AstNodeTypes[keyof AstNodeTypes];`);
    println();

    // AST nodes

    for (const node of astDef.nodes) {
        println(`export class ${node.name}Node extends AstNode {`);
        for (const field of node.fields) {
            emitField(field);
        }
        println(`}`);
    }

    // Union types

    section('Union types');
    for (const { name, choices } of astDef.unions) {
        println(`export enum ${name}NodeTypes {`);
        for (const choice of choices) {
            println(`    ${choice} = '${choice}',`);
        }
        println(`};`);
        println();
        println(`export type ${name}Node =${choices.map(c => `\n    | ${c}Node`).join('')};`);
        println();
    }

    // fromSyntaxNode

    println(`export function fromSyntaxNode(syntax: SyntaxNode): AstNode {`);
    println(`    switch (syntax.type) {`);
    for (const node of astDef.nodes) {
        println(`        case AstNodeTypes.${node.name}: return new ${node.name}Node(syntax);`);
    }
    println(`        default: throw new Error('Unknown node type: ' + syntax.type);`);
    println(`    }`);
    println(`}`);
    println();

    return text;

    function emitField(field: Field) {
        println(`    get ${field.name}(): ${renderFieldType(field)} {`);
        if (field.kind === 'T') {
            println(`        return this.getTokenOfType(${fenderLabelArg(field.label)}, ${renderTokenGetArgs(field.tokenTypes)});`);
        } else if (field.kind === 'N') {
            if (field.cardinality === 'Many') {
                println(`        return this.getAstNodesOfType<${field.nodeType}Node>(${fenderLabelArg(field.label)}, ${renderNodeGetArgs(field.nodeType)});`);
            } else {
                println(`        return this.getAstNodeOfType<${field.nodeType}Node>(${fenderLabelArg(field.label)}, ${renderNodeGetArgs(field.nodeType)});`);
            }
        } else {
            const unreachable: never = field;
            throw new Error(`Unknown field type kind: ${unreachable}`);
        }
        println(`    }`);
    }

    function fenderLabelArg(label: string | undefined): string {
        return label ? renderString(label) : 'undefined';
    }

    function renderTokenGetArgs(types: string[]): string {
        return `[${types.map(renderString).join(', ')}]`;
    }

    function renderNodeGetArgs(type: string): string {
        if (isUnionType(type)) {
            return `[${astDef.unions.find(u => u.name === type)!.choices.map(c => `'${c}'`).join(', ')}]`;
        } else {
            return `['${type}']`;
        }
    }

    function isUnionType(name: string): boolean {
        return astDef.unions.some(u => u.name === name);
    }
}
