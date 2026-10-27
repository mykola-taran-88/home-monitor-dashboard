import { readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(path));
    else if (/\.tsx?$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) result.push(path);
  }
  return result;
}
const typedFiles = await walk(root);
const config = await stat(resolve(root, 'tsconfig.json')).then(() => true).catch(() => false);
if (typedFiles.length || config) {
  console.error('TypeScript files or tsconfig.json detected. Add an explicit TypeScript compiler/typecheck configuration before claiming typecheck coverage.');
  process.exitCode = 1;
} else {
  console.log('TypeScript typecheck not applicable: this project contains no TypeScript/TSX or tsconfig.json. JavaScript syntax/contracts are checked by `npm run lint`.');
}
