/**
 * Sprint 10 (S10-2): the user guide inside the app. The pages are the Markdown files in docs/guide,
 * bundled when the app is built, so what Help shows is what the repository says.
 */
import { parseMarkdown, plainText, type Block } from './markdown';

const RAW = import.meta.glob('../../docs/guide/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const SHOTS = import.meta.glob('../../docs/screenshots/*.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

/** Where links to the rest of the repository (the technical reference) go. */
export const REPO_URL = 'https://github.com/rorymcclelland/RFI-responder';

/** The order pages are listed in; any page not named here comes after them. */
const ORDER = ['README.md', 'getting-started.md', 'running-a-response.md', 'specialists.md', 'admin.md', 'question-card.md', 'common-problems.md'];

export interface GuidePage { file: string; title: string; blocks: Block[] }

const fileOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

export const GUIDE_PAGES: GuidePage[] = Object.entries(RAW)
  .map(([path, text]) => {
    const blocks = parseMarkdown(text);
    const first = blocks[0];
    const file = fileOf(path);
    return { file, title: first?.kind === 'heading' ? plainText(first.content) : file, blocks };
  })
  .sort((a, b) => {
    const rank = (f: string) => (ORDER.includes(f) ? ORDER.indexOf(f) : ORDER.length);
    return rank(a.file) - rank(b.file) || a.file.localeCompare(b.file);
  });

export const GUIDE_FILES = GUIDE_PAGES.map((p) => p.file);

/** The bundled address of each screenshot, by file name. */
export const SCREENSHOTS: Record<string, string> = Object.fromEntries(Object.entries(SHOTS).map(([path, url]) => [fileOf(path), url]));

/** The page Help opens at: the admin's own page for admins, getting started for everyone else. */
export function startPage(isAdmin: boolean): string {
  return isAdmin ? 'admin.md' : 'getting-started.md';
}

export function findPage(file: string): GuidePage {
  return GUIDE_PAGES.find((p) => p.file === file) ?? GUIDE_PAGES[0];
}
