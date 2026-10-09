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

// Claude 4.5+ Opus, 4.6+ Sonnet and the Fable models take an effort level; older ones (Haiku 4.5)
// reject it. The 5.x models think on every request, and the thinking counts toward max_tokens.
const EFFORT_MODELS = /^claude-(opus-(4-[5-8]|5)|sonnet-(4-6|5)|fable-5)/;
// Models that retry a request their safety classifiers decline on the model Anthropic recommends.
const FALLBACK_MODELS = /^claude-(opus-5|sonnet-5-5|fable-5-1)/;
// Models with the newer web search tool (it filters results before Claude reads them).
const NEW_SEARCH_MODELS = /^claude-(opus-(4-[6-8]|5)|sonnet-(4-6|5))/;

/**
 * The request fields and headers a model needs beyond the basic request: its effort level
 * ("low", "medium", "high"…) and, where the model has them, server-side refusal fallbacks.
 * edit-md.js and seo.js keep their own copy, because the Twinstack web app installs them into
 * older copies without this file.
 */
export function modelOptions(model, effort) {
  const body = {};
  const headers = {};
  if (EFFORT_MODELS.test(model)) body.output_config = { effort };
  if (FALLBACK_MODELS.test(model)) {
    body.fallbacks = 'default';
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
  }
  return { body, headers };
}

// A whole designed page plus the model's thinking about it, at high effort.
export const PAGE_MAX_TOKENS = 64000;

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
  const { text, stopReason } = await requestClaude({ apiKey, model, systemPrompt, userContent, research, maxTokens: PAGE_MAX_TOKENS, effort: 'high' });
  if (stopReason === 'refusal') throw new Error('Claude declined this request. Rephrase it and try again.');
  if (stopReason === 'max_tokens') throw new Error("Claude's reply was cut off at the token limit, so the page is incomplete.");
  return text;
}

/**
 * The same call, also returning why Claude stopped ("end_turn", "refusal",
 * or "max_tokens" when the reply was cut off). A failed request throws an Error
 * with the HTTP `status` on it. `messages` replaces the single user turn
 * with a whole conversation (for a follow-up asking Claude to correct its reply).
 * `maxTokens` must leave room for the model's thinking as well as the reply.
 * `cache` caches the request for 5 minutes: pass it when follow-ups will resend
 * it (a review or a correction), which then pay a tenth for that part. A
 * request nothing follows shouldn't, since writing the cache costs 1.25x.
 * The reply is streamed, so a long one never outlasts fetch's 5-minute wait
 * for a response.
 */
export async function requestClaude({ apiKey, model, systemPrompt, userContent, messages, research, maxTokens = 16000, effort = 'medium', cache = false }) {
  const options = modelOptions(model, effort);
  const body = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: messages || [{ role: 'user', content: userContent }],
    stream: true,
    ...(cache && { cache_control: { type: 'ephemeral' } }),
    ...options.body,
  };
  if (research) {
    const type = NEW_SEARCH_MODELS.test(model) ? 'web_search_20260209' : 'web_search_20250305';
    body.tools = [{ type, name: 'web_search', max_uses: 4 }];
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', ...options.headers },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = new Error(`Anthropic API ${response.status}: ${(await response.text()).slice(0, 400)}`);
    error.status = response.status;
    throw error;
  }

  return readStream(response);
}

/**
 * The reply text and stop reason from a streamed response (server-sent
 * events): text deltas are joined, other blocks (thinking, search results, a
 * fallback marker) are skipped. An error event mid-stream throws, with `status`
 * 529 when the API was overloaded.
 */
async function readStream(response) {
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let stopReason = null;
  const handle = (raw) => {
    const data = raw.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    const event = JSON.parse(data);
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') text += event.delta.text;
    else if (event.type === 'message_delta' && event.delta?.stop_reason) stopReason = event.delta.stop_reason;
    else if (event.type === 'error') {
      const error = new Error(`Anthropic API ${event.error?.type ?? 'error'}: ${event.error?.message ?? ''}`.trim());
      error.status = event.error?.type === 'overloaded_error' ? 529 : 500;
      throw error;
    }
  };
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
    let cut;
    while ((cut = buffer.indexOf('\n\n')) !== -1) {
      handle(buffer.slice(0, cut));
      buffer = buffer.slice(cut + 2);
    }
  }
  if (buffer.trim()) handle(buffer);
  return { text: text.trim(), stopReason };
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
