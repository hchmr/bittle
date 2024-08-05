import { stream } from './stream';

export class FuzzyMatcher {
    private readonly regex: RegExp;

    constructor(query: string) {
        this.regex
        = new RegExp(
                stream(query)
                    .map(letter => `\\u{${letter.charCodeAt(0).toString(16)}}`)
                    .join('.*'),
                'iu',
            );
    }

    test(text: string): boolean {
        return this.regex.test(text);
    }
}
