/**
 * Compiles styles/main.css -> assets/css/main.css with the Tailwind CLI.
 *
 * Called automatically by scripts/build.js, so `node scripts/build.js` always
 * produces a complete site. Tailwind scans templates/, content/ and assets/js/
 * for class names (see the @source lines in styles/main.css), which is why the
 * CSS must be built after templates change, not before.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './content.js';

const INPUT = path.join(ROOT, 'styles/main.css');
const OUTPUT = path.join(ROOT, 'assets/css/main.css');
const CLI = path.join(ROOT, 'node_modules/@tailwindcss/cli/dist/index.mjs');

/** `input`/`output` replace styles/main.css and assets/css/main.css (build.js --proposal uses its own). */
export function buildCss({ minify = true, silent = true, input = INPUT, output = OUTPUT } = {}) {
  if (!fs.existsSync(CLI)) {
    throw new Error(
      'Tailwind CLI not found. Run "npm install" first — this project needs its devDependencies to build CSS.',
    );
  }

  const args = [CLI, '--input', input, '--output', output];
  if (minify) args.push('--minify');

  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    stdio: silent ? 'pipe' : 'inherit',
  });

  if (result.status !== 0) {
    const detail = result.stderr ? result.stderr.toString().trim() : 'unknown error';
    throw new Error(`Tailwind build failed:\n${detail}`);
  }

  return { output, bytes: fs.statSync(output).size };
}
