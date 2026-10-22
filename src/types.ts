// ─── Knowledge Base ───────────────────────────────────────────────────────────

export interface KnowledgeEntry {
  id: string;
  question: string;
  answer: string;
  tags: string[];
  source?: string;
}

export interface RetrievedSource {
  entry: KnowledgeEntry;
  score: number;
}

// ─── Opportunities ────────────────────────────────────────────────────────────

export type OpportunityStatus = 'new' | 'in_progress' | 'won' | 'lost';

export interface Opportunity {
  id: string;
  name: string;
  status: OpportunityStatus;
  /** The response owner: may edit it and assign its questions (see docs/decisions/0003). */
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
  sessionCount?: number;
}

// ─── RFI Workflow ─────────────────────────────────────────────────────────────

export type RFIStatus = 'pending' | 'accepted' | 'skipped';

export interface RFIQuestion {
  id: string;
  sessionId: string;
  position: number;
  question: string;
  generatedAnswer: string;
  finalAnswer: string;
  confidence: number;
  retrievalScore: number;
  sources: RetrievedSource[];
  status: RFIStatus;
}

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
}

export interface OpportunityContributor {
  userId: string;
  opportunityId: string;
  addedAt: string;
  profile?: UserProfile;
}

export type AssignmentStatus = 'pending' | 'in_review' | 'answered' | 'approved';

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
