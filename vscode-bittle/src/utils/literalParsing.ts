export function parseString(text: string): string | undefined {
    let value = '';

    const quote = text[0];
    if (!quote) {
        return undefined;
    }

    let i = 1;
    while (true) {
        if (i >= text.length) {
            return undefined;
        }
        if (text[i] === quote) {
            if (i === text.length - 1) {
                return value;
            } else {
                return undefined;
            }
        }

        if (text[i] === '\\') {
            i++;
            switch (text[i]) {
                case '0':
                    value += '\0';
                    break;
                case '\\':
                    value += '\\';
                    break;
                case '\'':
                    value += '\'';
                    break;
                case '"':
                    value += '"';
                    break;
                case 'n':
                    value += '\n';
                    break;
                case 't':
                    value += '\t';
                    break;
                case 'r':
                    value += '\r';
                    break;
                case 'x': {
                    let code = 0;
                    for (let j = 1; j <= 2; j++) {
                        const digit = text[i + j];
                        if (!digit) {
                            return undefined;
                        }
                        const digitValue = parseInt(digit, 16);
                        if (!Number.isSafeInteger(digitValue)) {
                            return undefined;
                        }
                        code = code * 16 + digitValue;
                    }
                    value += String.fromCharCode(code);
                    i += 2;
                    break;
                }
                default: {
                    value += text[i];
                }
            }
        } else {
            value += text[i];
        }
        i++;
    }
}

export function parseChar(text: string): string | undefined {
    const value = parseString(text);
    if (!value || value.length !== 1) {
        return undefined;
    }
    return value;
}
