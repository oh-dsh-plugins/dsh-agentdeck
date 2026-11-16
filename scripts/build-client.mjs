import { copyFile, mkdir } from 'node:fs/promises';
const source = new URL('../src/client/index.js', import.meta.url);
const output = new URL('../lib/client.js', import.meta.url);
await mkdir(new URL('../lib/', import.meta.url), { recursive: true });
await copyFile(source, output);
console.log('Built native Client module: lib/client.js');
