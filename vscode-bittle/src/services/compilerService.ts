import { spawn } from 'child_process';
import fs from 'fs';
import * as vscode from 'vscode';
import { log } from '../log';

export class CompilerService {
    async compile(filePath: string) {
        log.log(`Invoking compiler for ${filePath}`);

        const bittlec = vscode.workspace.getConfiguration().get<string>('bittle.compilerPath', 'bittlec');

        if (!fs.existsSync(bittlec)) {
            log.log(`Compiler not found at ${bittlec}`);
            return { ok: false, stderr: `Compiler not found at ${bittlec}` };
        }

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

        const code = await new Promise((resolve, reject) => {
            process.on('close', code => {
                resolve(code ?? 'unknown');
            });
            process.on('error', error => {
                log.log(`Error invoking compiler: ${error}`);
                reject(new Error('Error invoking compiler: ' + error));
            });
        });
        log.log(`Compiler exited with code ${code}`);

        return { ok: code == 0, stderr };
    }
}
