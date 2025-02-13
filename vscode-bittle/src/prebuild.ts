import * as fs from 'fs';
import * as path from 'path';
import { emitAstDef } from './syntax/generator';
import { lowerGrammar } from './syntax/generator/lowering';
import { grammar } from './syntax/grammar';

const outputPath = path.join(path.dirname(__filename), 'syntax/generated.ts');

const lower = lowerGrammar(grammar);
const text = emitAstDef(lower).trimEnd() + '\n';
fs.writeFileSync(outputPath, text);
console.log(`Wrote AST definition to ${outputPath}`);
