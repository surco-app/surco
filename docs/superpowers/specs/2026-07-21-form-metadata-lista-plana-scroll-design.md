# Formulario de metadata: lista plana con alto máximo y scroll interno

Fecha: 2026-07-21

## Problema

El formulario de metadata reparte sus fields en cuatro secciones plegables
(Identity, Catalog, DJ, Order) mediante `groupFields()`. Este diseño tiene dos
defectos:

1. **El plegado no persiste.** `FieldGroup` usa `useState(defaultOpen)` local
   (`MetadataForm.tsx:71`) y el editor se remonta por pista, así que abrir
   "Catalog" se pierde al cambiar de pista. Solo Identity abre por defecto.

2. **Los grupos entran en conflicto con la reordenación libre de fields.** El
   usuario reordena sus fields en Settings → Fields y ese orden se guarda tal
   cual en `visibleFields`. Pero `groupFields()` re-agrupa todo por su grupo,
   ignorando el orden entre grupos: arrastrar `catalogNumber` entre `title` y
   `artist` lo devuelve a la sección Catalog (cerrada por defecto). La
   reordenación cruzada se descarta en silencio, haciendo mentira el control de
   orden que la UI ofrece.

## Solución

Eliminar las secciones plegables del formulario. Los fields se renderizan en una
**lista plana** que respeta el orden exacto del usuario. Para que el caso de
"muchos fields" no crezca sin límite y empuje las secciones de abajo (Audio
Quality, Trim, File name) fuera de vista, el formulario se acota con un
**`max-height` fijo y scroll interno propio**, con un **fade inferior** que
señala que hay más fields debajo — el mismo patrón ya usado en el modal de
Settings.

### Por qué scroll interno acotado y no un solo scroll

El flujo de edición es de ida y vuelta: el usuario ajusta un field, consulta el
Audio Quality o el trim, vuelve a un field. Con un único scroll de columna, cada
consulta obliga a recorrer todo el muro de fields y volver. Acotar el formulario
mantiene quality/trim siempre a la vista debajo. Con pocos fields la caja no
alcanza el `max-height` y no aparece scroll interno; con muchos, acota y protege
lo de abajo. Es seguro en ambos extremos.

## Detalle de implementación

### 1. `MetadataForm.tsx` — lista plana con scroll acotado

- Eliminar el componente `FieldGroup` (líneas 57–114) y su `useState`.
- Eliminar la llamada a `groupFields(fields)` y el `defaultOpen={gi === 0}`.
- Renderizar los `fields` directamente en el grid existente
  (`grid-cols-1 @[26rem]:grid-cols-2`, con `wide`/`compilation` a dos columnas),
  en el orden en que llegan (ya es el orden del usuario, single-track).
- Envolver el grid en un contenedor con:
  - `max-height` fijo en px (valor: **420px**, ver nota abajo).
  - `overflow-y: auto`.
  - fade inferior condicionado a `moreBelow`, reutilizando
    `useScrollAffordance` (`hooks/useScrollAffordance.ts`) — el mismo hook y el
    mismo `bg-gradient-to-t from-[var(--color-panel)]` del modal de Settings.
    Recomputar la afordancia cuando cambian los fields mostrados (dependencia
    del hook: la clave de la lista de fields).

**Dónde va el `max-height`:** dentro de `MetadataForm`, NO en `SectionBody`.
`SectionBody` anima su propio `max-height` al abrir y lo libera a `none` para no
cortar el crecimiento tardío; poner ahí un tope fijo se lo pisaría. El tope y el
scroll van en el contenedor del grid de fields dentro del formulario.

**Nota sobre el valor 420px:** cubre ~14 fields de una columna antes de
scrollear, dejando Audio Quality a la vista en pantallas normales. Es un punto de
partida; se ajusta al verlo en la app.

### 2. `fields.ts` — eliminar código muerto de grupos

- Eliminar `groupHeaderBefore()` (líneas 104–109): ya no se usa en ningún
  render y este cambio confirma que no volverá.
- Eliminar `groupFields()`, `FieldGroupBucket` y `GROUP_ORDER` si tras el cambio
  no quedan otros consumidores fuera de tests. (Verificar en implementación:
  `groupFields` solo lo usa `MetadataForm`.)

**Se conserva:**

- `FIELD_GROUPS`, `groupOfField`, `sortFieldsByGroup` y `FieldGroupId`. La
  agrupación conceptual sobrevive como **criterio de orden** para el botón
  "Auto-organizar" de Settings → Fields, que sigue siendo útil: ordena la lista
  plana por temática (identity → catalog → dj → order) de un clic. No es código
  muerto.

### 3. i18n — retirar labels de sección

- Eliminar las claves `fieldGroups.*` (identity/catalog/dj/order/other) de los
  seis locales, ya que ninguna sección las renderiza.
- Conservar `settings.autoOrganize*` (el botón sigue existiendo).

## Qué NO cambia

- El orden y la visibilidad de fields (Settings → Fields) siguen igual.
- El botón "Auto-organizar" y `sortFieldsByGroup`.
- Las secciones del editor de abajo (quality, trim, output…) y su persistencia.
- El modo multi-track de `buildFieldSpecs` (ya ignora el orden del usuario por
  `BULK_FIELDS`; no lo tocamos).

## Testing (TDD)

- **`MetadataForm`**: renderiza todos los `fields` en el orden recibido, sin
  cabeceras de grupo ni botones de plegado (`field-group-*` ya no existen).
- **`MetadataForm`**: cuando los fields superan el alto, el contenedor tiene
  scroll interno y el fade aparece; cuando caben, no hay fade.
- **`fields.ts`**: confirmar que `groupHeaderBefore` se elimina sin romper
  consumidores; `sortFieldsByGroup` y `FIELD_GROUPS` siguen exportados y
  testeados.
- **Regresión**: `sortFieldsByGroup` (auto-organizar) sigue reordenando por
  grupo como antes.

## Alcance descartado (YAGNI)

- No hay UI en Settings para el estado abierto/cerrado de grupos (ya no hay
  grupos).
- No se persiste ningún estado de plegado del formulario (ya no hay plegado).
- No se añaden subtítulos ligeros por grupo dentro de la lista plana (opción C
  descartada): el usuario prefirió la lista sin estructura visual de grupos.
