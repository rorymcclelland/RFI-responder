/**
 * Sprint 10 (S10-6): the introduction shown after a person's first sign-in, and from Help at any
 * time. Each step is a picture of the screen and a few lines, linking to the guide page that covers
 * it in full. Words in **bold** are labels the app shows, as in the guide (checked by the tests).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface IntroStep {
  id: string;
  title: string;
  /** Short paragraphs; **bold** marks a label on the screen. */
  body: string[];
  /** A screenshot from docs/screenshots, or null for none. */
  image: string | null;
  imageAlt: string;
  guide: { page: string; anchor: string | null; label: string };
  /** Shown to admins only. */
  adminOnly?: true;
}

export const INTRO_STEPS: IntroStep[] = [
  {
    id: 'purpose',
    title: 'What RFI Respond is for',
    body: [
      'It helps you answer requests for information and security questionnaires from your organisation\'s own knowledge base.',
      'It drafts answers only from that knowledge base, shows how sure it is and why, and a person approves every answer. It never sends anything to a customer.',
    ],
    image: null,
    imageAlt: '',
    guide: { page: 'README.md', anchor: null, label: 'The user guide' },
  },
  {
    id: 'overview',
    title: 'Every response in one place',
    body: [
      '**Responses** lists the responses in progress, with their owners, due dates and progress, and flags those **At risk** or **Overdue**.',
      'Choose **New response** to start one. Anyone can start a response and owns the ones they start.',
    ],
    image: '1-overview.png',
    imageAlt: 'The overview of responses',
    guide: { page: 'getting-started.md', anchor: 'the-overview', label: 'Getting started' },
  },
  {
    id: 'upload',
    title: 'Upload the questionnaire',
    body: [
      'Upload the customer\'s spreadsheet (.xlsx or .csv) or Word document (.docx). For a spreadsheet you choose the question column; for a Word document the app finds the questions, and you check them before anything is saved.',
    ],
    image: '10-mapping.png',
    imageAlt: 'Choosing the question column of a spreadsheet',
    guide: { page: 'running-a-response.md', anchor: '2-upload-the-questions', label: 'Uploading the questions' },
  },
  {
    id: 'drafts',
    title: 'How a draft is made',
    body: [
      'Each question is matched against the knowledge base. A checker reads the best entries and says whether they answer it: **Yes**, **Partly** or **No**, with a reason. A draft is written from those entries only, and checked against them.',
      'Questions and entries can be in English or Japanese. A draft written from entries in the other language is labelled as translated, and is always reviewed one at a time.',
      '**Confidence** is the measured chance that the knowledge base answers the question, from tests on questions with known answers. Questions without a measured confidence come first, then the lowest.',
    ],
    image: '3-draft-and-checker.png',
    imageAlt: 'A question card with its draft, sources and the checker\'s verdict',
    guide: { page: 'question-card.md', anchor: null, label: 'The question card' },
  },
  {
    id: 'review',
    title: 'Review, one at a time or in bulk',
    body: [
      '**Approve** a draft, **Edit First**, or **Write an answer** when there is none. The owner can approve many drafts at once above a confidence.',
      'Some questions are never approved in bulk: pricing (a person always answers those), legal and translated questions, partly answered ones, and drafts that rely on an entry no admin has reviewed. Each card says why.',
    ],
    image: '4-pricing-held.png',
    imageAlt: 'A pricing question held for a person to answer',
    guide: { page: 'running-a-response.md', anchor: 'approving-in-bulk', label: 'Approving in bulk' },
  },
  {
    id: 'assign',
    title: 'Ask a colleague',
    body: [
      'When a question needs a specialist, choose **Assign for review** on its card. People are suggested from who wrote or approved similar answers, with the reasons.',
      'Questions sent to you are in **Assignments**.',
    ],
    image: '5-assignments.png',
    imageAlt: 'A specialist\'s inbox',
    guide: { page: 'specialists.md', anchor: null, label: 'Answering assigned questions' },
  },
  {
    id: 'export',
    title: 'Export, and the knowledge base learns',
    body: [
      'When every question is decided, **Record export** and download the answers. Each file records how every answer was produced and who approved it.',
      'Most answers people edited or wrote are added to the knowledge base, so later responses can draw on them; pricing answers never are.',
    ],
    image: '6-export-and-learning.png',
    imageAlt: 'An exported response and what the knowledge base learned',
    guide: { page: 'running-a-response.md', anchor: '5-record-the-export', label: 'Recording the export' },
  },
  {
    id: 'knowledge',
    title: 'What we know',
    body: [
      '**Knowledge** is the organisation\'s knowledge base, for everyone: how many answers there are, by topic and state, what was learned recently, and every answer to search and browse.',
      'Every draft comes from it, so a better knowledge base means better drafts. Add an answer or import a spreadsheet there.',
    ],
    // The screenshot (17-knowledge.png) is added once Rory has retaken the screenshots (Sprint 17, Q4).
    image: null,
    imageAlt: '',
    guide: { page: 'admin.md', anchor: 'the-knowledge-base', label: 'The knowledge base' },
  },
  {
    id: 'admin',
    title: 'For admins: people, knowledge and spend',
    body: [
      'Invite people under **Team**, with **Invite someone**, and give admin rights there too. Add to the knowledge base from **Knowledge**.',
      '**Governance** shows the AI spend against the monthly budget, sets the limits, and lists the entries waiting for your review.',
    ],
    image: '7-governance-usage.png',
    imageAlt: 'The governance page',
    guide: { page: 'admin.md', anchor: null, label: 'Administering RFI Respond' },
    adminOnly: true,
  },
  {
    id: 'help',
    title: 'Help is always there',
    body: [
      'The full guide, and this introduction, are under **Help** at the top of every screen (in the menu on a narrow screen).',
    ],
    image: null,
    imageAlt: '',
    guide: { page: 'common-problems.md', anchor: null, label: 'Common problems' },
  },
];

/** Everyone sees the common steps and running a response (any member can own one); admins also see theirs. */
export function stepsFor(isAdmin: boolean): IntroStep[] {
  return INTRO_STEPS.filter((s) => isAdmin || !s.adminOnly);
}

/** Shown automatically until the person has finished or skipped it once, on any browser. */
export function shouldShowIntroduction(profile: { onboardedAt?: string | null } | null): boolean {
  return profile !== null && !profile.onboardedAt;
}

/**
 * The profile columns every member may read (security review, Sprint 10, L3): everything except
 * onboarded_at, which only its owner reads, through loadOnboardedAt.
 */
export const PROFILE_COLUMNS = 'id, display_name, job_title, department, expertise_tags, is_admin, created_at, updated_at';

/**
 * When the signed-in person finished or skipped the introduction: a time, null for never, or
 * undefined when it could not be read (then it is not opened automatically, rather than every time).
 */
export async function loadOnboardedAt(client: Pick<SupabaseClient, 'rpc'>): Promise<string | null | undefined> {
  try {
    const { data, error } = await client.rpc('my_onboarded_at');
    return error ? undefined : ((data as string | null) ?? null);
  } catch {
    return undefined;
  }
}

/**
 * Record that the person has seen the introduction. A failure does not block the app: the
 * introduction closes, and is shown again next time (S10-6 test 7). Returns whether it was saved.
 */
export async function markOnboarded(client: Pick<SupabaseClient, 'rpc'>): Promise<boolean> {
  try {
    const { error } = await client.rpc('mark_onboarded');
    return !error;
  } catch {
    return false;
  }
}
