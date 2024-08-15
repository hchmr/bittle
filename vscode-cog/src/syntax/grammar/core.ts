export type ChoiceRule = { kind: 'Choice'; rules: Rule[] };

export type SequenceRule = { kind: 'Sequence'; rules: Rule[] };

export type RepeatRule = { kind: 'Repeat'; rule: Rule };

export type OptionalRule = { kind: 'Optional'; rule: Rule };

export type LabelRule = { kind: 'Label'; name: string; rule: Rule };

export type TerminalRule = { kind: 'Terminal'; name: string };

export type NonterminalRule = { kind: 'Nonterminal'; name: string };

export type Rule
    = ChoiceRule
    | SequenceRule
    | RepeatRule
    | OptionalRule
    | LabelRule
    | TerminalRule
    | NonterminalRule
    ;

export type Grammar = Record<string, Rule>;

export type Dollar = Record<string, Rule>;

export type GrammarSpec = Record<string, ($: Dollar) => Rule>;

export type RuleShortcut = string | Rule;

function fromRuleShortcut(rule: RuleShortcut): Rule {
    return typeof rule === 'string' ? terminal(rule) : rule;
}

function fromRuleShortcuts(rules: RuleShortcut[]): Rule[] {
    return rules.map(fromRuleShortcut);
}

export function choice(...rules: RuleShortcut[]): ChoiceRule {
    return { kind: 'Choice', rules: fromRuleShortcuts(rules) };
}

export function seq(...rules: RuleShortcut[]): SequenceRule {
    return { kind: 'Sequence', rules: fromRuleShortcuts(rules) };
}

export function repeat(rule: RuleShortcut): RepeatRule {
    return { kind: 'Repeat', rule: fromRuleShortcut(rule) };
}

export function optional(rule: RuleShortcut): OptionalRule {
    return { kind: 'Optional', rule: fromRuleShortcut(rule) };
}

export function label(name: string, rule: RuleShortcut): LabelRule {
    return { kind: 'Label', name, rule: fromRuleShortcut(rule) };
}

export function terminal(name: string): TerminalRule {
    return { kind: 'Terminal', name };
}

export function nonterminal(name: string): NonterminalRule {
    return { kind: 'Nonterminal', name };
}

export function sepEndBy1(rule: Rule, sep: string): Rule {
    return seq(
        rule,
        repeat(
            seq(
                sep,
                rule,
            ),
        ),
        optional(sep),
    );
}

export function sepEndBy(rule: Rule, sep: string): Rule {
    return optional(sepEndBy1(rule, sep));
}

export function guardedObject<T extends Record<string, Rule>>(obj: T): T {
    return new Proxy(obj, {
        get(target, prop, receiver) {
            if (prop in target) {
                return Reflect.get(target, prop, receiver);
            } else {
                throw new Error(`Unknown nonterminal: ${String(prop)}`);
            }
        },
    });
}

export function createGrammar(spec: GrammarSpec): Grammar {
    const $: Dollar = guardedObject(Object.fromEntries(
        Object.entries(spec).map(([name, _]) => [name, nonterminal(name)]),
    ));
    return Object.fromEntries(
        Object.entries(spec).map(([name, rule]) => [name, rule($)]),
    );
}
