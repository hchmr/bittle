import { spawn } from 'child_process';
import * as vscode from 'vscode';

export class CompilerService {
    async compile(filePath: string) {
        console.log(`Invoking compiler for ${filePath}`);

        const cogc = vscode.workspace.getConfiguration().get<string>('cog.compilerPath', 'cogc');
        const process = spawn(
            cogc,
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

        const code = await new Promise(resolve => {
            process.on('close', code => {
                resolve(code ?? 'unknown');
            });
            process.on('error', error => {
                console.log(`Error invoking compiler: ${error}`);
                resolve('unknown');
            });
        });
        console.log(`Compiler exited with code ${code}`);

        return { ok: code == 0, stderr };
    }
}
