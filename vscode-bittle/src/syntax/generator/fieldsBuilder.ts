import assert from 'assert';
import { unreachable } from '../../utils';
import { stream } from '../../utils/stream';
import { Cardinality, Field } from './model';
import { nodeNameToFieldName, pluralize, tokenNameToFieldName } from './naming';

export function generateFieldName(kind: 'T' | 'N', cardinality: Cardinality, types: string[]): string {
    return maybePluralize(generate());

    function generate() {
        if (kind === 'T') {
            if (types.length !== 1) {
                throw new Error(`Cannot generate field name for token choice: ${types.join(', ')}`);
            }
            return tokenNameToFieldName(types[0]);
        } else if (kind === 'N') {
            return nodeNameToFieldName(types[0]);
        } else {
            unreachable(kind);
        }
    }

    function maybePluralize(name: string): string {
        return cardinality === 'Many' ? pluralize(name) : name;
    }
}

export type PartialField = {
    kind: 'T' | 'N';
    name: string | undefined;
    label: string | undefined;
    cardinality: Cardinality | undefined;
    types: Set<string>; // Node or token types
};

export class FieldsBuilder {
    private fields: PartialField[] = [];

    private currentLabel: string | undefined = undefined;

    enterLabel(label: string) {
        if (this.currentLabel !== undefined) {
            throw new Error(`Cannot nest labels: ${this.currentLabel} and ${label}`);
        }
        if (this.fields.some(f => f.label === label)) {
            throw new Error(`Duplicate label: ${label}`);
        }
        this.currentLabel = label;
    }

    leaveLabel() {
        this.currentLabel = undefined;
    }

    private addField(kind: 'T' | 'N', type: string, cardinality: Cardinality) {
        const label = this.currentLabel;
        if (label) {
            const existing = this.fields.find(f => f.label === label);
            if (existing) {
                if (existing.kind == 'T' && kind == 'T') {
                    existing.types.add(type);
                } else if (existing.kind == 'N' && kind == 'N') {
                    throw new Error(`Don't know how to handle multiple nodes in the same label`);
                } else {
                    throw new Error(`Cannot mix different kinds in the same label`);
                }
            } else {
                this.fields.push({
                    kind,
                    name: label,
                    label,
                    cardinality,
                    types: new Set([type]),
                });
            }
        } else {
            const existing = this.fields.find(f => f.kind === kind && f.types.has(type));
            if (existing) {
                if (existing.label) {
                    // A named field already exists for this type
                } else {
                    existing.cardinality = undefined; // Unknown
                }
            } else {
                this.fields.push({
                    kind,
                    name: undefined,
                    label: undefined,
                    cardinality,
                    types: new Set([type]),
                });
            }
        }
    }

    addToken(name: string) {
        this.addField('T', name, 'Optional');
    }

    addNode(name: string, cardinality: Cardinality) {
        this.addField('N', name, cardinality);
    }

    build(): Field[] {
        const explicitlyNamedTypes = stream(this.fields)
            .filter(f => f.label !== undefined)
            .flatMap(f => f.types)
            .toSet();

        const fields = stream(this.fields)
            .filter(f => f.label ?? stream(f.types).some(t => !explicitlyNamedTypes.has(t)))
            .map(({ kind, name, label, cardinality, types }) => {
                cardinality ??= 'Optional';
                name = label ?? generateFieldName(kind, cardinality, [...types]);
                if (kind === 'T') {
                    assert(cardinality === 'Optional');
                    return { kind, name, label, tokenTypes: [...types] };
                } else {
                    return { kind, name, label, nodeType: [...types][0], cardinality: cardinality };
                }
            })
            .toArray();

        const conflicts = stream(fields)
            .groupBy(f => f.name)
            .filter(g => g[1].length > 1)
            .map(g => g[0])
            .toArray();
        if (conflicts.length > 0) {
            throw new Error(`Name conflicts: ${conflicts.join(', ')}`);
        }

        return fields;
    }
}
