# Persistir los valores de normalización del Editor al global

## Problema

En el Editor, el panel de normalización de cada pista se siembra desde el global
`settings.normalize` (`Editor.tsx:317`). Los usuarios reportan una regresión: al
ajustar en una pista el valor de Peak/Loudness (p. ej. Peak custom −1,5), ese valor
no reaparece en la siguiente pista — vuelve a −1.

La causa: `useEditorPicks.onNormalizeChange` (`useEditorPicks.ts`) solo persistía al
global **los dos checkboxes** (`peakRemoveDc`/`peakPerChannel`). Los **inputs**
(`peakDb`/`targetLufs`/`truePeakDb`) no se persistían, así que se perdían al cambiar
de pista.

## Modelo (definitivo)

Un único global (`settings.normalize`), compartido por Settings → Conversion y por la
siembra del Editor. Sin campos nuevos.

- **El `mode` (None/Loudness/Peak)** se hereda del global. Cambiarlo **en una pista**
  es **temporal**: NO actualiza el global (una pista que pasa a Loudness no debe
  voltear el default de todas).
- **Los valores (inputs + checkboxes)** se heredan del global. Cambiarlos **en una
  pista** **SÍ** actualiza el global → la siguiente pista los hereda. Reflejado
  también en Settings → Conversion (es el mismo objeto).
- Se persisten **todos** los valores (`peakDb`, `targetLufs`, `truePeakDb`,
  checkboxes) independientemente del modo, así cada preset recuerda su valor.

Este modelo es la extensión mínima del comportamiento que ya existía: los checkboxes
ya escribían el global; solo faltaba hacer lo mismo con los inputs y excluir el
`mode` de la escritura.

## Implementación

Único cambio de producción: `renderer/src/hooks/useEditorPicks.ts`,
`onNormalizeChange`.

- Construye `next` con `mode: cur.mode` (el modo global, nunca el de la pista) y los
  cinco campos de valor tomados de la config de la pista.
- Guarda `saveSettings({ normalize: next })` solo si alguno de los cinco valores
  difiere del global (el guard evita la escritura redundante del mount report, que
  llega con los valores ya sembrados).

## Testing

`App.test.tsx`, `describe('App normalize peak preferences')`:

- (existente) Un toggle de checkbox persiste al global con `mode` preservado.
- (existente) Cambiar solo el modo en una pista NO escribe el global.
- (nuevo) Cambiar el input Peak en una pista persiste al global con `mode` preservado
  y el nuevo `peakDb` — el arreglo de la regresión.

## Fuera de alcance

- Campo `editorNormalize` o `normalizeAuto`: descartados (enfoques anteriores más
  complejos que este modelo simple sustituye).
- `NormalizeControls.tsx`: no se toca; sigue siendo puro.
