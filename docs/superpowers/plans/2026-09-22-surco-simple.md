# Surco, más simple: plan de implementación

Origen: auditoría de usabilidad del 22/09/2026 (artifact "Surco, más simple").
Rama: `worktree-surco-simple`, base `main` @ c9f50409.

## Decisiones tomadas sin preguntar (el usuario pidió no preguntar)

1. **Esconder antes que borrar.** Ningún ajuste guardado se borra del disco ni se migra con pérdida.
   Lo que se quita de la vista pasa a un bloque "Avanzado" o se decide solo con el valor que ya
   tenía por defecto.
2. **El original tras convertir.** No se borra nada automáticamente. Los tres enlaces de borrado
   del pie se unifican en uno.
3. **Encuesta de uso.** Fuera de alcance (no es código).

## Reglas comunes a todas las tareas

- Worktree: `/Users/vicent/code/surco/.claude/worktrees/surco-simple`. Nunca tocar el repo principal.
- Tests desde `apps/desktop`: `node ../../node_modules/vitest/vitest.mjs run src/<ruta>`.
- Tipos: `node ../../node_modules/typescript/bin/tsc -p tsconfig.web.json --noEmit` y `-p tsconfig.node.json`.
- Lint: `node ../../node_modules/@biomejs/biome/bin/biome check <ficheros tocados>` (nunca `--write` sobre `src` entero).
- TDD: test rojo primero, verlo fallar, luego verde.
- Sin comentarios nuevos en el código. Actualizar o quitar los que el cambio deje falsos.
- Selectores de test: `data-testid`.
- Copy en los 5 idiomas (`es`, `en`, `de`, `fr`, `pt-BR`), sin guion largo.
- Commits: un título descriptivo en inglés, sin cuerpo ni prefijos. Una funcionalidad por commit.
- Ajustes: nunca aparecer y desaparecer; deshabilitar con texto que explique qué falta.

## Fase 0: fallos verificados

- 0.1 `rekordboxDbPath` elegido en Ajustes no se guarda (`buildSettingsPatch`).
- 0.2 El asistente activa `syncTraktor` sin guardar la ruta detectada del `collection.nml`.
- 0.3 El panel Originales muestra `TRASH_RETENTION_DAYS`/`TRASH_MAX_BYTES` en vez de los ajustes del usuario.
- 0.4 El aviso de cues del declick sale en FLAC/WAV y dice que ahí se conservan; solo debe salir cuando se pierden (ALAC), con texto propio.
- 0.5 "Buscar en Discogs" en paleta y menú enfoca el buscador de la lista: la etiqueta debe decir lo que hace.
- 0.6 Verificar y arreglar si son reales: "Vaciar la lista" con alcance distinto en cabecera y paleta; disparador del filtro que dice "Todas" con un filtro de atención activo; botón de papelera de la cabecera activo sin selección; ⓘ de Normalización que abre la ayuda de métricas; ayuda que nombra una casilla inexistente; auto-emparejar que exige token con solo Bandcamp.

## Fase 1: vocabulario

Una palabra por concepto en los 5 idiomas:
- Verbo del botón principal: "Convertir"; "Actualizar etiquetas" cuando no se recodifica. Fuera "Procesar", "Reexportar", "Exportar de nuevo".
- Loudness / Volumen / sonoridad: un solo término por idioma ("Volumen" en español).
- Calidad dudosa: "Dudosa" (glifo, filtro y veredicto). Emparejado por confirmar: "Por confirmar".
- "Grouping" → "Agrupación", "Title Case" → "Mayúsculas iniciales".

## Fase 2: editor

- 2.1 Calidad como veredicto: una línea (veredicto + formato real) cuando está bien; se despliega sola cuando hay problema, con el espectro y una frase llana; evidencia numérica detrás de "Ver por qué".
- 2.2 La tabla de loudness sale de Calidad y vive en la vista "Ajustar" de volumen.
- 2.3 Sección "Audio" única: recorte, clicks y volumen como tres filas (interruptor + frase + "Ajustar…" que abre la vista maximizada existente).
- 2.4 Propiedades sale del editor a "Información" (⌘I y menú contextual); su resumen se funde en la línea de calidad.
- 2.5 Pie tras convertir: un único enlace de borrado.

## Fase 3: ajustes

De 12 pestañas a 5: General, Etiquetas, Salida, Programas DJ, Atajos. Estadísticas sale a su propio
modal. Profundidad, frecuencia, compresión FLAC, máximo de resultados, palabras a ignorar, carpeta
de configuración, copia, caché, registro, betas, offset de cues y ruta de rekordbox pasan a "Avanzado".
La pestaña Secciones y los interruptores que solo aliviaban el editor desaparecen de la vista.

## Fase 4: barra y lista

Botón principal "Convertir N pistas" siempre (también con una), Originales y Ajustes. Analizar,
⌘K, Estadísticas y Actividad pasan a menú y paleta. La cabecera de la lista se queda con búsqueda,
filtro, orden y añadir; el resto a menú contextual, menú nativo y paleta. Un color por significado.

## Fase 5: ¿Con qué pinchas?

Una pregunta multiselección (Apple Music, rekordbox, Traktor, Engine DJ) que sustituye a los radios
de destino de apps y a las sincronizaciones sueltas; "Dónde guardar" queda como pregunta aparte
(carpeta, junto al original, sobrescribir). El botón nombra el programa.
