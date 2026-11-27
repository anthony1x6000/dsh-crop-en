/**
 * Source scanner: finds string literals and masks comments, so a translation
 * gate can tell "UI text" from "code" and "comments" without a full parser.
 *
 * Supports the two languages agent-crop ships in:
 *  - js: '...', "...", `...` templates, // and block comments
 *  - py: '...', "...", '''...''', """...""", # comments
 *
 * A literal is recorded with its *raw* inner text (escapes untouched) and its
 * offsets in the source, because the patcher rewrites literal spans verbatim.
 */

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/;

const LITERAL_MARK = '\u0001';
const COMMENT_MARK = '\u0002';

export function hasCjk(text) {
  return CJK.test(text);
}

/**
 * Replace every masked region with a one-character marker per line segment,
 * keeping newlines. The result is independent of the text's length, so it can
 * be compared between original and translation to prove "code unchanged".
 */
function buildMasked(src, regions) {
  regions.sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const region of regions) {
    out += src.slice(cursor, region.start);
    let marked = false;
    for (const ch of src.slice(region.start, region.end)) {
      if (ch === '\n') {
        out += '\n';
        marked = false;
      } else if (!marked) {
        out += region.mark;
        marked = true;
      }
    }
    cursor = region.end;
  }
  return out + src.slice(cursor);
}

function lineAt(src, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (src.charCodeAt(i) === 10) line += 1;
  return line;
}

function scanJs(src) {
  const regions = [];
  const literals = [];
  const n = src.length;
  let i = 0;
  const push = (start, end, quote) => {
    literals.push({ start, end, quote, triple: false, raw: src.slice(start, end), line: lineAt(src, start) });
    regions.push({ start, end, mark: LITERAL_MARK });
  };
  const skipInterpolation = (start) => {
    // src[start] === '$' && src[start + 1] === '{'
    let depth = 1;
    let j = start + 2;
    while (j < n) {
      const ch = src[j];
      if (ch === '{') { depth += 1; j += 1; continue; }
      if (ch === '}') { depth -= 1; j += 1; if (depth === 0) return j; continue; }
      if (ch === "'" || ch === '"' || ch === '`') { j = skipQuoted(j, ch) + 1; continue; }
      if (ch === '/' && src[j + 1] === '/') { while (j < n && src[j] !== '\n') j += 1; continue; }
      if (ch === '/' && src[j + 1] === '*') {
        const close = src.indexOf('*/', j + 2);
        j = close < 0 ? n : close + 2;
        continue;
      }
      j += 1;
    }
    return n;
  };
  const skipQuoted = (start, quote) => {
    let j = start + 1;
    while (j < n) {
      const ch = src[j];
      if (ch === '\\') { j += 2; continue; }
      if (quote === '`' && ch === '$' && src[j + 1] === '{') { j = skipInterpolation(j); continue; }
      if (ch === quote) return j;
      if (ch === '\n' && quote !== '`') return j - 1; // unterminated: stop before newline
      j += 1;
    }
    return n - 1;
  };
  while (i < n) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j += 1;
      regions.push({ start: i, end: j, mark: COMMENT_MARK });
      i = j;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      const end = close < 0 ? n : close + 2;
      regions.push({ start: i, end, mark: COMMENT_MARK });
      i = end;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = skipQuoted(i, ch);
      push(i + 1, end, ch);
      i = end + 1;
      continue;
    }
    i += 1;
  }
  return { literals, masked: buildMasked(src, regions) };
}

function scanPy(src) {
  const regions = [];
  const literals = [];
  const n = src.length;
  let i = 0;
  const push = (start, end, quote, triple) => {
    literals.push({ start, end, quote, triple, raw: src.slice(start, end), line: lineAt(src, start) });
    regions.push({ start, end, mark: LITERAL_MARK });
  };
  while (i < n) {
    const ch = src[i];
    if (ch === '#') {
      let j = i;
      while (j < n && src[j] !== '\n') j += 1;
      regions.push({ start: i, end: j, mark: COMMENT_MARK });
      i = j;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const triple = src.startsWith(ch.repeat(3), i);
      const quoteLen = triple ? 3 : 1;
      let j = i + quoteLen;
      let end = n;
      while (j < n) {
        const cur = src[j];
        if (cur === '\\') { j += 2; continue; }
        if (triple) {
          if (src.startsWith(ch.repeat(3), j)) { end = j; j += 3; break; }
          j += 1;
        } else {
          if (cur === ch) { end = j; j += 1; break; }
          if (cur === '\n') { end = j; break; } // unterminated
          j += 1;
        }
      }
      push(i + quoteLen, end, ch, triple);
      i = end + (triple ? 3 : 1);
      if (i > n) i = n;
      continue;
    }
    i += 1;
  }
  return { literals, masked: buildMasked(src, regions) };
}

export function scan(source, lang) {
  if (lang === 'js') return scanJs(source);
  if (lang === 'py') return scanPy(source);
  throw new Error(`scan: unsupported language ${lang}`);
}

export function cjkLiterals(source, lang) {
  return scan(source, lang).literals.filter((literal) => hasCjk(literal.raw));
}

/**
 * Replace literal spans whose raw text equals an entry's `from` with its `to`.
 * Only literal spans are touched, so a dictionary string never rewrites code
 * or comments by accident.
 */
export function applyEntries(source, entries, lang) {
  const { literals } = scan(source, lang);
  const byRaw = new Map();
  for (const literal of literals) {
    const bucket = byRaw.get(literal.raw) ?? [];
    bucket.push(literal);
    byRaw.set(literal.raw, bucket);
  }
  const hits = [];
  const missing = [];
  const seen = new Set();
  for (const [from, to] of entries) {
    if (seen.has(from)) continue;
    seen.add(from);
    const found = byRaw.get(from) ?? [];
    if (found.length === 0) { missing.push(from); continue; }
    for (const literal of found) hits.push({ start: literal.start, end: literal.end, to });
  }
  hits.sort((a, b) => b.start - a.start);
  let out = source;
  for (const hit of hits) out = out.slice(0, hit.start) + hit.to + out.slice(hit.end);
  return { out, replaced: hits.length, missing };
}
