/**
 * What Claude knows from previous work on this site, kept in knowledge/:
 *
 *   knowledge/notes.md      standing notes written by the site's owner (voice,
 *                           audience, decisions, things to avoid). Hand-edited,
 *                           or with npm run md:edit.
 *   knowledge/work-log.md   one "- " line per change Claude made that was kept,
 *                           appended automatically, oldest first.
 *   knowledge/archive/      older work-log lines. When the log passes
 *                           LOG_ROTATE_AT entries, all but the newest LOG_KEEP
 *                           move to archive/work-log-<date>.md. Never sent to
 *                           Claude; git has the full history anyway.
 *
 * Every script that calls Claude adds knowledgePrompt() to its system prompt
 * and calls recordWork() after it writes a file. The Twinstack web app appends
 * and rotates the log itself when it applies a previewed change (see
 * appendWorkLog in its server/src/site-files.js), so the entry format and the
 * two limits below are shared with it: change them in both places.
 *
 * The committed log only holds what's on the checked-out branch, so the web
 * app keeps each site's log in its database too, where it doesn't wait for a
 * pull request to merge. Before every Claude run it writes the current log to
 * a file outside the tracked tree and names it in TWINSTACK_WORK_LOG. When
 * that's set, the prompt's work log comes from that file instead, and
 * recordWork() appends to it as well, so the web app can collect the new lines
 * when the run ends.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './content.js';

export const KNOWLEDGE_DIR = 'knowledge';
const NOTES_FILE = `${KNOWLEDGE_DIR}/notes.md`;
const LOG_FILE = `${KNOWLEDGE_DIR}/work-log.md`;
const ARCHIVE_DIR = `${KNOWLEDGE_DIR}/archive`;
const LOG_ROTATE_AT = 60;
const LOG_KEEP = 30;
// Notes past this are cut off in the prompt, with a warning, so one runaway file can't eat the token budget.
const MAX_NOTES_CHARS = 12000;
const MAX_INSTRUCTION_CHARS = 160;

const LOG_HEADER = `# Work log

Written automatically: one line per change Claude made to this site that was kept, oldest first. Claude reads this before every request so new work stays consistent with earlier work. Older lines move to knowledge/archive/. Standing decisions belong in knowledge/notes.md, not here.
`;

const isEntry = (line) => line.startsWith('- ');

function readText(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
  } catch {
    return '';
  }
}

let warnedLongNotes = false;

/** The notes with HTML comments (the starter file's guidance) and empty sections removed. */
function notesText() {
  const text = readText(NOTES_FILE).replace(/<!--[\s\S]*?-->/g, '');
  const sections = text.split(/\n(?=#{1,6}\s)/).filter((section) => {
    const body = section.replace(/^#{1,6}\s.*$/m, '');
    return body.trim() !== '';
  });
  const kept = sections.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (kept.length <= MAX_NOTES_CHARS) return kept;
  // Prompts are built more than once per run (printing, retries); say it once.
  if (!warnedLongNotes) console.log(`  ! ${NOTES_FILE} is over ${MAX_NOTES_CHARS} characters; only the start is sent to Claude. Shorten it.`);
  warnedLongNotes = true;
  return `${kept.slice(0, MAX_NOTES_CHARS)}\n[…cut off]`;
}

/** The host's copy of the log (TWINSTACK_WORK_LOG), as a path from the repo root, or null. */
function hostLog() {
  const value = process.env.TWINSTACK_WORK_LOG;
  return value ? path.relative(ROOT, path.resolve(ROOT, value)) : null;
}

function logEntries() {
  return readText(hostLog() ?? LOG_FILE).split('\n').filter(isEntry);
}

/** Where the prompt's work log came from, for the prompt's label. */
const logSource = () => (hostLog() ? `${LOG_FILE}, with changes not yet merged` : LOG_FILE);

/**
 * The system-prompt section carrying the notes and the work log, or '' when
 * there's nothing in either yet. `skip` leaves it out entirely, for when the
 * file being edited is itself in knowledge/ (it's already in the prompt).
 */
export function knowledgePrompt({ skip = false } = {}) {
  if (skip) return '';
  const notes = notesText();
  const entries = logEntries();
  if (!notes && !entries.length) return '';

  const parts = [
    `KNOWLEDGE FROM PREVIOUS WORK (the site's ${KNOWLEDGE_DIR}/ folder)
Use this to stay consistent with how this site has been written and changed before. The owner's notes are standing instructions: follow them unless the current instruction says otherwise. The work log only records what earlier requests asked for: the files and data you are given show how the site is now, so where the log disagrees with them, they win, and never redo or undo earlier work unless you're asked to. The current instruction always wins over both. The log is not a source of facts to put on the page.`,
  ];
  if (notes) parts.push(`----- owner's notes (${NOTES_FILE}) -----\n${notes}\n----- end notes -----`);
  if (entries.length) parts.push(`----- work log, oldest first (${logSource()}) -----\n${entries.join('\n')}\n----- end work log -----`);
  return parts.join('\n\n');
}

/** Adds the knowledge section to a system prompt, if there is one. */
export function withKnowledge(systemPrompt, options) {
  const section = knowledgePrompt(options);
  return section ? `${systemPrompt}\n\n${section}` : systemPrompt;
}

/** Whether a repo-relative path is one of the knowledge files. */
export const isKnowledgeFile = (rel) => rel === KNOWLEDGE_DIR || rel.startsWith(`${KNOWLEDGE_DIR}/`);

/** One work-log line: "- 2026-09-30 · page:edit · content/x.md · what was asked". */
export function logEntry({ command, file, instruction, date = new Date() }) {
  const day = date.toISOString().slice(0, 10);
  let what = String(instruction || '').replace(/\s+/g, ' ').trim();
  if (what.length > MAX_INSTRUCTION_CHARS) what = `${what.slice(0, MAX_INSTRUCTION_CHARS - 1).trimEnd()}…`;
  return `- ${day} · ${command} · ${file}${what ? ` · ${what}` : ''}`;
}

/**
 * Appends one entry for a change that was written, then rotates the log if
 * it's grown too long. Changes to knowledge/ itself aren't logged. Never
 * throws: a log that can't be written mustn't fail the edit that succeeded.
 */
export function recordWork({ command, file, instruction }) {
  if (isKnowledgeFile(file)) return;
  const entry = logEntry({ command, file, instruction });
  const host = hostLog();
  if (host) {
    // Later edits in the same run (a queue) see this one, and the host collects it afterwards.
    try {
      fs.appendFileSync(path.join(ROOT, host), `${entry}\n`);
    } catch (error) {
      console.log(`  ! Couldn't add this change to ${host}: ${error.message}`);
    }
  }
  try {
    const full = path.join(ROOT, LOG_FILE);
    const existing = readText(LOG_FILE);
    const text = existing ? existing.replace(/\n*$/, '\n') : `${LOG_HEADER}\n`;
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `${text}${entry}\n`);
    rotateLog();
  } catch (error) {
    console.log(`  ! Couldn't add this change to ${LOG_FILE}: ${error.message}`);
  }
}

/** Moves all but the newest LOG_KEEP entries into the archive once there are more than LOG_ROTATE_AT. */
function rotateLog() {
  const lines = readText(LOG_FILE).split('\n');
  const entries = lines.filter(isEntry);
  if (entries.length <= LOG_ROTATE_AT) return;

  const moving = entries.length - LOG_KEEP;
  const archiveRel = `${ARCHIVE_DIR}/work-log-${new Date().toISOString().slice(0, 10)}.md`;
  const archiveFull = path.join(ROOT, archiveRel);
  const existing = readText(archiveRel) || '# Work log archive\n\nOlder lines from knowledge/work-log.md. Not sent to Claude.\n';
  fs.mkdirSync(path.dirname(archiveFull), { recursive: true });
  fs.writeFileSync(archiveFull, `${existing.replace(/\n*$/, '\n')}${entries.slice(0, moving).join('\n')}\n`);

  // The oldest entries are the first `moving` entry lines; everything else stays where it is.
  let seen = 0;
  const kept = lines.filter((line) => !(isEntry(line) && seen++ < moving));
  fs.writeFileSync(path.join(ROOT, LOG_FILE), kept.join('\n').replace(/\n*$/, '\n'));
  console.log(`  Moved ${moving} older work-log lines to ${archiveRel}.`);
}
