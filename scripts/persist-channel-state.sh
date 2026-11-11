#!/usr/bin/env bash
# Persist one checked-out automation-state worktree. Never silently overwrite
# concurrently changed decisions, source/queue history or upload ledgers.
set -euo pipefail
state=${1:-state}
git -C "$state" add -A
if git -C "$state" diff --cached --quiet; then
  echo 'No state changes'
  exit 0
fi
git -C "$state" commit -m "state: daily operations $(date -u +%F)"
for attempt in 1 2 3; do
  if git -C "$state" push origin HEAD:refs/heads/automation-state; then exit 0; fi
  if [ "$attempt" = 3 ]; then
    echo 'State push failed after three attempts. Local evidence was not pushed.' >&2
    exit 1
  fi
  git -C "$state" fetch --no-tags origin '+refs/heads/automation-state:refs/remotes/origin/automation-state'
  remote=refs/remotes/origin/automation-state
  base=$(git -C "$state" merge-base HEAD "$remote")
  local_files=$(git -C "$state" diff --name-only "$base" HEAD)
  remote_files=$(git -C "$state" diff --name-only "$base" "$remote")
  while IFS= read -r path; do
    case "$path" in
      */planning-inbox.json|*/queue.json|*/sources.json|*/published.json|*/upload-attempts.json)
        if printf '%s\n' "$remote_files" | grep -Fxq -- "$path"; then
          echo "Concurrent state change to $path; refusing automatic overwrite. Preserve the run artifacts and reconcile explicitly." >&2
          exit 1
        fi
        ;;
    esac
  done <<< "$local_files"
  if ! git -C "$state" -c core.editor=true rebase "$remote"; then
    git -C "$state" rebase --abort || true
    echo 'State rebase conflicted; refusing an automatic theirs/ours resolution. Preserve the run artifacts and reconcile explicitly.' >&2
    exit 1
  fi
done
