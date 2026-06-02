#!/usr/bin/env bash
# Cut a release: bump the desktop app version, commit, tag and push so CI builds
# and publishes it. `npm version` skips git commit/tag when run inside a
# workspace, so we do the commit, tag and push here explicitly.
set -euo pipefail

bump="${1:?usage: release.sh <patch|minor|major>}"

npm version "$bump" --no-git-tag-version -w apps/desktop
version=$(node -p "require('./apps/desktop/package.json').version")

git add apps/desktop/package.json package-lock.json
git commit -m "Release v$version"
git tag "v$version"
git push --follow-tags origin main

echo "Pushed v$version — build: https://github.com/vigosan/surco/actions"
