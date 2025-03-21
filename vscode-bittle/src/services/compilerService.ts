import assert from 'assert';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { log } from '../log';
import { unreachable } from '../utils';

export class CompilerService {
    async compile(filePath: string) {
        log.log(`Invoking compiler for ${filePath}`);

        const bittlec = vscode.workspace.getConfiguration().get<string>('bittle.compilerPath', 'bittlec');

        const process = spawn(
            bittlec,
            [filePath],
            {
                stdio: ['ignore', 'ignore', 'pipe'],
                timeout: 1000,
            },
        );

        let stderr = '';
        process.stderr.on('data', data => {
            stderr += data.toString();
        });

        const code = await new Promise<number>((resolve, reject) => {
            process.on('exit', (code, signal) => {
                if (signal) {
                    log.log(`Compiler killed by signal ${signal}`);
                    reject(new Error('Compiler killed by signal ' + signal));
                } else if (typeof code === 'number') {
                    resolve(code);
                } else {
                    assert(false, 'One of the two values will always be set');
                }
            });
            process.on('error', error => {
                log.log(`Error invoking compiler: ${error}`);
                reject(new Error('Error invoking compiler: ' + error));
            });
        });
        log.log(`Compiler exited with code ${code}`);

        return { exitCode: code, stderr };
    }
}
