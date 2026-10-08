#!/usr/bin/env node
/**
 * Brings the site's own files (content, data, site.config.json) up to the
 * shape this version of the scripts expects.
 *
 *   node scripts/migrate.js
 *
 * The Twinstack web app runs it after every site update, before the update's
 * build and check. Each scripts/migrations/<id>.js runs once, in name order,
 * and is then recorded in site.config.json → updates.migrations. See
 * scripts/migrations/README.md for how to write one.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib/content.js';

const DIR = path.join(ROOT, 'scripts', 'migrations');
const CONFIG = path.join(ROOT, 'site.config.json');

const readConfig = () => JSON.parse(fs.readFileSync(CONFIG, 'utf8'));

const ids = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)).sort()
  : [];
const applied = new Set(readConfig().updates?.migrations ?? []);
const pending = ids.filter((id) => !applied.has(id));

if (!pending.length) {
  console.log('\n  Nothing to migrate.\n');
  process.exit(0);
}

for (const id of pending) {
  const { default: migrate, description } = await import(pathToFileURL(path.join(DIR, `${id}.js`)).href);
  console.log(`  ${id}${description ? ` — ${description}` : ''}`);
  const changed = await migrate(ROOT);
  // Re-read: the migration may have changed site.config.json itself.
  const config = readConfig();
  config.updates = { ...config.updates, migrations: [...(config.updates?.migrations ?? []), id] };
  fs.writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`    ${changed === false ? 'nothing to change' : 'done'}`);
}
console.log(`\n  Ran ${pending.length} migration${pending.length === 1 ? '' : 's'}.\n`);
