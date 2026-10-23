/**
 * Sends a Word document's text blocks to the extract-questions Edge Function (Sprint 5, S5-2).
 * Only text goes to the server; the file itself never leaves the browser (refinement Q1).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExtractionResult } from './questionDrafts';
import { functionErrorMessage } from './sessions';
import type { WordBlock } from './wordDocument';

export async function extractFromWord(client: SupabaseClient, blocks: WordBlock[]): Promise<ExtractionResult> {
  const { data, error } = await client.functions.invoke('extract-questions', { body: { blocks } });
  if (error || !data) {
    const { message } = await functionErrorMessage(error);
    throw new Error(`The questions could not be found: ${message}`);
  }
  return data as ExtractionResult;
}
