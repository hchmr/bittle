import * as vscode from 'vscode';
import { log } from '../log';

function logInvocation(target: object, propertyKey: string) {
    const className = target.constructor.name;
    const methodName = propertyKey;
    log.log(`Invoking ${className}.${methodName}`);
}

export function interceptExceptions(target: object, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args: unknown[]) {
        logInvocation(target, propertyKey);
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

export function interceptExceptionsAsync(target: object, propertyKey: string, descriptor: PropertyDescriptor) {
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
