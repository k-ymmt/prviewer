import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

/** Renders HTML that GitHub already rendered from Markdown (bodyHTML fields). */
export function HtmlBody({ html, className }: { html: string; className?: string }) {
  const clean = useMemo(() => sanitize(html), [html]);
  if (!html.trim()) return <p className={`markdown-empty ${className ?? ''}`}>No description provided.</p>;
  return <div className={`markdown-body ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: clean }} />;
}

/** Renders raw Markdown (e.g. codex answers). */
export function MarkdownText({ markdown, className }: { markdown: string; className?: string }) {
  const clean = useMemo(() => sanitize(marked.parse(markdown, { async: false, gfm: true, breaks: false })), [markdown]);
  return <div className={`markdown-body ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: clean }} />;
}
