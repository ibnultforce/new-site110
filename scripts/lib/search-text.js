/**
 * Search text (the SEO title, description and focus keyphrase) for a page as it's created:
 * scripts/edit-page.js gives it a page's first real content (a skeleton or draft written for the
 * first time, an HTML page brought in), and scripts/scaffold-schedule.js every page it writes.
 *
 * The Twinstack web app's cheaper model (TWINSTACK_FAST_MODEL) writes it with the rules of
 * lib/seo.js (the same as scripts/seo.js --claude), and the page's own model takes over when its
 * result still has issues, errors or is declined. Only the fields the page doesn't have yet are
 * set (and a missing or placeholder description), and a page kept out of search engines (noindex)
 * gets none. Without a cheaper model nothing
 * is added: the owner writes it on request (seo.js --claude, the web app's search settings).
 */

import path from 'node:path';
import { requestClaude } from './claude-writer.js';
import { loadSite } from './content.js';
import { knowledgePrompt } from './knowledge.js';
import { isPlaceholder, searchTextPrompts, setFrontmatterFields, writeSearchText } from './seo.js';

const FIELDS = ['metaTitle', 'metaDescription', 'focusKeyword'];
// Room for a thinking model's reasoning as well as the short JSON reply.
const MAX_TOKENS = 8000;

const missing = (page, field) => !String(page[field] ?? '').trim();

/**
 * `content` (the page file `relFile`, repo-relative, as it's about to be written) with its missing
 * search text added. The file must exist (the site is read with `content` in its place), so a
 * brand-new page is written first. Resolves to null when there's nothing to do (no cheaper model
 * or key, not a content page, noindex, or it already has a title and description), else
 * { content, fields (what was set), model, fellBack, issues }. Throws when no model could write it.
 */
export async function addSearchText({ relFile, content, apiKey, model, fastModel = process.env.TWINSTACK_FAST_MODEL || '', log = () => {} }) {
  if (!apiKey || !fastModel || !relFile.startsWith('content/') || !relFile.endsWith('.md')) return null;
  const siteModel = loadSite({ includeDrafts: true, includeFuture: true, overrides: new Map([[relFile, content]]) });
  const page = siteModel.all.find((p) => p.sourceFile.split(path.sep).join('/') === relFile);
  if (!page) throw new Error(`${relFile} isn't one of the site's pages (is it in a collection's folder, and written yet?)`);
  if (page.noindex === true) return null;
  if (!missing(page, 'metaTitle') && !missing(page, 'metaDescription')) return null;

  const keepKeyword = !missing(page, 'focusKeyword');
  const prompts = searchTextPrompts({ page, all: siteModel.all, site: siteModel.site, source: content, file: relFile, keepKeyword });
  const knowledge = knowledgePrompt();
  const result = await writeSearchText({
    request: ({ systemPrompt, messages, model: useModel }) => requestClaude({ apiKey, model: useModel, systemPrompt, messages, maxTokens: MAX_TOKENS }),
    fastModel,
    model,
    systemPrompt: knowledge ? `${prompts.systemPrompt}\n\n${knowledge}` : prompts.systemPrompt,
    userPrompt: prompts.userPrompt,
    page,
    all: siteModel.all,
    site: siteModel.site,
    keepKeyword,
    log,
  });
  if (!result.fields) throw new Error(`no usable search text came back (${result.issues.join(' ')})`);

  const fields = {};
  for (const field of FIELDS) if (missing(page, field) && result.fields[field]) fields[field] = result.fields[field];
  // The page's own description shows in listings and is the search description's fallback: a
  // missing or placeholder one ("Under 160 characters, …" from the skeleton) takes the new one.
  if (fields.metaDescription && (missing(page, 'description') || isPlaceholder(page.description))) fields.description = fields.metaDescription;
  return { content: setFrontmatterFields(content, fields), fields, model: result.model, fellBack: result.fellBack, issues: result.issues };
}
