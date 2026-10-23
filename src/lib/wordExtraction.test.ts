// Sprint 5, S5-2: the app's call to extract-questions.
import { describe, expect, it, vi } from 'vitest';
import { extractFromWord } from './wordExtraction';

describe('extractFromWord', () => {
  const blocks = [{ id: 'b1', kind: 'paragraph' as const, text: 'Do you use MFA?' }];

  it('sends only the text blocks and returns the result', async () => {
    const result = { questions: [], dropped: 0, method: 'ai', model: 'm', promptVersion: 'p' };
    const invoke = vi.fn().mockResolvedValue({ data: result, error: null });
    expect(await extractFromWord({ functions: { invoke } } as never, blocks)).toBe(result);
    expect(invoke).toHaveBeenCalledWith('extract-questions', { body: { blocks } });
  });

  it('passes on the server\'s reason, such as the daily limit', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: Object.assign(new Error('non-2xx'), { context: new Response(JSON.stringify({ error: "You have reached today's limit on reading Word documents." }), { status: 429 }) }),
    });
    await expect(extractFromWord({ functions: { invoke } } as never, blocks)).rejects.toThrow(/could not be found: You have reached today's limit/);
  });
});
