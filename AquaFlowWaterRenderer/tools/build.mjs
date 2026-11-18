import fs from 'node:fs';
import path from 'node:path';
import { build } from '../../aquaflow/frontend/node_modules/esbuild/lib/main.js';

const root = path.resolve(import.meta.dirname, '..');
const temp = path.join(root, '.renderer-bundle.js');
await build({
  entryPoints: [path.join(root, 'src/app.js')],
  outfile: temp,
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['chrome109'],
  legalComments: 'none',
});
const template = fs.readFileSync(path.join(root, 'src/template.html'), 'utf8');
const bundle = fs.readFileSync(temp, 'utf8');
fs.unlinkSync(temp);
// Function replacement is required because bundled JavaScript can contain `$&`,
// which String.replace otherwise expands to the matched marker and corrupts code.
const output = template.replace('<!-- APP_BUNDLE -->', () => `<script>${bundle}</script>`);
fs.writeFileSync(path.join(root, 'AquaFlow Water Renderer.html'), output);
console.log(JSON.stringify({ output: path.join(root, 'AquaFlow Water Renderer.html'), bytes: Buffer.byteLength(output) }, null, 2));

