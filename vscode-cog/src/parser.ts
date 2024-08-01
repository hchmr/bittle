import { Parser, ErrorSink, tokenize } from './syntax';

export const parser = {
    parse: (text: string, errorSink?: ErrorSink) => {
        errorSink ??= {
            add() { },
        };
        return new Parser(text, tokenize(text, errorSink), errorSink).top();
    },
};
