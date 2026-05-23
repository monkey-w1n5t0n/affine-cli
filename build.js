/**
 * build.js
 * Build script
 *
 * Steps:
 * 1. Clean dist directory
 * 2. Bundle with esbuild into a single file
 * 3. Inject version number
 */

import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));

// 1. Clean dist directory
console.log('🧹 Cleaning dist directory...');
try {
	rmSync('dist', { recursive: true, force: true });
} catch {}

// 2. Create output directory
mkdirSync('dist', { recursive: true });

// 3. Type check
console.log('🔍 Type checking...');
try {
	execSync('tsc --noEmit -p tsconfig.json', { stdio: 'inherit' });
} catch (e) {
	console.log('❌ Type check failed, aborting build');
	process.exit(1);
}

// 4. Bundle with esbuild
console.log('📦 Bundling...');
await esbuild.build({
	entryPoints: ['src/index.ts'],
	bundle: true,
	platform: 'node',
	format: 'esm',
	outfile: 'dist/index.js',
	minify: false,
	sourcemap: false,
	target: 'node18',
	external: ['socket.io-client', 'yjs', 'form-data', 'fractional-indexing', 'markdown-it', 'nanoid', 'node-fetch', 'undici']
});

// 5. Inject version number
console.log('🏷️ Injecting version number...');
const version = pkg.version;
const content = readFileSync('dist/index.js', 'utf-8').replace(
	/%%VERSION%%/g,
	version
);
writeFileSync('dist/index.js', content);

console.log(`✅ Build complete, version: ${version}`);
