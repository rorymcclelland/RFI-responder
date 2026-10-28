// Sprint 17, S17-2 (U-2): controls only for those who can use them. Test numbers: docs/refinement/sprint-17.md.
import { describe, expect, it } from 'vitest';
import { exportReason, workspaceControls } from './controls';

describe('workspaceControls', () => {
  it('1. a member who is not the owner: no upload, no bulk bar, and lines that say who can', () => {
    const c = workspaceControls({ canManage: false, archived: false, ownerName: 'Sarah Chen' });
    expect(c).toEqual({
      upload: false,
      uploadNote: 'Sarah Chen, the owner, adds the questions. You can follow along here.',
      bulk: false,
      bulkNote: 'Approving in bulk is for the owner (Sarah Chen) or an admin.',
    });
  });

  it('2. the owner or an admin sees everything', () => {
    expect(workspaceControls({ canManage: true, archived: false, ownerName: 'Sarah Chen' })).toEqual({ upload: true, uploadNote: null, bulk: true, bulkNote: null });
  });

  it('an archived response offers no upload or bulk approval to anyone, and says why', () => {
    const c = workspaceControls({ canManage: true, archived: true, ownerName: 'Sarah Chen' });
    expect(c.upload).toBe(false);
    expect(c.bulk).toBe(false);
    expect(c.uploadNote).toBe('This response is archived, so it can no longer change.');
  });

  it('a response with no owner (deleted account) names no one', () => {
    expect(workspaceControls({ canManage: false, archived: false, ownerName: null }).uploadNote).toBe('The owner adds the questions. You can follow along here.');
  });
});

describe('exportReason', () => {
  it('4. says, as text, why the export cannot be recorded yet', () => {
    expect(exportReason(3)).toBe('3 questions are still to do: approve each or leave them unanswered first.');
    expect(exportReason(1)).toBe('1 question is still to do: approve it or leave it unanswered first.');
    expect(exportReason(0)).toBeNull();
  });
});
