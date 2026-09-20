// L10 §5 · safe Markdown → HTML for legal pages + admin previews.
//
// Two layers of XSS defence per spec:
//   1. markdown-it with html:false — inline raw HTML in the source is
//      escaped, so <script> in the body_md is rendered as literal
//      &lt;script&gt; text, not a <script> tag.
//   2. DOMPurify sanitises the rendered HTML — belt and suspenders:
//      catches anything markdown-it's plugins might have generated
//      that carries an event handler, and normalises data: URLs.
//
// Both run on the SERVER during Next.js SSR — the browser never sees
// unsafe HTML on first paint. isomorphic-dompurify picks the Node
// implementation server-side automatically.

import MarkdownIt from 'markdown-it';
import DOMPurify from 'isomorphic-dompurify';

const md = new MarkdownIt({
  html:        false,   // ← layer 1: no raw HTML from markdown source
  linkify:     true,
  breaks:      false,
  typographer: false,
});

// Rewrite every rendered <a> to add rel="noopener noreferrer" and
// target="_blank" for absolute URLs — prevents tab-nabbing and clean-
// origin phishing from legal-page links.
const defaultLinkRender = md.renderer.rules.link_open
  ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const href = token.attrGet('href') || '';
  if (/^https?:\/\//i.test(href)) {
    token.attrSet('rel', 'noopener noreferrer');
    token.attrSet('target', '_blank');
  }
  return defaultLinkRender(tokens, idx, options, env, self);
};

const ALLOWED_TAGS = [
  'p', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'em', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li',
  'a',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
];

const ALLOWED_ATTR = ['href', 'title', 'target', 'rel'];

/** R14 §2 · substitute {{key}} placeholders in `source` with the
 *  markdown chunks in `substitutions` BEFORE handing off to
 *  markdown-it. This is where the legal-content pipeline lets an
 *  editor put a `{{a11y_coordinator_block}}` inside section 4 and
 *  have it filled from site_settings at render time — the two
 *  sanitisation layers still apply because the substituted chunks
 *  are treated as markdown, not HTML.
 *
 *  Keys are looked up case-sensitively and must be `[a-z0-9_]+`. A
 *  key missing from `substitutions`, or one whose value is empty,
 *  is replaced with the empty string — the paragraph break that
 *  precedes it in the markdown still stands, so the surrounding
 *  section renders without a hole and without the literal
 *  `{{name}}` leaking to the visitor. */
function applySubstitutions(
  source: string,
  substitutions: Record<string, string>,
): string {
  return source.replace(/\{\{([a-z0-9_]+)\}\}/g, (_m, key: string) => {
    const val = substitutions[key];
    return val ?? '';
  });
}

/** Render Markdown to sanitized HTML. Safe to inject via
 *  dangerouslySetInnerHTML — the two layers together mean untrusted
 *  admin input cannot execute JS in the visitor's browser.
 *
 *  `substitutions` (R14 §2) is an optional map of `{{placeholder}}`
 *  → markdown chunk applied before parsing. Callers pass their own
 *  key set (e.g. accessibility page passes a coordinator block
 *  built from site_settings). Placeholders whose key isn't in the
 *  map render as empty string, so a NULL setting produces no
 *  visible artifact. */
export function renderLegalMarkdown(
  source: string,
  substitutions: Record<string, string> = {},
): string {
  const substituted = applySubstitutions(source, substitutions);
  const raw = md.render(substituted);
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Strip javascript: and data: URLs at the sanitiser layer as an
    // extra guard on top of the tag/attr allowlist.
    ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel|#)/i,
  });
}
