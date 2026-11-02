import { describe, expect, it, vi } from 'vitest';
import { GAP_LABEL, GAP_STATES, filterGaps, gapCounts, loadKnowledgeGaps, type Gap } from './knowledgeGaps';

const g = (state: Gap['state'], question: string = state): Gap => ({
  question, state, responses: 1, lastAsked: '2026-11-01T10:00:00Z', entryRef: state === 'learned' ? 'KB-0101' : null,
  responseId: 'r', response: 'Acme', sessionId: 's', questionId: `q-${question}`,
});

describe('gaps (S21-2)', () => {
  it('names every state the database returns, in the refinement\'s words', () => {
    expect(GAP_STATES.map((s) => GAP_LABEL[s])).toEqual(['Not answered yet', 'Answered, learned when sent', 'Learned', 'Answered, not added', 'Left unanswered']);
  });
  it('counts and filters by state', () => {
    const list = [g('open'), g('open', 'b'), g('learned'), g('unanswered')];
    expect(gapCounts(list)).toEqual({ open: 2, answered: 0, learned: 1, not_learned: 0, unanswered: 1 });
    expect(filterGaps(list, ['open']).map((x) => x.question)).toEqual(['open', 'b']);
    expect(filterGaps(list, [])).toHaveLength(4);
  });
  it('loads through knowledge_gaps, and says so when it cannot', async () => {
    expect(await loadKnowledgeGaps({ rpc: vi.fn().mockResolvedValue({ data: [g('open')], error: null }) } as never)).toHaveLength(1);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(loadKnowledgeGaps({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'x' } }) } as never)).rejects.toThrow(/gaps could not be loaded/);
  });
});
