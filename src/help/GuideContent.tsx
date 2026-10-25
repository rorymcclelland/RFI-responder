/**
 * Sprint 10 (S10-2): renders a guide page's tree (src/lib/markdown.ts) as React elements. Text is
 * always passed to React as text, never as HTML; links go only where resolveLink allows, and images
 * only to screenshots bundled with the app.
 */
import { Fragment, type ReactNode } from 'react';
import { guideId, imageFile, resolveLink, type Block, type Inline } from '../lib/markdown';

export interface GuideContext {
  page: string;
  pages: readonly string[];
  repoUrl: string;
  screenshots: Record<string, string>;
  /** Open a guide page (and heading) inside the app. */
  onOpen: (page: string, anchor: string | null) => void;
}

function renderInline(nodes: Inline[], ctx: GuideContext): ReactNode {
  return nodes.map((n, i) => {
    switch (n.kind) {
      case 'text':
        return <Fragment key={i}>{n.text}</Fragment>;
      case 'strong':
        return <strong key={i} className="font-bold text-ink-900">{renderInline(n.children, ctx)}</strong>;
      case 'code':
        return <code key={i} className="text-[0.85em] bg-ink-100 text-ink-800 px-1 py-0.5 rounded">{n.text}</code>;
      case 'image':
        return <GuideImage key={i} src={n.src} alt={n.alt} ctx={ctx} />;
      case 'link': {
        const target = resolveLink(n.href, ctx.page, ctx.pages, ctx.repoUrl);
        const children = renderInline(n.children, ctx);
        if (target.kind === 'external') {
          return <a key={i} href={target.href} target="_blank" rel="noopener noreferrer" className="text-sky-700 underline underline-offset-2 hover:text-sky-900">{children}</a>;
        }
        if (target.kind === 'page') {
          return (
            <a key={i} href={`#${target.anchor ? guideId(target.anchor) : ''}`} className="text-sky-700 underline underline-offset-2 hover:text-sky-900"
              onClick={(e) => { e.preventDefault(); ctx.onOpen(target.page, target.anchor); }}>
              {children}
            </a>
          );
        }
        return <Fragment key={i}>{children}</Fragment>;
      }
    }
  });
}

function GuideImage({ src, alt, ctx }: { src: string; alt: string; ctx: GuideContext }) {
  const file = imageFile(src);
  const url = file ? ctx.screenshots[file] : undefined;
  if (!url) return <span className="italic text-ink-400">{alt}</span>;
  return (
    <figure className="my-4">
      <img src={url} alt={alt} loading="lazy" className="w-full rounded-xl border border-ink-200 shadow-card" />
      {alt && <figcaption className="text-xs text-ink-500 mt-1.5">{alt}</figcaption>}
    </figure>
  );
}

const HEADING_CLASS: Record<number, string> = {
  1: 'text-2xl font-black text-ink-900 tracking-tight mb-4',
  2: 'text-lg font-black text-ink-900 mt-8 mb-3',
  3: 'text-base font-bold text-ink-900 mt-6 mb-2',
};

function renderBlocks(blocks: Block[], ctx: GuideContext): ReactNode {
  return blocks.map((b, i) => {
    switch (b.kind) {
      case 'heading': {
        const Tag = `h${Math.min(b.level, 4)}` as 'h1' | 'h2' | 'h3' | 'h4';
        return <Tag key={i} id={guideId(b.id)} className={`scroll-mt-24 ${HEADING_CLASS[b.level] ?? 'text-sm font-bold text-ink-900 mt-4 mb-2'}`}>{renderInline(b.content, ctx)}</Tag>;
      }
      case 'paragraph':
        return <p key={i} className="text-sm text-ink-700 leading-relaxed my-3">{renderInline(b.content, ctx)}</p>;
      case 'image':
        return <GuideImage key={i} src={b.src} alt={b.alt} ctx={ctx} />;
      case 'list': {
        const Tag = b.ordered ? 'ol' : 'ul';
        return (
          <Tag key={i} className={`text-sm text-ink-700 leading-relaxed my-3 pl-5 space-y-1.5 ${b.ordered ? 'list-decimal' : 'list-disc'}`}>
            {b.items.map((item, j) => (
              <li key={j}>{renderInline(item.content, ctx)}{item.children.length > 0 && renderBlocks(item.children, ctx)}</li>
            ))}
          </Tag>
        );
      }
      case 'table':
        return (
          <div key={i} className="my-4 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>{b.header.map((c, j) => <th key={j} className="text-left font-bold text-ink-800 border-b border-ink-200 px-3 py-2 align-top">{renderInline(c, ctx)}</th>)}</tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j} className="border-b border-ink-100">
                    {r.map((c, k) => <td key={k} className="text-ink-700 px-3 py-2 align-top">{renderInline(c, ctx)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}

export default function GuideContent({ blocks, ctx }: { blocks: Block[]; ctx: GuideContext }) {
  return <article className="max-w-3xl">{renderBlocks(blocks, ctx)}</article>;
}

/** Inline content alone (bold labels in the introduction's steps), rendered the same way. */
export function InlineContent({ nodes, ctx }: { nodes: Inline[]; ctx: GuideContext }) {
  return <>{renderInline(nodes, ctx)}</>;
}
