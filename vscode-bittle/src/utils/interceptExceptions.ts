import * as vscode from 'vscode';
import { log } from '../log';

export function interceptExceptions(target: unknown, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args: unknown[]) {
        try {
            return originalMethod.apply(this, args);
        } catch (error) {
            vscode.window.showErrorMessage('Uncaught exception: ' + getErrorDescription(error));
            log.log(error);
            throw error;
        }
    };

    return descriptor;
}

export function interceptExceptionsAsync(target: unknown, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
        try {
            return await originalMethod.apply(this, args);
        } catch (error) {
            vscode.window.showErrorMessage('Uncaught exception: ' + getErrorDescription(error));
            log.log(error);
            throw error;
        }
    };

    return descriptor;
}

function getErrorDescription(error: unknown) {
    return error instanceof Error ? error.message : error;
}
