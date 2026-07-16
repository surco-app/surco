---
description: Cut a Surco release (patch, minor or major) with a curated web changelog
argument-hint: patch | minor | major
---

Cut a Surco release. Bump level: `$ARGUMENTS` — it must be exactly `patch`, `minor` or `major`; if it's anything else (or empty), stop and ask.

Work directly on `main` for this flow (the one exception to the worktree rule): `scripts/release.sh` commits the version bump on main and pushes it, so a worktree would only add a merge step between two pushes.

## 1. Preflight

- The working tree must be clean and the current branch must be `main`. Run `git pull --ff-only origin main`. Abort on any failure.
- Run the full test suite from the repo root (`npm test`). Abort if anything is red — never release over failing tests.

## 2. Compute the new version

- Current version: `node -p "require('./apps/desktop/package.json').version"`.
- Derive the next version for the requested bump yourself (don't bump anything yet) — the changelog entry needs it first.

## 3. Curate the web changelog

- List everything since the last release: `git log $(git describe --tags --abbrev=0)..HEAD --oneline --no-merges`.
- Keep ONLY high-level, user-facing items: new features and meaningful changes to existing features. Exclude fixes of transient bugs, refactors, tests, CI/release plumbing, dependency bumps, copy tweaks and web-only commits. Collapse related commits into a single item. Write for a DJ reading the site, not for a developer reading git history.
- Update the releases in BOTH `apps/web/src/i18n/changelog/es.json` and `apps/web/src/i18n/changelog/en.json` (these files feed the web's /cambios page AND the desktop's post-update "what's new" popup):
  - **minor / major**: prepend a new entry `{version, date, title, items}` (newest first). `version` is `X.Y` (no patch digit — the shape test enforces it). Dates are written out per locale, e.g. `10 de junio de 2026` / `June 10, 2026` — get today with `date`.
  - **patch**: fold noteworthy items into the existing top entry for the current minor. A pure-fix patch can add one high-level stability item, or nothing at all.
  - Every NEW item is an object `{"text": "…", "in": "X.Y.Z"}` where `in` is the exact version being released (patch digit included) — the desktop popup filters by it, so an unstamped item never reaches users who update. Old plain-string items predate stamping; leave them as they are.
- If there is nothing user-facing since the last tag, say so and skip the changelog edit entirely — never pad it with filler.
- Verify: `npm test -w apps/web && npm run build -w apps/web` (locale parity and the changelog shape test must pass).
- Commit the changelog on its own: `Update the web changelog for vX.Y.Z`.

## 4. Release

- Run `npm run release:patch`, `release:minor` or `release:major` to match `$ARGUMENTS`. The script bumps `apps/desktop/package.json`, commits `Release vX.Y.Z`, creates the annotated tag and pushes main with tags, which triggers `.github/workflows/release.yml` (binaries publish to `surco-app/surco-releases`; the web deploys from the same push).

## 5. Report

- Confirm CI started with `gh run list --workflow=release.yml --limit 1`. Poll its status briefly if asked — never block on `gh run watch`.
- Report: the new version, the changelog items you added (or that none were warranted), and the Actions URL. A complete release publishes 12 assets to `surco-app/surco-releases`.
