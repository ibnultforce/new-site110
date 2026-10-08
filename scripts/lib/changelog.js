/**
 * Renders CHANGELOG.md: one entry per commit made since CHANGELOG.md was
 * first generated, with the files each commit touched and how
 * (added/modified/deleted/renamed). No commit hashes — this is a plain-
 * English trail for a person to read, not a git reference; use `git log` for
 * that. It only covers history from the moment this file was first created,
 * not the whole project's past, so it stays short and relevant.
 */

import { execSync } from 'node:child_process';

const MARKER = '@@CHANGELOG-COMMIT@@';
const SINCE_PATTERN = /<!--\s*changelog-since:\s*([^\s]+)\s*-->/;
const STATUS_LABEL = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied' };

function statusLabel(code) {
  return STATUS_LABEL[code[0]] || code;
}

/** existingContent: the current CHANGELOG.md text, or null if it doesn't exist yet. */
export function generateChangelog(existingContent) {
  const sinceMatch = existingContent && SINCE_PATTERN.exec(existingContent);
  const since = sinceMatch ? sinceMatch[1] : new Date().toISOString();

  let raw;
  try {
    raw = execSync(
      `git log --first-parent --since="${since}" --date=short --name-status --pretty=format:"${MARKER}%ad|%an|%s"`,
      { encoding: 'utf8', maxBuffer: 1024 * 1024 * 32 },
    );
  } catch (error) {
    throw new Error(`git log failed: ${error.message}`);
  }

  const commits = raw
    .split(MARKER)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n');
      const [date, author, ...subjectParts] = lines[0].split('|');
      const subject = subjectParts.join('|');
      const files = lines
        .slice(1)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [status, ...rest] = line.split('\t');
          return { status: statusLabel(status), path: rest.join(' -> ') };
        });
      return { date, author, subject, files };
    });

  const header = `# Changelog

<!-- changelog-since: ${since} -->
Tracking changes committed since ${since.slice(0, 10)}. Regenerated on every
\`npm run scaffold\` — do not hand-edit, it will be overwritten. This is a
readable trail, not a rollback tool: to actually undo something, use \`git
log\` and \`git revert\`/\`git checkout\` as normal.
`;

  const body = commits.length
    ? commits
        .map(({ date, author, subject, files }) => {
          const fileLines = files.length
            ? files.map((f) => `- ${f.status}: \`${f.path}\``).join('\n')
            : '_no file changes recorded_';
          return `## ${date} — ${subject}\n\nby ${author}\n\n${fileLines}\n`;
        })
        .join('\n')
    : '_No commits recorded yet._\n';

  return `${header}\n${body}`;
}
