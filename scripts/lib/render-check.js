/**
 * Renders a page imported with --keep-styles next to its original in headless
 * Chrome or Chromium and compares them, so a conversion is tested before
 * anyone looks at it. Zero dependencies: it talks to the browser over the
 * DevTools protocol with Node's built-in WebSocket (Node 22+).
 *
 * Both sides are standalone documents written to the system temp folder:
 *   original   the old page minus what the conversion removes on purpose
 *              (header, footer, navigation, scripts), with all its own CSS;
 *   converted  the site's compiled stylesheet, the imported stylesheet and the
 *              copied body, inside <main> as the site renders it.
 * Neither runs scripts, so script-driven states (a scroll reveal) are compared
 * in their finished, visible form. Each width is one pass: every element's box
 * and computed style, its ::before/::after, and the forced :hover state of
 * elements the CSS gives one.
 *
 * The browser is found from CHROME_PATH, then the usual install locations and
 * PATH. Without one the check is skipped and says why.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const RENDER_WIDTHS = [1280, 768, 390];
const TIMEOUT_MS = 90000;

/** A Chrome or Chromium executable, or null. */
export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome']) candidates.push(path.join(dir, name));
  }
  return candidates.find((c) => c && fs.existsSync(c)) || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Starts the browser and returns a small DevTools client for one page. */
async function launch(executable) {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twinstack-render-'));
  const port = 9400 + Math.floor(Math.random() * 500);
  const browser = spawn(executable, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files', `--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`, 'about:blank',
  ], { stdio: 'ignore' });
  const close = () => {
    try { browser.kill(); } catch {}
    setTimeout(() => fs.rmSync(userDir, { recursive: true, force: true }), 1500).unref();
  };
  let ws;
  for (let i = 0; i < 75 && !ws; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page');
      if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
    } catch {}
    if (!ws) await sleep(200);
  }
  if (!ws) {
    close();
    throw new Error("the browser didn't start");
  }
  if (ws.readyState !== WebSocket.OPEN) await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) listeners.forEach((fn) => fn(msg));
  });
  const send = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description || 'evaluation failed');
    return res.result?.result?.value;
  };
  const once = (method) => new Promise((resolve) => listeners.push((msg) => msg.method === method && resolve(msg)));
  await send('Page.enable');
  await send('DOM.enable');
  await send('CSS.enable');
  return { send, evaluate, once, close: () => { try { ws.close(); } catch {} close(); } };
}

const PROPS = ['color', 'backgroundColor', 'backgroundImage', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing',
  'textAlign', 'textTransform', 'textDecorationLine', 'display', 'opacity', 'transform', 'boxShadow', 'borderTopWidth', 'borderTopStyle',
  'borderTopColor', 'borderLeftWidth', 'borderRadius', 'position', 'zIndex', 'overflowX', 'listStyleType', 'animationName', 'cursor', 'filter', 'textWrap'];
const PSEUDO = ['content', 'display', 'position', 'width', 'height', 'top', 'left', 'backgroundColor', 'backgroundImage', 'borderTopWidth',
  'borderTopStyle', 'borderRadius', 'transform', 'opacity', 'color', 'fontSize', 'boxSizing'];
const HOVER = ['transform', 'boxShadow', 'borderTopColor', 'backgroundColor', 'color', 'paddingLeft', 'opacity', 'textDecorationLine'];

/** Every element under `rootSelector`, in document order, with its box (relative to the root) and computed style. */
function snapshotScript(rootSelector) {
  return `(() => {
    const root = document.querySelector(${JSON.stringify(rootSelector)});
    if (!root) return null;
    const base = root.getBoundingClientRect();
    const pick = (cs, list) => Object.fromEntries(list.map((p) => [p, cs[p]]));
    const all = [...root.querySelectorAll('*')];
    return all.map((el, i) => {
      const r = el.getBoundingClientRect();
      const out = { i, tag: el.tagName.toLowerCase(), cls: (el.getAttribute('class') || '').replace(/(^|\\s)imp-/g, '$1'),
        text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40),
        x: Math.round(r.left - base.left), y: Math.round(r.top - base.top), w: Math.round(r.width), h: Math.round(r.height),
        ...pick(getComputedStyle(el), ${JSON.stringify(PROPS)}) };
      for (const p of ['::before', '::after']) {
        const cs = getComputedStyle(el, p);
        if (cs.content && cs.content !== 'none' && cs.content !== 'normal') out[p] = pick(cs, ${JSON.stringify(PSEUDO)});
      }
      return out;
    });
  })()`;
}

async function loadAndSnapshot(client, url, width, rootSelector, hoverClasses) {
  await client.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
  const loaded = client.once('Page.loadEventFired');
  await client.send('Page.navigate', { url });
  await Promise.race([loaded, sleep(20000)]);
  await client.evaluate(`Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 8000))]).then(() => true)`);
  // Settle every animation and transition at the same moment on both sides.
  await client.evaluate(`(() => { document.getAnimations().forEach(a => { try { a.pause(); a.currentTime = 0; } catch {} }); return true; })()`);
  const elements = await client.evaluate(snapshotScript(rootSelector));
  if (!elements) return { elements: [], hover: {} };

  // Forced :hover on the first element of each class the CSS gives a hover state.
  const hover = {};
  const { root } = await client.send('DOM.getDocument', { depth: 0 }).then((r) => r.result);
  for (const cls of hoverClasses.slice(0, 25)) {
    const selector = `${rootSelector} .${cls}, ${rootSelector} .imp-${cls}`;
    const found = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    const nodeId = found.result?.nodeId;
    if (!nodeId) continue;
    await client.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
    await client.evaluate(`(() => { document.getAnimations().forEach(a => { try { a.finish(); } catch {} }); return true; })()`);
    hover[cls] = await client.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const cs = getComputedStyle(el);
      const kids = [...el.querySelectorAll('*')].slice(0, 5).map(k => { const c = getComputedStyle(k); return [c.color, c.transform, c.backgroundColor].join(' | '); });
      return { ...Object.fromEntries(${JSON.stringify(HOVER)}.map(p => [p, cs[p]])), before: getComputedStyle(el, '::before').transform, kids }; })()`);
    await client.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
  }
  return { elements, hover };
}

const norm = (v) => (typeof v === 'string' ? v.replace(/-?\d+\.\d+/g, (n) => Number(n).toFixed(1)) : v);
const same = (a, b) => JSON.stringify(a, (k, v) => norm(v)) === JSON.stringify(b, (k, v) => norm(v));

/** Human-readable differences between two snapshots, most telling first. */
function compare(original, converted) {
  const found = [];
  if (original.elements.length !== converted.elements.length) {
    found.push(`${original.elements.length} elements in the original, ${converted.elements.length} in the copy`);
  }
  const n = Math.min(original.elements.length, converted.elements.length);
  for (let i = 0; i < n; i++) {
    const a = original.elements[i];
    const b = converted.elements[i];
    const changed = [];
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (key === 'i' || key === 'text') continue;
      if (['x', 'y', 'w', 'h'].includes(key)) {
        if (Math.abs(a[key] - b[key]) > 1) changed.push(`${key} ${a[key]}→${b[key]}`);
      } else if (key === 'animationName') {
        // The copy's keyframes carry the import prefix.
        if (a[key] !== String(b[key]).replace(/(^|,\s*)imp-/g, '$1')) changed.push(`${key} ${a[key]}→${b[key]}`);
      } else if (!same(a[key], b[key])) {
        if (a[key] && typeof a[key] === 'object') {
          for (const p of Object.keys(a[key])) if (!same(a[key][p], b[key]?.[p])) changed.push(`${key} ${p} ${a[key][p]}→${b[key]?.[p] ?? 'none'}`);
          if (!b[key]) changed.push(`${key} missing`);
        } else changed.push(`${key} ${a[key] ?? 'none'}→${b[key] ?? 'none'}`);
      }
    }
    if (changed.length) found.push(`<${a.tag}${a.cls ? ` class="${a.cls}"` : ''}>${a.text ? ` "${a.text}"` : ''}: ${changed.slice(0, 4).join(', ')}`);
  }
  for (const cls of Object.keys(original.hover)) {
    if (!same(original.hover[cls], converted.hover[cls])) found.push(`hovering .${cls} looks different`);
  }
  return found;
}

/** Root-relative site paths ("/assets/…") as file URLs, so the test documents can load them. */
function localUrls(html, root) {
  const base = pathToFileURL(root).href.replace(/\/$/, '');
  return html.replace(/((?:src|href)\s*=\s*["'])\/(?!\/)/gi, `$1${base}/`);
}

/**
 * Renders both documents at each width and compares them.
 * Returns { ran, reason?, passes: [{ width, differences: [...] }] }.
 */
export async function renderCheck({ originalDoc, convertedDoc, hoverClasses = [], root, widths = RENDER_WIDTHS }) {
  if (typeof WebSocket === 'undefined') return { ran: false, reason: 'this Node has no built-in WebSocket (Node 22 or later has one)', passes: [] };
  const chrome = findChrome();
  if (!chrome) return { ran: false, reason: 'no Chrome or Chromium was found (install one, or set CHROME_PATH)', passes: [] };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twinstack-check-'));
  const originalFile = path.join(dir, 'original.html');
  const convertedFile = path.join(dir, 'converted.html');
  fs.writeFileSync(originalFile, localUrls(originalDoc, root));
  fs.writeFileSync(convertedFile, localUrls(convertedDoc, root));
  let client;
  const timer = new Promise((_, reject) => setTimeout(() => reject(new Error(`it took over ${TIMEOUT_MS / 1000} seconds`)), TIMEOUT_MS).unref());
  try {
    return await Promise.race([timer, (async () => {
      client = await launch(chrome);
      const passes = [];
      for (const width of widths) {
        const original = await loadAndSnapshot(client, pathToFileURL(originalFile).href, width, 'body', hoverClasses);
        const converted = await loadAndSnapshot(client, pathToFileURL(convertedFile).href, width, '.imported-page', hoverClasses);
        passes.push({ width, elements: original.elements.length, hovers: Object.keys(original.hover).length, differences: compare(original, converted) });
      }
      return { ran: true, passes };
    })()]);
  } catch (error) {
    return { ran: false, reason: `the browser check failed: ${error.message}`, passes: [] };
  } finally {
    client?.close();
    setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), 2000).unref();
  }
}
