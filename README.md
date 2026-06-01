# Vinilo

App de escritorio (macOS) para organizar pistas de audio para DJ. Automatiza el flujo:

1. Añades tus archivos **WAV** o **FLAC** (botón o arrastrando).
2. Buscas el disco en **Discogs** y eliges la pista → trae artista, álbum, año, género y carátula.
3. Editas lo que quieras y pulsas procesar.
4. Vinilo convierte a **AIFF lossless** (preservando la profundidad de bits exacta, cero pérdida), embebe los tags + la carátula y lo añade a **Apple Music**.

El AIFF resultante funciona tanto en **rekordbox** como en **Apple Music**, con la info y la carátula siempre visibles.

## Requisitos

- macOS
- [ffmpeg](https://ffmpeg.org/) y ffprobe en el `PATH` (`brew install ffmpeg`)
- Un [token personal de Discogs](https://www.discogs.com/settings/developers) (gratis) → se configura en Ajustes

## Desarrollo

```bash
npm install
npm run dev      # arranca la app en modo desarrollo
npm test         # tests unitarios (Vitest)
npm run build    # typecheck + build de producción
npm run dist     # empaqueta un .dmg (electron-builder)
```

## Por qué AIFF y no WAV

WAV no tiene un estándar fiable de metadatos: Apple Music suele ignorar los tags y la carátula. AIFF es **el mismo audio PCM sin comprimir que WAV** (idéntico bit a bit, misma calidad), pero con soporte sólido de ID3 que tanto Apple Music como rekordbox leen perfectamente. Por eso un único AIFF sustituye al WAV sin perder nada.
