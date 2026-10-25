/** Sprint 10 (S10-2): the user guide, inside the app. */
import { useEffect, useRef } from 'react';
import { BookOpen, Sparkles } from 'lucide-react';
import GuideContent from './GuideContent';
import { guideId } from '../lib/markdown';
import { GUIDE_FILES, GUIDE_PAGES, REPO_URL, SCREENSHOTS, findPage } from '../lib/guide';

export default function HelpView({ page, anchor, onOpen, onShowIntroduction }: {
  page: string;
  anchor: string | null;
  onOpen: (page: string, anchor: string | null) => void;
  onShowIntroduction: () => void;
}) {
  const current = findPage(page);
  const top = useRef<HTMLDivElement>(null);

  // Go to the heading a link named, or the top of a new page.
  useEffect(() => {
    const target = anchor ? document.getElementById(guideId(anchor)) : null;
    if (target) target.scrollIntoView({ block: 'start' });
    else window.scrollTo({ top: 0 });
    // Move focus to the page for keyboard and screen-reader users.
    top.current?.focus();
  }, [page, anchor]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col md:flex-row gap-6">
      <nav aria-label="Guide pages" className="md:w-56 flex-shrink-0">
        <p className="section-label mb-2 flex items-center gap-1.5"><BookOpen size={11} /> User guide</p>
        <ul className="space-y-0.5">
          {GUIDE_PAGES.map((p) => (
            <li key={p.file}>
              <button
                onClick={() => onOpen(p.file, null)}
                aria-current={p.file === current.file ? 'page' : undefined}
                className={`w-full text-left text-sm px-3 py-2 rounded-xl transition-colors ${p.file === current.file ? 'bg-ink-900 text-white font-semibold' : 'text-ink-600 hover:bg-ink-100'}`}
              >
                {p.file === 'README.md' ? 'Contents' : p.title}
              </button>
            </li>
          ))}
        </ul>
        <button onClick={onShowIntroduction} className="mt-4 w-full flex items-center gap-2 text-sm font-semibold text-ink-600 border border-ink-200 rounded-xl px-3 py-2 hover:bg-ink-50">
          <Sparkles size={14} /> Show the introduction
        </button>
      </nav>
      <div ref={top} tabIndex={-1} className="flex-1 min-w-0 bg-white rounded-2xl border border-ink-100 shadow-card p-5 sm:p-8 outline-none">
        <GuideContent blocks={current.blocks} ctx={{ page: current.file, pages: GUIDE_FILES, repoUrl: REPO_URL, screenshots: SCREENSHOTS, onOpen }} />
      </div>
    </div>
  );
}
