/**
 * Shared plumbing for scripts that write content with Claude
 * (scripts/scaffold-schedule.js): the API call itself, turning `images`
 * fields into real vision input, and the validation/cleanup every
 * generated page goes through before it's trusted.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './content.js';

// ANTHROPIC_BASE_URL (the SDKs' variable) points at a proxy or a local mock.
export const API_URL = `${(process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '')}/v1/messages`;

const MEDIA_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Turns each `images[]` entry into { ref, block }: `ref` is the path/URL the
 * generated markdown should use as the image src, `block` is the vision
 * content block that lets Claude actually see it (null if it couldn't be
 * read, in which case the ref is still usable as a plain reference).
 *
 * An `http(s)://` entry is sent to Claude as a URL image source. Anything
 * else is treated as a path into this repo (with or without a leading "/",
 * e.g. "assets/img/x.jpg" or "/assets/img/x.jpg"), read from disk and sent
 * as base64. SVGs and anything over 5MB are skipped for vision but still
 * usable as a reference, since the file itself is fine to link to.
 */
export function resolveImages(images = []) {
  const resolved = [];
  for (const raw of images) {
    const entry = String(raw || '').trim();
    if (!entry) continue;

    if (/^https?:\/\//i.test(entry)) {
      resolved.push({ ref: entry, block: { type: 'image', source: { type: 'url', url: entry } } });
      continue;
    }

    const relative = path.posix.normalize(entry.replace(/\\/g, '/').replace(/^\/+/, ''));
    const absolute = path.join(ROOT, relative);
    const publicRef = `/${relative}`;

    // Paths come from hand-written markdown too, so they must stay inside the repo.
    if (relative.startsWith('../') || relative === '..' || relative.split('/')[0] === '.git') {
      console.log(`  ! image "${entry}" — outside the site's files, skipped entirely`);
      continue;
    }
    const ext = path.extname(relative).toLowerCase();
    const mediaType = MEDIA_TYPES[ext];

    if (!fs.existsSync(absolute)) {
      console.log(`  ! image "${entry}" — file not found at ${path.relative(ROOT, absolute)}, skipped entirely`);
      continue;
    }
    if (!mediaType) {
      console.log(`  ! image "${entry}" — ${ext || 'no extension'} isn't readable as vision input, used as a reference only`);
      resolved.push({ ref: publicRef, block: null });
      continue;
    }
    if (fs.statSync(absolute).size > MAX_IMAGE_BYTES) {
      console.log(`  ! image "${entry}" — over 5MB, too large for vision, used as a reference only`);
      resolved.push({ ref: publicRef, block: null });
      continue;
    }

    const data = fs.readFileSync(absolute).toString('base64');
    resolved.push({ ref: publicRef, block: { type: 'image', source: { type: 'base64', media_type: mediaType, data } } });
  }
  return resolved;
}

export function stripFence(text) {
  const fenced = text.match(/^```[a-z]*\n([\s\S]*)\n```$/);
  return fenced ? fenced[1] : text;
}

/**
 * userContent may be a plain string (text-only) or an array of Anthropic
 * content blocks (e.g. text + image blocks for vision).
 */
export async function callClaude({ apiKey, model, systemPrompt, userContent, research }) {
  const { text } = await requestClaude({ apiKey, model, systemPrompt, userContent, research, maxTokens: 4000 });
  return text;
}

/**
 * The same call, also returning why Claude stopped ("end_turn", or
 * "max_tokens" when the reply was cut off). A failed request throws an Error
 * with the HTTP `status` on it. `messages` replaces the single user turn
 * with a whole conversation (for a follow-up asking Claude to correct its reply).
 */
export async function requestClaude({ apiKey, model, systemPrompt, userContent, messages, research, maxTokens = 4000 }) {
  const body = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: messages || [{ role: 'user', content: userContent }],
  };
  if (research) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }];

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = new Error(`Anthropic API ${response.status}: ${(await response.text()).slice(0, 400)}`);
    error.status = response.status;
    throw error;
  }

  const payload = await response.json();
  const text = payload.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  return { text, stopReason: payload.stop_reason ?? null };
}

/** Strips any root-relative markdown link that doesn't match a real URL,
 * keeping the link text. Returns the cleaned body and what was removed. */
export function stripBrokenLinks(text, internalUrls) {
  const removed = [];
  let cleaned = text;
  const links = [...text.matchAll(/\[([^\]]+)\]\((\/[^)\s]*)\)/g)];
  for (const [full, label, href] of links) {
    const normalised = href.endsWith('/') || href.includes('.') ? href : `${href}/`;
    if (!internalUrls.includes(normalised)) {
      removed.push(href);
      cleaned = cleaned.replace(full, label);
    }
  }
  return { cleaned, removed };
}

const BANNED_PHRASES = [/let's dive in/i, /in today's fast-paced/i, /game.?changer/i, /unlock the power/i];

export function bannedPhraseWarnings(text) {
  return BANNED_PHRASES.filter((pattern) => pattern.test(text)).map((pattern) => `contains banned phrase: ${pattern.source}`);
}
