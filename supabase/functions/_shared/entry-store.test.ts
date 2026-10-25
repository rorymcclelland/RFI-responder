import { describe, expect, it, vi } from 'vitest';
import { serviceEntryStore } from './entry-store';

describe('serviceEntryStore (Sprint 11, S11-4, F-45)', () => {
  it('never passes database error text on', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const admin = {
      rpc: async () => ({ data: null, error: { message: 'relation "kb_entries" permission denied for schema secret' } }),
      from: () => ({ update: () => ({ eq: async () => ({ error: { message: 'duplicate key value violates "kb_entries_pkey"' } }) }) }),
    };
    const store = serviceEntryStore(admin);
    await expect(store.fetchPending('voyage-4', 10)).rejects.toThrow('The knowledge base could not be read for indexing.');
    await expect(store.save([{ id: 'e1', embedding: [0.1], model: 'voyage-4' }])).rejects.toThrow('An index entry could not be saved.');
    await store.fetchPending('voyage-4', 10).catch((e: Error) => expect(e.message).not.toMatch(/permission|relation|schema/));
  });

  it('reads and saves through the service role', async () => {
    const rpc = vi.fn(async () => ({ data: [{ id: 'e1', question: 'Q', answer: 'A' }], error: null }));
    const eq = vi.fn(async () => ({ error: null }));
    const update = vi.fn(() => ({ eq }));
    const store = serviceEntryStore({ rpc, from: () => ({ update }) });
    expect(await store.fetchPending('voyage-4', 64)).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith('pending_embeddings', { model: 'voyage-4', max_rows: 64 });
    await store.save([{ id: 'e1', embedding: [0.5], model: 'voyage-4' }]);
    expect(eq).toHaveBeenCalledWith('id', 'e1');
  });
});
