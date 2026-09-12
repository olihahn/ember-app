import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const client = 'dist/client';
async function list(directory, prefix = '') {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory())
      output.push(...(await list(path.join(directory, entry.name), relative)));
    else if (/\.(js|css|woff2)$/.test(entry.name)) output.push('/' + relative);
  }
  return output;
}
// Enumerating build output ensures dynamically imported app chunks are available
// on the first offline launch, even if they loaded before SW registration.
const assets = (await list(client))
  .filter((asset) => asset !== '/sw.js')
  .sort();
const hash = createHash('sha256')
  .update(assets.join('\n'))
  .digest('hex')
  .slice(0, 12);
let worker = await readFile('public/sw.js', 'utf8');
worker = worker.replace(
  "const CACHE = 'ember-shell-v1';",
  `const CACHE = 'ember-shell-${hash}';`,
);
worker = worker.replace(
  'const STATIC = [',
  `const STATIC = [${assets.map((asset) => JSON.stringify(asset)).join(',')},`,
);
await writeFile(path.join(client, 'sw.js'), worker);
console.log(
  `Offline app shell prepared with ${assets.length} versioned code assets.`,
);
