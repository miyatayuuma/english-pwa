import { readFile, copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { init, parse } from 'es-module-lexer';

const target = process.argv[2];
if (!['web', 'native', 'manifest'].includes(target)) throw new Error('Expected web, native, or manifest');
const native = target === 'native';
const root = fileURLToPath(new URL('../../', import.meta.url));
const destination = path.join(root, native ? 'native-web' : 'web-dist');
const manifestName = 'runtime-assets.json';
const nativeBridge = 'scripts/native/capacitor-core.js';

await init;

// Files loaded outside the static HTML/ESM/CSS graph.
const roots = [
  'index.html', 'contact.html', 'privacy.html', 'signup.html', 'terms.html',
  'manifest.webmanifest', 'scripts/version.js', 'scripts/native/nativeSpeech.js',
  'data/items.json', 'data/characters.json', 'data/reorder-v1.json',
  'data/vocabulary-v3.json', 'data/vocabulary-v2-v3-migration.json',
  'icons/icon-192.png', 'icons/icon-512.png',
  'icons/maskable-192.png', 'icons/maskable-512.png',
];
const { characters } = JSON.parse(await readFile(path.join(root, 'data/characters.json'), 'utf8'));
if (!Array.isArray(characters)) throw new Error('Unknown character data schema');
for (const profile of characters) if (profile.name) roots.push(`${profile.name}.png`);

const files = new Set();
const versionedUrls = new Set();
const sourcePath = asset => asset === nativeBridge
  ? path.join(root, 'node_modules/@capacitor/core/dist/index.js')
  : path.join(root, asset);

async function include(relativePath, search = '') {
  const normalized = path.posix.normalize(relativePath);
  if (normalized.startsWith('../') || path.isAbsolute(normalized)) throw new Error(`Unsafe asset: ${normalized}`);
  if (!native && normalized === nativeBridge) return;
  if (search) versionedUrls.add(`${normalized}${search}`);
  if (files.has(normalized)) return;
  const bytes = await readFile(sourcePath(normalized));
  files.add(normalized);
  const extension = path.extname(normalized);
  if (!['.html', '.js', '.css'].includes(extension)) return;
  const source = bytes.toString('utf8');
  const refs = [];
  if (extension === '.js') {
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
  const base = new URL(normalized, 'https://runtime.invalid/');
  for (const ref of refs) {
    if (/^(?:[a-z]+:|\/|#)/i.test(ref)) continue;
    const url = new URL(ref, base);
    await include(decodeURIComponent(url.pathname.slice(1)), url.search);
  }
}
for (const rootAsset of roots) await include(rootAsset);

if (!native) {
  const assets = [...files, ...versionedUrls].sort().map(asset => './' + asset);
  const manifest = JSON.stringify(assets, null, 2) + '\n';
  const manifestPath = path.join(root, manifestName);
  if (target === 'manifest') {
    await writeFile(manifestPath, manifest);
    console.log(`Updated ${manifestName} (${assets.length} URLs).`);
    process.exit(0);
  }
  if (await readFile(manifestPath, 'utf8') !== manifest) {
    throw new Error('runtime-assets.json is stale. Run npm run web:manifest.');
  }
  files.add(manifestName);
  files.add('sw.js');
}

await rm(destination, { recursive: true, force: true });
for (const relativePath of [...files].sort()) {
  await mkdir(path.dirname(path.join(destination, relativePath)), { recursive: true });
  await copyFile(sourcePath(relativePath), path.join(destination, relativePath));
}
console.log(`Staged ${files.size} runtime files in ${path.basename(destination)}.`);
