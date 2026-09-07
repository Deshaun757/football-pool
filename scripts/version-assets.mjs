import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';

// Change asset URLs whenever their contents change, including across deployments.
const publicDirectory = new URL('../public/', import.meta.url);
const names = ['styles.css', 'app.js', 'legal.css', 'support.js', 'huddle-icon.svg'];
const versions = new Map(await Promise.all(names.map(async name => [name,
  createHash('sha256').update(await readFile(new URL(name, publicDirectory))).digest('hex').slice(0,16),
])));
for (const name of await readdir(publicDirectory)) {
  if (!name.endsWith('.html')) continue;
  const path = new URL(name, publicDirectory);
  const original = await readFile(path, 'utf8');
  const updated = original.replace(/(href|src)="\/(styles\.css|app\.js|legal\.css|support\.js|huddle-icon\.svg)(?:\?v=[^"]*)?"/g,
    (_match, attribute, asset) => `${attribute}="/${asset}?v=${versions.get(asset)}"`);
  if (updated !== original) await writeFile(path, updated);
}
