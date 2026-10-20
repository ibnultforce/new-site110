import fs from 'node:fs';
import path from 'node:path';

export const description = 'add phone, address and opening hours to the contact details';

const FIELDS = ['phone', 'address', 'hours'];

// Sites made before these fields existed can't fill them in from the web app, which only saves
// fields the file already has. Adds each missing one empty, after email, keeping every other value.
export default async function migrate(root) {
  const file = path.join(root, 'site.config.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  const contact = config.contact;
  if (!contact || typeof contact !== 'object' || Array.isArray(contact)) return false;
  const missing = FIELDS.filter((key) => !(key in contact));
  if (!missing.length) return false;

  const next = {};
  for (const [key, value] of Object.entries(contact)) {
    next[key] = value;
    if (key === 'email') for (const field of missing) next[field] = '';
  }
  for (const field of missing) if (!(field in next)) next[field] = '';
  config.contact = next;
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return true;
}
