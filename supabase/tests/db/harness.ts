/**
 * Database test harness.
 *
 * Builds a throwaway database from supabase/tests/shim/supabase-shim.sql plus every
 * migration in order, then lets tests run statements *as* a given user, the way
 * PostgREST does for the browser: `SET LOCAL ROLE authenticated` (or anon) and the
 * user's id in `request.jwt.claims`. Each `as` call runs in a transaction that is
 * rolled back, so tests cannot leak changes into each other.
 *
 * Connection: DB_TEST_URL, a superuser connection to an existing database used to
 * create the test database (default postgres://postgres@localhost:5432/postgres).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const TEST_DB = 'rfi_test';

function baseUrl(): string {
  return process.env.DB_TEST_URL ?? 'postgres://postgres@localhost:5432/postgres';
}

function testUrl(): string {
  const u = new URL(baseUrl());
  u.pathname = `/${TEST_DB}`;
  return u.toString();
}

/** Drop and recreate the test database, then apply the shim and all migrations. */
export async function buildDatabase(options: { seed?: boolean } = {}): Promise<void> {
  const admin = new pg.Client({ connectionString: baseUrl() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  const db = new pg.Client({ connectionString: testUrl() });
  await db.connect();
  try {
    await db.query(readFileSync(join(ROOT, 'supabase/tests/shim/supabase-shim.sql'), 'utf8'));
    const dir = join(ROOT, 'supabase/migrations');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      try {
        await db.query(readFileSync(join(dir, file), 'utf8'));
      } catch (err) {
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
    if (options.seed) await db.query(readFileSync(join(ROOT, 'supabase/seed.sql'), 'utf8'));
  } finally {
    await db.end();
  }
}

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: testUrl(), max: 4 });
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/** Run SQL as the database superuser (test set-up only; bypasses every rule). */
export async function asSuperuser<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(sql, params);
}

export interface TestUser {
  id: string;
  email: string;
}

/** Create a user the way Supabase Auth does (the sign-up trigger makes the profile). */
export async function createUser(opts: { admin?: boolean; name?: string } = {}): Promise<TestUser> {
  const id = randomUUID();
  const email = `${id.slice(0, 8)}@test.example`;
  await asSuperuser(
    `INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data)
     VALUES ($1, $2, 'authenticated', 'authenticated', jsonb_build_object('display_name', $3::text))`,
    [id, email, opts.name ?? email],
  );
  if (opts.admin) await asSuperuser('UPDATE public.user_profiles SET is_admin = true WHERE id = $1', [id]);
  return { id, email };
}

type Query = <T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]) => Promise<pg.QueryResult<T>>;

/**
 * Run `fn` as a signed-in user (or as an anonymous visitor when user is null),
 * inside a transaction that is always rolled back.
 */
export async function as<T>(user: TestUser | null, fn: (q: Query) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${user ? 'authenticated' : 'anon'}`);
    const claims = user ? { sub: user.id, role: 'authenticated', email: user.email } : { role: 'anon' };
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    return await fn((sql, params) => client.query(sql, params));
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

/** Expect the statement to be refused by Postgres (permission or policy error). */
export async function refused(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('Expected the database to refuse this statement, but it succeeded');
}
