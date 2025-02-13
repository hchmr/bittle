import { unreachable } from '../../utils';
import { stream } from '../../utils/stream';
import { Grammar, NonterminalRule, Rule, TerminalRule } from '../grammar/core';
import { grammarRulesChildRulesRec } from '../grammar/utils';
import { FieldsBuilder } from './fieldsBuilder';
import { AstDef, AstNodeDef, AstUnionDef } from './model';

export function tryLowerUnionRule(
    unions: AstUnionDef[],
    name: string,
    rule: Rule,
): boolean {
    if (rule.kind !== 'Choice' || rule.rules.some(r => r.kind !== 'Nonterminal')) {
        return false;
    }
    unions.push({
        name,
        choices: stream(rule.rules)
            .map(r => (r as NonterminalRule).name)
            .toArray(),
    });
    return true;
}

// T (',' T)* ','?
export function tryLowerSeparatedList(
    fields: FieldsBuilder,
    rule: Rule,
): boolean {
    if (rule.kind !== 'Sequence' || !(2 <= rule.rules.length && rule.rules.length <= 3)) {
        return false;
    }

    const first = rule.rules[0];
    const middle = rule.rules[1];
    const last: Rule | undefined = rule.rules[2];
    if (first.kind !== 'Nonterminal') {
        return false;
    }
    if (middle.kind !== 'Repeat' || middle.rule.kind !== 'Sequence' || middle.rule.rules.length !== 2) {
        return false;
    }
    if (last && (last.kind !== 'Optional' || last.rule.kind !== 'Terminal')) {
        return false;
    }
    const trailingSep = last?.rule as TerminalRule | undefined;

    const [sep, repeated] = middle.rule.rules;
    if (sep.kind !== 'Terminal') {
        return false;
    }
    if (repeated.kind !== 'Nonterminal') {
        return false;
    }

    if (first.name !== repeated.name) {
        return false;
    }
    if (trailingSep && sep.name !== trailingSep.name) {
        return false;
    }

    fields.addNode(repeated.name, 'Many');
    return true;
}

export function lowerRule(
    fields: FieldsBuilder,
    rule: Rule,
) {
    if (tryLowerSeparatedList(fields, rule)) {
        return;
    }
    if (rule.kind === 'Choice') {
        for (const child of rule.rules) {
            lowerRule(fields, child);
        }
    } else if (rule.kind === 'Sequence') {
        for (const child of rule.rules) {
            lowerRule(fields, child);
        }
    } else if (rule.kind === 'Repeat') {
        const subRule = rule.rule;
        if (subRule.kind !== 'Nonterminal') {
            throw new Error(`Cannot repeat rule kind: ${subRule.kind}`);
        }
        fields.addNode(subRule.name, 'Many');
    } else if (rule.kind === 'Optional') {
        lowerRule(fields, rule.rule);
    } else if (rule.kind === 'Label') {
        fields.enterLabel(rule.name);
        lowerRule(fields, rule.rule);
        fields.leaveLabel();
    } else if (rule.kind === 'Terminal') {
        fields.addToken(rule.name);
    } else if (rule.kind === 'Nonterminal') {
        fields.addNode(rule.name, 'Optional');
    } else {
        unreachable(rule);
    }
}

export function collectTokens(grammar: Grammar): string[] {
    // TODO:
    const rules = Array.from(grammarRulesChildRulesRec(grammar));
    return stream(rules)
        .filter(rule => rule.kind === 'Terminal')
        .map(rule => rule.name)
        .distinct()
        .toArray();
}

export function lowerGrammar(grammar: Grammar): AstDef {
    const tokens = collectTokens(grammar);
    const nodes: AstNodeDef[] = [];
    const unions: AstUnionDef[] = [];

    for (const [name, nodeRule] of Object.entries(grammar)) {
        if (tryLowerUnionRule(unions, name, nodeRule)) {
            // Done
        } else {
            const fields = new FieldsBuilder();
            lowerRule(fields, nodeRule);
            const nodeDef: AstNodeDef = {
                name,
                fields: fields.build(),
            };
            nodes.push(nodeDef);
        }
    }

    return {
        tokens,
        nodes,
        unions,
    };
}
