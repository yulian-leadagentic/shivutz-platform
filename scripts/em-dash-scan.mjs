// R38 item 2 · where an em dash (U+2014) sits in text a user can read.
//
// Rule (Yulian, 16.11.2026): no em dash in anything a user reads.
// Comments are not read by users and are left alone, so the scan has to
// tell a comment from a string. It does that with the TypeScript parser
// (the one the frontend already has), not with regular expressions:
// Hebrew JSX text is full of quote marks (בע"מ, ח"פ) that no hand-made
// lexer survives.
//
// What is reported: an em dash inside a string literal, a template
// literal or a JSX text node, in .ts .tsx .js .mjs files.
//
//   node scripts/em-dash-scan.mjs                  list every hit, exit 1 if any
//   node scripts/em-dash-scan.mjs --count          per-root counts only
//   import { scanRoots, ROOTS } from '.../em-dash-scan.mjs'   (the lock test)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..');
const require = createRequire(path.join(REPO, 'services/frontend/package.json'));
const ts = require('typescript');

export const EM_DASH = '—';

// Source a user can end up reading text from. Test files and fixtures
// are not shipped to anyone.
export const ROOTS = [
  'services/frontend/src',
  'services/notification/src',
  'services/gateway/src',
  'services/auth/src',
  'services/admin/src',
  'services/worker/src',
];

const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS  = new Set(['node_modules', '.next', 'dist', 'build', '__tests__', 'test', 'tests']);

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(path.join(dir, entry.name));
    } else if (EXTENSIONS.has(path.extname(entry.name)) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) {
      yield path.join(dir, entry.name);
    }
  }
}

function scriptKind(file) {
  const ext = path.extname(file);
  if (ext === '.tsx') return ts.ScriptKind.TSX;
  if (ext === '.ts')  return ts.ScriptKind.TS;
  if (ext === '.jsx') return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

const TEXT_KINDS = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.JsxText,
]);

/** Every em dash in a string, template or JSX text of one file. */
export function scanSource(file, source) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file));
  const hits = [];
  const visit = (node) => {
    if (TEXT_KINDS.has(node.kind)) {
      const text = source.slice(node.getStart(sf), node.getEnd());
      let at = text.indexOf(EM_DASH);
      while (at !== -1) {
        const pos = node.getStart(sf) + at;
        const { line } = sf.getLineAndCharacterOfPosition(pos);
        hits.push({
          file, line: line + 1, pos,
          kind: node.kind === ts.SyntaxKind.JsxText ? 'jsx' : 'string',
          text: source.split('\n')[line].trim().slice(0, 200),
        });
        at = text.indexOf(EM_DASH, at + 1);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

export function scanRoots(roots = ROOTS) {
  const hits = [];
  for (const root of roots) {
    for (const file of walk(path.join(REPO, root))) {
      const source = fs.readFileSync(file, 'utf8');
      if (!source.includes(EM_DASH)) continue;
      for (const hit of scanSource(file, source)) {
        hits.push({ ...hit, root, file: path.relative(REPO, file).replace(/\\/g, '/') });
      }
    }
  }
  return hits;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hits = scanRoots();
  const byRoot = {};
  for (const h of hits) byRoot[h.root] = (byRoot[h.root] || 0) + 1;
  if (!process.argv.includes('--count')) {
    for (const h of hits) console.log(`${h.file}:${h.line}  [${h.kind}]  ${h.text}`);
  }
  for (const root of ROOTS) console.log(`${root}: ${byRoot[root] || 0}`);
  console.log(`total: ${hits.length}`);
  process.exit(hits.length ? 1 : 0);
}
