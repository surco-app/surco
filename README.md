# Surco

Monorepo de **Surco** — organizador de pistas de audio para DJ.

## Estructura

- `apps/desktop` — la app de escritorio (Electron + React + TypeScript).
- `apps/web` — el sitio web del producto (Vite + React + Tailwind).

## Desarrollo

```bash
npm install            # instala todos los workspaces

npm run dev:desktop    # app Electron en desarrollo
npm run dev:web        # sitio web en desarrollo
npm test               # tests de la app desktop
npm run build:desktop  # build de producción
npm run build:web      # build del sitio
npm run dist:desktop   # empaqueta el .dmg
```
