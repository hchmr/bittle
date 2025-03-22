import * as vscode from 'vscode';
import { log } from '../log';

function logInvocationStarted(target: object, propertyKey: string): number {
    const className = target.constructor.name;
    const methodName = propertyKey;
    log.log(`Invoking ${className}.${methodName}`);
    return Date.now();
}

function logInvocationFinished(target: object, propertyKey: string, startTime: number) {
    const className = target.constructor.name;
    const methodName = propertyKey;
    const duration = Date.now() - startTime;
    log.log(`${className}.${methodName} completed in ${duration}ms`);
}

export function interceptExceptions(target: object, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args: unknown[]) {
        const startTime = logInvocationStarted(target, propertyKey);
        try {
            const result = originalMethod.apply(this, args);
            logInvocationFinished(target, propertyKey, startTime);
            return result;
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
        const startTime = logInvocationStarted(target, propertyKey);
        try {
            const result = await originalMethod.apply(this, args);
            logInvocationFinished(target, propertyKey, startTime);
            return result;
        } catch (error) {
            vscode.window.showErrorMessage('Uncaught exception: ' + getErrorDescription(error));
            log.log(error);
            throw error;
        }
    };

    return descriptor;
}

// Helper function to get error description
function getErrorDescription(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
