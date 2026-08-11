#!/usr/bin/env node
// enumerate-routes.mjs
//
// Walks services/frontend/src/app/**/page.tsx and produces routes.json:
//   [
//     { path: '/', category: 'Public', dynamic: false, auth: false,
//       register: false, slug: 'root' },
//     ...
//   ]
//
// Categorization mirrors the sitemap the task expects:
//   Public       — /, /login, /register/*, /coming-soon, /marketplace,
//                  /marketplace/[id], /support, /select-entity, /billing,
//                  /invite/accept/[token], /membership-request/accept/[token]
//   Contractor   — /contractor/*
//   Corporation  — /corporation/*
//   Admin        — /admin/*
//
// Dynamic segments ([id], [token]) are kept as-is in `path`. The capture
// spec substitutes a placeholder ID at fetch time and captures whatever
// state the page renders (typically an empty/error state, still useful
// as a "not-found" screenshot).

import { readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const APP_ROOT = join(REPO_ROOT, 'services', 'frontend', 'src', 'app');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Next.js ignores route groups: `(marketing)` etc. don't affect URL.
      // We treat them the same. Underscore-prefixed dirs (_v1) are also
      // ignored by Next's App Router.
      if (name.startsWith('_')) continue;
      out.push(...walk(full));
    } else if (name === 'page.tsx' || name === 'page.jsx') {
      out.push(full);
    }
  }
  return out;
}

function toRoutePath(absPageFile) {
  const rel = relative(APP_ROOT, absPageFile).split(/[\\/]/);
  // drop trailing 'page.tsx'
  rel.pop();
  // strip route groups
  const parts = rel.filter((seg) => !(seg.startsWith('(') && seg.endsWith(')')));
  if (parts.length === 0) return '/';
  return '/' + parts.join('/');
}

function categorize(p) {
  if (p.startsWith('/admin'))       return 'Admin';
  if (p.startsWith('/contractor'))  return 'Contractor';
  if (p.startsWith('/corporation')) return 'Corporation';
  return 'Public';
}

function slugify(p) {
  if (p === '/') return 'root';
  return p.replace(/^\//, '')
          .replace(/\//g, '__')
          .replace(/\[/g, '_')
          .replace(/\]/g, '_');
}

// Which routes need an authenticated session. Public routes (login,
// register, coming-soon, marketplace browse, support) render without a
// JWT; every /contractor/*, /corporation/*, /admin/*, /billing, and
// /select-entity require auth.
function needsAuth(p, category) {
  if (category === 'Public' && !['/', '/select-entity', '/billing'].includes(p)) return false;
  if (p === '/select-entity' || p === '/billing') return true;
  return category !== 'Public';
}

// Register-wizard routes we still capture (each step), but the spec is
// forbidden from clicking the final submit.
function isRegisterWizard(p) {
  return p.startsWith('/register/');
}

function main() {
  const files = walk(APP_ROOT).sort();
  const routes = files.map((f) => {
    const p = toRoutePath(f);
    const category = categorize(p);
    return {
      path:      p,
      category,
      dynamic:   p.includes('['),
      auth:      needsAuth(p, category),
      register:  isRegisterWizard(p),
      source:    relative(REPO_ROOT, f).replace(/\\/g, '/'),
      slug:      slugify(p),
    };
  });

  const outPath = join(HERE, 'routes.json');
  writeFileSync(outPath, JSON.stringify(routes, null, 2), 'utf8');

  // Human-readable summary
  const byCat = {};
  for (const r of routes) (byCat[r.category] ??= []).push(r);
  console.log(`\nEnumerated ${routes.length} routes across ${Object.keys(byCat).length} categories:\n`);
  for (const cat of ['Public', 'Contractor', 'Corporation', 'Admin']) {
    const rs = byCat[cat] || [];
    console.log(`  ${cat} (${rs.length}):`);
    for (const r of rs) {
      const flags = [
        r.auth      ? 'auth'     : '',
        r.dynamic   ? 'dynamic'  : '',
        r.register  ? 'register' : '',
      ].filter(Boolean).join(',');
      console.log(`    ${r.path.padEnd(48)}  ${flags}`);
    }
    console.log('');
  }
  console.log(`Wrote ${outPath}`);
}

main();
