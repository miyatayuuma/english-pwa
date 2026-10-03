import { readFile, copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { init, parse } from 'es-module-lexer';

await init;

const root = fileURLToPath(new URL('../../', import.meta.url));
const destination = path.join(root, 'native-web');
// Runtime data is an explicit allowlist. Audit reports, generators, tests,
// repository metadata, node_modules and Android sources never enter webDir.
const roots = [
  'index.html', 'contact.html', 'privacy.html', 'signup.html', 'terms.html',
  'manifest.webmanifest', 'scripts/version.js', 'scripts/native/nativeSpeech.js',
  'data/items.json', 'data/characters.json', 'data/reorder-v1.json',
  'data/vocabulary-v3.json', 'data/vocabulary-v2-v3-migration.json',
  'icons/icon-192.png', 'icons/icon-512.png',
  'icons/maskable-192.png', 'icons/maskable-512.png',
];
const characters = JSON.parse(await readFile(path.join(root, 'data/characters.json'), 'utf8'));
const profiles = Array.isArray(characters) ? characters : characters.characters;
if (!Array.isArray(profiles)) throw new Error('Unknown character data schema');
for (const profile of profiles) if (profile.name) roots.push(`${profile.name}.png`);

const files = new Set();
const sourcePath = (asset) => asset === 'scripts/native/capacitor-core.js'
  ? path.join(root, 'node_modules/@capacitor/core/dist/index.js')
  : path.join(root, asset);
async function include(relativePath) {
  const normalized = path.posix.normalize(relativePath);
  if (normalized.startsWith('../') || path.isAbsolute(normalized)) throw new Error(`Unsafe asset: ${normalized}`);
  if (files.has(normalized)) return;
  const bytes = await readFile(sourcePath(normalized));
  files.add(normalized);
  const extension = path.extname(normalized);
  if (!['.html', '.js', '.css'].includes(extension)) return;
  const source = bytes.toString('utf8');
  const refs = [];
  if (extension === '.js') {
    // Static ESM imports/exports and literal dynamic imports. No bundling or
    // rewritten module specifiers; preserve the existing relative topology.
    const [imports] = parse(source);
    for (const dependency of imports) {
      if (dependency.d === -2) continue; // import.meta
      if (!dependency.n) throw new Error(`Nonliteral import in ${normalized}`);
      refs.push(dependency.n);
    }
  } else if (extension === '.html') {
    for (const match of source.matchAll(/(?:src|href)=["']([^"']+)["']/g)) refs.push(match[1]);
  } else {
    for (const match of source.matchAll(/url\(\s*["']?([^"'\s)]+)["']?\s*\)/g)) refs.push(match[1]);
    for (const match of source.matchAll(/@import\s*["']([^"']+)["']/g)) refs.push(match[1]);
  }
  for (const ref of refs) {
    if (/^(?:[a-z]+:|\/|#)/i.test(ref)) continue;
    const asset = decodeURIComponent(ref.split(/[?#]/)[0]);
    if (asset) await include(path.posix.join(path.posix.dirname(normalized), asset));
  }
}
for (const rootAsset of roots) await include(rootAsset);
await rm(destination, { recursive: true, force: true });
for (const relativePath of [...files].sort()) {
  await mkdir(path.dirname(path.join(destination, relativePath)), { recursive: true });
  await copyFile(sourcePath(relativePath), path.join(destination, relativePath));
}
console.log(`Staged ${files.size} runtime assets (no Service Worker, build tools or audit reports).`);
