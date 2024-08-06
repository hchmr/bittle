import * as vscode from 'vscode';

export function interceptExceptions(target: unknown, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args: unknown[]) {
        try {
            return originalMethod.apply(this, args);
        } catch (error) {
            vscode.window.showErrorMessage('Uncaught exception: ' + getErrorDescription(error));
            throw error;
        }
    };

    return descriptor;
}

function getErrorDescription(error: unknown) {
    return error instanceof Error ? error.message : error;
}
