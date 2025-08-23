import { unreachable } from '../../utils';
import { Grammar, Rule } from './core';

export function* childRules(rule: Rule): Generator<Rule> {
    if (rule.kind === 'Choice') {
        for (const child of rule.rules) {
            yield child;
        }
    } else if (rule.kind === 'Sequence') {
        for (const child of rule.rules) {
            yield child;
        }
    } else if (rule.kind === 'Repeat') {
        yield rule.rule;
    } else if (rule.kind === 'Optional') {
        yield rule.rule;
    } else if (rule.kind === 'Label') {
        yield rule.rule;
    } else if (rule.kind === 'Terminal' || rule.kind === 'Nonterminal') {
        // Do nothing
    } else {
        unreachable(rule);
    }
}

export function* childRulesRec(rule: Rule): Generator<Rule> {
    for (const child of childRules(rule)) {
        yield child;
        yield* childRulesRec(child);
    }
}

export function* grammarRulesChildRulesRec(grammar: Grammar): Generator<Rule> {
    for (const rule of Object.values(grammar)) {
        yield rule;
        yield* childRulesRec(rule);
    }
}
