/**
 * Writes supabase/demo-hosted.sql and supabase/demo-hosted-reset.sql from supabase/seed.sql (Sprint 14,
 * S14-2). No API calls. Run after npm run demo:seed.
 *
 *   npm run demo:hosted
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hostedDemoSql, hostedResetSql } from './demo-hosted';
import { ROOT } from './lib';

const seed = readFileSync(join(ROOT, 'supabase/seed.sql'), 'utf8');
writeFileSync(join(ROOT, 'supabase/demo-hosted.sql'), hostedDemoSql(seed));
writeFileSync(join(ROOT, 'supabase/demo-hosted-reset.sql'), hostedResetSql(seed));
console.log('Written: supabase/demo-hosted.sql and supabase/demo-hosted-reset.sql');
