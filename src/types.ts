// ─── Knowledge Base ───────────────────────────────────────────────────────────

export interface KnowledgeEntry {
  id: string;
  question: string;
  answer: string;
  tags: string[];
  source?: string;
  /** Sprint 4: false until an admin has reviewed an entry a member added. */
  reviewed?: boolean;
}

export interface RetrievedSource {
  entry: KnowledgeEntry;
  score: number;
}

// ─── Opportunities ────────────────────────────────────────────────────────────

/** Where a response is in its life (computed by the database view response_overview, Sprint 3). */
export type ResponseStage = 'new' | 'in_review' | 'ready' | 'exported' | 'changed' | 'archived';
export type ResponseOutcome = 'won' | 'lost' | 'withdrawn';

export interface Opportunity {
  id: string;
  name: string;
  /** The response owner: may edit it, assign and approve in bulk (see docs/decisions/0003). */
  ownerId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  exportedAt: string | null;
  archivedAt: string | null;
  outcome: ResponseOutcome | null;
  stage: ResponseStage;
  total: number;
  decided: number;
  accepted: number;
  skipped: number;
  pending: number;
  gatedPending: number;
  openAssignments: number;
  overdue: boolean;
  atRisk: boolean;
}

// ─── RFI Workflow ─────────────────────────────────────────────────────────────

export type RFIStatus = 'pending' | 'accepted' | 'skipped';

export interface RFIQuestion {
  id: string;
  sessionId: string;
  position: number;
  /** The customer's own number for the question ("3.2.", "4(a)"), when the document had one (Sprint 5). */
  customerRef?: string | null;
  question: string;
  generatedAnswer: string;
  finalAnswer: string;
  /** Calibrated chance the top entry is right (S1-6); null when not calibrated. */
  confidence: number | null;
  /** Top cosine similarity, or the keyword fusion score when matching was keyword-only. */
  retrievalScore: number;
  sources: RetrievedSource[];
  status: RFIStatus;
  /**
   * Sprint 2 (S2-2a, S2-3): why this question is never bulk-approved, set server-side.
   * Null for questions processed before Sprint 2, and for ordinary questions.
   */
  gate: QuestionGate | null;
  gateReason: string | null;
  /** How the draft was made (null before Sprint 2). */
  draftKind: DraftKind | null;
  language: 'en' | 'ja' | null;
  /** Anything the reviewer should know about how this question was processed. */
  processingNote: string | null;
  /** Provenance: which models and prompt produced the score and draft. */
  provenance: { embeddingModel: string | null; judgeModel: string | null; draftModel: string | null; promptVersion: string | null; calibrationSet: string | null };
  /** False until the server has processed the question. */
  processed: boolean;
  /** The latest recorded approval (Sprint 3, S3-2), if accepted. */
  approval: { by: string | null; at: string; kind: 'individual' | 'bulk'; threshold: number | null } | null;
  /** Who skipped it and when (Sprint 11, S11-10), if skipped. Optional for questions built before it. */
  skip?: { by: string | null; at: string } | null;
  /** What learning at export did with this question (Sprint 3, S3-4). */
  learnOutcome: string | null;
  /** The answerability checker's verdict, chosen entry and one-sentence reason (Sprint 6, S6-3). */
  checker: { verdict: 'yes' | 'partly' | 'no' | null; bestRef: string | null; reason: string | null };
}

export type QuestionGate = 'pricing' | 'legal' | 'unchecked' | 'translation' | 'unreviewed_source' | 'stale_source' | 'unindexed_entries';
export type DraftKind = 'generated' | 'assembled' | 'insufficient_evidence' | 'person_required';

export interface RFISession {
  id: string;
  opportunityId: string | null;
  fileName: string;
  status: 'in_progress' | 'completed';
  questionCount: number;
  acceptedCount: number;
  createdAt: string;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export interface UserProfile {
  id: string;
  displayName: string;
  jobTitle: string;
  department: string;
  expertiseTags: string[];
  isAdmin: boolean;
  email?: string;
  createdAt: string;
  /** When the person finished or skipped the introduction (Sprint 10, S10-6); null until then. */
  onboardedAt?: string | null;
}

export interface OpportunityContributor {
  userId: string;
  opportunityId: string;
  addedAt: string;
  profile?: UserProfile;
}

/** 'closed' is set only when the response's export is recorded (Sprint 5, F-26). */
export type AssignmentStatus = 'pending' | 'in_review' | 'answered' | 'approved' | 'closed';

export interface QuestionAssignment {
  id: string;
  questionId: string;
  sessionId: string;
  opportunityId: string;
  assignedTo: string;
  assignedBy: string;
  questionText: string;
  answerText: string;
  status: AssignmentStatus;
  notes: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // joined
  assignedToProfile?: UserProfile;
  assignedByProfile?: UserProfile;
  opportunityName?: string;
}
