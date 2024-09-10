import * as vscode from 'vscode';

const renderArg = (arg: unknown) => {
    if (typeof arg === 'object') {
        return JSON.stringify(arg, null, 2)
            .replace(/,\n /g, ', ')
            .replace(/\n */g, '');
    } else {
        return `${arg}`;
    }
};

export const log = {
    outputChannel: vscode.window.createOutputChannel('Bittle'),
    log: (...args: unknown[]) => {
        console.log(...args);
        if (log.outputChannel) {
            log.outputChannel.appendLine([...args].map(renderArg).join(' '));
        }
    },
};
