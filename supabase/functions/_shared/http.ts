/** HTTP helpers shared by the Edge Functions (Deno). */
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';
import { EmbeddingError } from './embeddings.ts';

/** Origins allowed to call the functions from a browser: APP_ORIGIN, comma-separated. */
function allowedOrigins(): string[] {
  return (Deno.env.get('APP_ORIGIN') ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((o) => o.trim());
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = allowedOrigins();
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
    Vary: 'Origin',
  };
}

export function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });
}

/**
 * The signed-in user behind the request, or a 401. The gateway already rejects
 * requests without a JWT, but the public anon key is itself a JWT, so the user is
 * checked here too.
 */
export async function requireUser(req: Request): Promise<{ user: User; client: SupabaseClient }> {
  const auth = req.headers.get('Authorization') ?? '';
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
  if (error || !data.user) throw new EmbeddingError('Sign in first', 401);
  return { user: data.user, client };
}

/** Run a handler, turning errors into safe JSON responses. */
export function serve(handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
    if (req.method !== 'POST') return json(req, 405, { error: 'Use POST' });
    try {
      return await handler(req);
    } catch (err) {
      if (err instanceof EmbeddingError) return json(req, err.status, { error: err.message });
      console.error(err);
      return json(req, 500, { error: 'Unexpected error' });
    }
  });
}
