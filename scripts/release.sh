#!/usr/bin/env bash
# Cut a release: bump the desktop app version, commit, tag and push so CI builds
# and publishes it. `npm version` skips git commit/tag when run inside a
# workspace, so we do the commit, tag and push here explicitly.
set -euo pipefail

bump="${1:?usage: release.sh <patch|minor|major>}"

# Type-check the desktop app before touching the version — `npm test` doesn't run tsc,
# so a type error (which the release CI's build DOES catch) would otherwise pass the
# test preflight, tag a broken build, and skip every publish job. Fail here instead,
# before the tag exists.
(cd apps/desktop && npx tsc --build)

npm version "$bump" --no-git-tag-version -w apps/desktop
version=$(node -p "require('./apps/desktop/package.json').version")

git add apps/desktop/package.json package-lock.json
git commit -m "Release v$version"
# Annotated (-a) so `git push --follow-tags` actually pushes it; a lightweight
# tag would be left behind and CI would never trigger.
git tag -a "v$version" -m "Release v$version"
git push --follow-tags origin main

echo "Pushed v$version — build: https://github.com/vigosan/surco/actions"
