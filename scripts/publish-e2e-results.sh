#!/usr/bin/env bash
# Sprint 20 (S20-4): pushes a browser test run's results (results.json, recordings and screenshots, and
# for a local run the guide's screenshots) to their own branch, e2e-results/<target>/<branch>, replaced
# on every run, so Claude can fetch them with git to build the demo page. Runs in CI only, with the
# job's own token; a push made with it starts no other workflow. Synthetic data only, as everywhere.
#
# The repository is public (security review, H1): traces and the HTML report are never published, and
# a staging run's results are searched for its password and Vercel bypass secret before anything is
# pushed. The values come from the environment and are never printed.
set -euo pipefail
target="${1:?local or staging}"
case "$target" in local|staging) ;; *) echo "::error::target must be local or staging"; exit 1 ;; esac
branch="e2e-results/${target}/${GITHUB_REF_NAME}"
out="$(mktemp -d)"
mkdir -p "$out/$target"
[ -f e2e-results/results.json ] && cp e2e-results/results.json "$out/$target/"
if [ -d e2e-results/artifacts ]; then
  (cd e2e-results && find artifacts -type f \( -name '*.webm' -o -name '*.png' -o -name 'error-context.md' \) -print0 \
    | xargs -0 -I{} cp --parents {} "$out/$target/")
fi
if [ "$target" = local ] && [ -d docs/screenshots ]; then cp -r docs/screenshots "$out/screenshots"; fi
node -e 'const [sha, run, target, branch] = process.argv.slice(1); process.stdout.write(JSON.stringify({ sha, run, target, branch, at: new Date().toISOString().replace(/\.\d+Z$/, "Z") }) + "\n")' \
  "$GITHUB_SHA" "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" "$target" "$GITHUB_REF_NAME" > "$out/build.json"
for secret in "${E2E_PASSWORD:-}" "${E2E_VERCEL_BYPASS:-}"; do
  if [ "$target" = staging ] && [ -n "$secret" ] && grep -rqaF -- "$secret" "$out"; then
    echo "::error::A secret appeared in the results; nothing was published."; exit 1
  fi
done
# Vercel reads its settings from each commit, and these commits have no vercel.json of their own:
# without this one, every results branch started a deployment that failed and counted against the
# account's daily limit (Sprint 22, when the limit stopped staging's builds).
printf '{\n  "git": { "deploymentEnabled": false }\n}\n' > "$out/vercel.json"
cd "$out"
git init -q -b results
git add -A
git -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
  commit -qm "Browser test results ($target) for $GITHUB_SHA"
git push -qf "https://x-access-token:${TOKEN}@github.com/${GITHUB_REPOSITORY}.git" "HEAD:refs/heads/$branch"
echo "Results published to $branch"
