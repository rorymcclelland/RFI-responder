/**
 * Sprint 10 (S10-6): the introduction. A dialog of steps, each a picture of the screen and a few
 * lines, with a link to the guide page that covers it. Focus moves into the dialog and back to
 * where it was (or to the Help button, if that was a menu item that has gone); Tab stays inside it;
 * Escape closes it, as Skip does; each step is announced. The rest of the app is inert while it is
 * open, so a click outside cannot take focus behind it (security review, Sprint 10, L4).
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Sparkles, X } from 'lucide-react';
import { InlineContent } from './GuideContent';
import { parseInline } from '../lib/markdown';
import { GUIDE_FILES, REPO_URL, SCREENSHOTS } from '../lib/guide';
import type { IntroStep } from '../lib/onboarding';

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Introduction({ steps, onClose, onOpenGuide }: {
  steps: IntroStep[];
  /** Called on finishing or skipping (Escape counts as skipping). */
  onClose: (how: 'finished' | 'skipped') => void;
  onOpenGuide: (page: string, anchor: string | null) => void;
}) {
  const [index, setIndex] = useState(0);
  const overlay = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const step = steps[index];
  const last = index === steps.length - 1;

  // Remember where focus was, and return it there when the dialog closes. Make everything beside the
  // dialog inert while it is open.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const siblings = overlay.current?.parentElement
      ? [...overlay.current.parentElement.children].filter((el) => el !== overlay.current && !el.hasAttribute('inert'))
      : [];
    siblings.forEach((el) => el.setAttribute('inert', ''));
    return () => {
      siblings.forEach((el) => el.removeAttribute('inert'));
      const back = before && document.contains(before) && before !== document.body ? before : document.querySelector<HTMLElement>('button[aria-label="Help"]');
      back?.focus();
    };
  }, []);

  // Each new step takes focus at its heading, so a screen reader reads it.
  useEffect(() => { heading.current?.focus(); }, [index]);

  // Keys are handled for the whole page while the dialog is open, so they work wherever focus is.
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  onKey.current = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose('skipped');
      return;
    }
    if (e.key !== 'Tab' || !dialog.current) return;
    if (!dialog.current.contains(document.activeElement)) {
      e.preventDefault();
      heading.current?.focus();
      return;
    }
    const items = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0];
    const end = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) {
      e.preventDefault();
      end.focus();
    } else if (!e.shiftKey && document.activeElement === end) {
      e.preventDefault();
      first.focus();
    }
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey.current(e);
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const ctx = { page: 'README.md', pages: GUIDE_FILES, repoUrl: REPO_URL, screenshots: SCREENSHOTS, onOpen: onOpenGuide };

  return (
    <div ref={overlay} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4 animate-fade-in"
      onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); heading.current?.focus(); } }}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="intro-title"
        aria-describedby="intro-body"
        className="bg-white rounded-3xl shadow-modal w-full max-w-xl max-h-[90vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-6 pt-5">
          <p className="text-xs font-bold text-ink-400 flex items-center gap-1.5" aria-live="polite">
            <Sparkles size={12} /> Introduction: step {index + 1} of {steps.length}
          </p>
          <button onClick={() => onClose('skipped')} className="flex items-center gap-1 text-xs font-bold text-ink-400 hover:text-ink-800 px-2 py-1 rounded-lg">
            Skip <X size={13} />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-4 flex-1">
          <h2 id="intro-title" ref={heading} tabIndex={-1} className="text-xl font-black text-ink-900 tracking-tight mb-3 outline-none">{step.title}</h2>
          {step.image && SCREENSHOTS[step.image] && (
            <img src={SCREENSHOTS[step.image]} alt={step.imageAlt} className="w-full rounded-xl border border-ink-200 mb-4" />
          )}
          <div id="intro-body" className="space-y-2.5">
            {step.body.map((para, i) => (
              <p key={i} className="text-sm text-ink-700 leading-relaxed"><InlineContent nodes={parseInline(para)} ctx={ctx} /></p>
            ))}
          </div>
          <button
            onClick={() => onOpenGuide(step.guide.page, step.guide.anchor)}
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-sky-700 hover:text-sky-900 underline underline-offset-2"
          >
            <BookOpen size={13} /> Read more: {step.guide.label}
          </button>
        </div>

        <div className="flex items-center gap-2 px-6 py-4 border-t border-ink-100">
          <div className="flex gap-1" aria-hidden="true">
            {steps.map((s, i) => <span key={s.id} className={`w-1.5 h-1.5 rounded-full ${i === index ? 'bg-ink-900' : 'bg-ink-200'}`} />)}
          </div>
          <div className="ml-auto flex gap-2">
            {index > 0 && (
              <button onClick={() => setIndex((i) => i - 1)} className="btn-ghost text-xs py-2"><ArrowLeft size={13} /> Back</button>
            )}
            {last ? (
              <button onClick={() => onClose('finished')} className="btn-primary text-xs py-2">Finish</button>
            ) : (
              <button onClick={() => setIndex((i) => i + 1)} className="btn-primary text-xs py-2">Next <ArrowRight size={13} /></button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
