export type Cardinality = 'Optional' | 'Many';

export type TokenField = {
    kind: 'T';
    name: string | undefined;
    label: string | undefined;
    tokenTypes: string[];
};

export type NodeField = {
    kind: 'N';
    name: string | undefined;
    label: string | undefined;
    nodeType: string;
    cardinality: Cardinality;
};

export type Field = TokenField | NodeField;

export type AstNodeDef = {
    name: string;
    fields: Field[];
};

export type AstUnionDef = {
    name: string;
    choices: string[];
};

export type AstDef = {
    tokens: string[];
    nodes: AstNodeDef[];
    unions: AstUnionDef[];
};
