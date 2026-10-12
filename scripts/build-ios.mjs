import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(projectRoot, 'public');
const outputDir = path.join(projectRoot, 'ios-web');
const apiBaseUrl = (process.env.IOS_API_URL || 'https://huddlepickem.com').replace(/\/$/, '');

if (!/^https:\/\/[^/]+/i.test(apiBaseUrl)) {
  throw new Error('IOS_API_URL must be an HTTPS URL.');
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await cp(publicDir, outputDir, { recursive: true });

await writeFile(
  path.join(outputDir, 'runtime-config.js'),
  `window.HUDDLE_CONFIG = Object.freeze(${JSON.stringify({ apiBaseUrl, nativeApp: true }, null, 2)});\n`,
);

await build({
  absWorkingDir: projectRoot,
  entryPoints: ['./scripts/ios/native-auth.ts'],
  outfile: 'ios-web/native-auth.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'safari15',
  minify: true,
});

const indexPath = path.join(outputDir, 'index.html');
let indexHtml = await readFile(indexPath, 'utf8');
const appScript = /(<script type="module" src="\/app\.js[^>]*><\/script>)/;

if (!appScript.test(indexHtml)) {
  throw new Error('Could not find the app script in public/index.html.');
}

indexHtml = indexHtml.replace(appScript, '<script src="/native-auth.js"></script>\n    $1');
await writeFile(indexPath, indexHtml);

console.log(`Built iOS web assets for ${apiBaseUrl}`);
