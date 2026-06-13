import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wrapperDir = resolve(root, 'wasm', 'pam-codec-wasm');

const outDir = resolve(root, 'src', 'wasm', 'pam-codec');
const args = [
  'build',
  wrapperDir,
  '--target',
  'web',
  '--release',
  '--out-dir',
  outDir,
  '--out-name',
  'pam_codec',
];

const result = spawnSync('wasm-pack', args, {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
