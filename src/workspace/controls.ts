/**
 * Sprint 17 (S17-2, U-2): what the response screen offers each person, and why when it offers less.
 * The database still decides (only the owner or an admin may add a file or approve in bulk); this
 * only stops the screen offering what would be refused.
 */
export interface Controls {
  upload: boolean;
  uploadNote: string | null;
  bulk: boolean;
  bulkNote: string | null;
}

export function workspaceControls(o: { canManage: boolean; archived: boolean; ownerName: string | null }): Controls {
  if (o.archived) {
    return { upload: false, uploadNote: 'This response is archived, so it can no longer change.', bulk: false, bulkNote: null };
  }
  if (o.canManage) return { upload: true, uploadNote: null, bulk: true, bulkNote: null };
  return {
    upload: false,
    uploadNote: `${o.ownerName ? `${o.ownerName}, the owner,` : 'The owner'} adds the questions. You can follow along here.`,
    bulk: false,
    bulkNote: `Approving in bulk is for the owner${o.ownerName ? ` (${o.ownerName})` : ''} or an admin.`,
  };
}

/** Why the export cannot be recorded yet, shown beside the button (not only on hover), or null. */
export function exportReason(toDo: number): string | null {
  if (toDo === 0) return null;
  return toDo === 1
    ? '1 question is still to do: approve it or leave it unanswered first.'
    : `${toDo} questions are still to do: approve each or leave them unanswered first.`;
}
