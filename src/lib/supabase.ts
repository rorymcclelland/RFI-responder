import { createClient } from '@supabase/supabase-js';
import { readConfig } from './config';

const config = readConfig(import.meta.env);
if (!config.ok) {
  // main.tsx checks the configuration before loading the app, so this only
  // fires if a module imports the client directly in an unconfigured build.
  throw new Error(`Missing settings: ${config.missing.join(', ')}`);
}

/** Browser client. Uses the public anon key; row-level security decides what each user may do. */
export const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
