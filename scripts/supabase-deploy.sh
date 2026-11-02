#!/usr/bin/env bash
# Sprint 20 (S20-3): applies the migrations and deploys every Edge Function to one Supabase project,
# then lists the applied migration versions for the deploy check.
#
#   bash scripts/supabase-deploy.sh <project-ref> <migration-list-output-file>
#
# Needs SUPABASE_ACCESS_TOKEN (a token limited to this project) and SUPABASE_DB_PASSWORD.
# It does not run `supabase link`, which reads the project's API keys: the project-scoped tokens
# deliberately cannot, so migrations go over a direct database connection (the session pooler, in
# the project's region) and functions are deployed by project ref.
set -euo pipefail
ref="${1:?project ref}"
out="${2:?output file}"
region="${SUPABASE_REGION:-eu-west-2}"
[[ "$ref" =~ ^[a-z0-9]{20}$ ]] || { echo "::error::Not a project ref"; exit 1; }
command -v psql >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq postgresql-client >/dev/null; }
password=$(node -e 'process.stdout.write(encodeURIComponent(process.env.SUPABASE_DB_PASSWORD ?? ""))')
db_url=""
# Supabase's session pooler runs on more than one cluster per region; the project answers on one.
for cluster in aws-0 aws-1; do
  candidate="postgresql://postgres.${ref}:${password}@${cluster}-${region}.pooler.supabase.com:5432/postgres"
  if psql "$candidate" -tAc 'select 1' >/dev/null 2>&1; then db_url="$candidate"; break; fi
done
[ -n "$db_url" ] || { echo "::error::Could not connect to the project's database through the session pooler (check the database password secret)"; exit 1; }
echo "::add-mask::$db_url"
supabase db push --db-url "$db_url" --yes
supabase functions deploy --project-ref "$ref"
# The applied versions, one per line, straight from the project's own record of them.
psql "$db_url" -tAc "select version from supabase_migrations.schema_migrations order by 1" > "$out"
echo "Migrations applied and functions deployed to $ref."
