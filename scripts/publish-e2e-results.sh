#!/usr/bin/env bash
# Sprint 20 (S20-4): pushes a browser test run's results (results.json, recordings, screenshots, and
# for a local run the guide's screenshots) to their own branch, e2e-results/<target>/<branch>, replaced
# on every run, so Claude can fetch them with git to build the demo page. Runs in CI only, with the
# job's own token; a push made with it starts no other workflow. Synthetic data only, as everywhere.
set -euo pipefail
target="${1:?local or staging}"
case "$target" in local|staging) ;; *) echo "::error::target must be local or staging"; exit 1 ;; esac
branch="e2e-results/${target}/${GITHUB_REF_NAME}"
out="$(mktemp -d)"
mkdir -p "$out/$target"
[ -f e2e-results/results.json ] && cp e2e-results/results.json "$out/$target/"
[ -d e2e-results/artifacts ] && cp -r e2e-results/artifacts "$out/$target/"
if [ "$target" = local ] && [ -d docs/screenshots ]; then cp -r docs/screenshots "$out/screenshots"; fi
printf '{"sha":"%s","run":"%s/%s/actions/runs/%s","target":"%s","branch":"%s","at":"%s"}\n' \
  "$GITHUB_SHA" "$GITHUB_SERVER_URL" "$GITHUB_REPOSITORY" "$GITHUB_RUN_ID" "$target" "$GITHUB_REF_NAME" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$out/build.json"
cd "$out"
git init -q -b results
git add -A
git -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
  commit -qm "Browser test results ($target) for $GITHUB_SHA"
git push -qf "https://x-access-token:${TOKEN}@github.com/${GITHUB_REPOSITORY}.git" "HEAD:refs/heads/$branch"
echo "Results published to $branch"
