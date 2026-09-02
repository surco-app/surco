---
description: Cut a Surco release (patch, minor or major) with a curated web changelog
argument-hint: patch | minor | major
---

Cut a Surco release. Bump level: `$ARGUMENTS` — it must be exactly `patch`, `minor` or `major`; if it's anything else (or empty), stop and ask.

Work directly on `main` for this flow (the one exception to the worktree rule): `scripts/release.sh` commits the version bump on main and pushes it, so a worktree would only add a merge step between two pushes.

## 1. Preflight

- The working tree must be clean and the current branch must be `main`. Run `git pull --ff-only origin main`. Abort on any failure.
- Type-check exactly as CI does, from `apps/desktop`: `npx tsc --build`. Abort if it errors. This is NOT optional and NOT the same as `tsc --noEmit` — CI runs `tsc --build` (project references), which catches errors a `--noEmit` from a subdir misses, and `npm test` does not type-check at all. Releasing over a red `tsc --build` is exactly the failure this step exists to prevent.
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

## 3b. Revisar el inventario y las páginas de la web (solo minor / major)

En un patch, salta este paso. En un minor o major es obligatorio, y va ANTES del bump.

`docs/funcionalidades.md` es la fuente de la que se redactan `/funciones` y `/guia`: dice de sí mismo que lo que no está ahí no se puede prometer en la web. Congelado, no solo envejece — hace que la web **calle funcionalidades que sí existen**, que es la forma más cara de equivocarse. Entre julio y septiembre de 2026 se quedó cinco releases atrás y llegó a publicar que los cues de Traktor se perdían al convertir a WAV cuando ya se conservaban.

- Relee las entradas del changelog que acabas de curar y quédate con las que cambian lo que Surco *hace*, no cómo lo hace por dentro.
- Para cada una, comprueba contra el código (no de memoria) qué dice hoy `docs/funcionalidades.md`, y corrige lo que contradiga, falte o cite líneas desplazadas. Actualiza la fecha de «Última revisión» de la cabecera.
- Presta atención especial a las tablas: la matriz de cues (§10), la matriz de pérdidas (§8.5) y la lista «Lo que NO se puede afirmar» (§12) son las que más caro salen cuando mienten, porque se copian literalmente a la web.
- Decide después, explícitamente, si cada punto toca `/funciones` (`features.groups` en `apps/web/src/i18n/locales/*.json`) o `/guia` (`guide.sections`). Muchos no tocan ninguna: el changelog ya los cuenta. Di cuáles descartas y por qué.
- Una sección nueva de `/guia` necesita su captura real en `apps/web/public/guide/` — `keys.test.ts` falla si la referencia no existe. Las capturas se hacen siempre con la misma pista de referencia; sin ella, no añadas la sección.
- Si tocas los locales, `npm test -w apps/web` (paridad es/en) y commit aparte del changelog.

## 4. Release

- Run `npm run release:patch`, `release:minor` or `release:major` to match `$ARGUMENTS`. The script bumps `apps/desktop/package.json`, commits `Release vX.Y.Z`, creates the annotated tag and pushes main with tags, which triggers `.github/workflows/release.yml` (binaries publish to `surco-app/surco-releases`; the web deploys from the same push).

## 5. Report

- Confirm CI started with `gh run list --workflow=release.yml --limit 1`. Poll its status briefly if asked — never block on `gh run watch`.
- Report: the new version, the changelog items you added (or that none were warranted), and the Actions URL. A complete release publishes 12 assets to `surco-app/surco-releases`.
