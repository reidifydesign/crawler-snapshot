// Rewrite the crawler list inside the examples from data/crawlers.json.
//   node scripts/sync-examples.mjs          write the files
//   node scripts/sync-examples.mjs --check  exit 1 if a file is out of date (used by the tests)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { formatAgents } from '../src/agents.js';

const FILES = [
  {
    path: new URL('../examples/netlify-edge-function.js', import.meta.url),
    block: () => `const CRAWLERS = /${formatAgents('regex')}/i;`,
  },
  {
    path: new URL('../examples/nginx.conf', import.meta.url),
    block: () => formatAgents('nginx'),
  },
];

/** Returns the file text with the BEGIN/END block regenerated. */
export function syncText(text, block) {
  const re = /(^.*BEGIN CRAWLERS\r?\n)[\s\S]*?(\r?\n.*END CRAWLERS)/m;
  if (!re.test(text)) throw new Error('BEGIN CRAWLERS / END CRAWLERS markers not found');
  return text.replace(re, (_, a, b) => `${a}${block()}${b}`);
}

export function outOfDate() {
  return FILES.filter((f) => {
    const text = readFileSync(f.path, 'utf8');
    return syncText(text, f.block) !== text;
  }).map((f) => fileURLToPath(f.path));
}

if (process.argv[1] && process.argv[1].endsWith('sync-examples.mjs')) {
  if (process.argv.includes('--check')) {
    const stale = outOfDate();
    if (stale.length) {
      console.error(`Out of date:\n${stale.join('\n')}`);
      process.exit(1);
    }
    console.log('Examples are in step with data/crawlers.json.');
  } else {
    for (const f of FILES) writeFileSync(f.path, syncText(readFileSync(f.path, 'utf8'), f.block));
    console.log('Examples updated.');
  }
}
