# Kode-reduksjonsrapport

Sortert etter hvor mye kode som kan fjernes uten å ofre lesbarhet eller oppførsel.

## 1. `src/main.ts` (2181 linjer) — klart største problem

### `buildAddPanel` + datotid-feltene
- **Hvor:** `src/main.ts:223`–`535` (panel) og `:1007`–`1077` (`makeDateTimeInput`)
- **Problem:** Tre nær-identiske felt (`whenInput`, `schedInput`, `deadInput`) wires manuelt med 5–6 `addEventListener`-kall hver (`:332`–`:385`). Hver dato-/tid-picker dupliserer samme `syncTextFromPickers` + `syncVisibility` + `scheduleEditAutosave`-trio.
- **Tiltak:** Flytt `onChange`-callback inn i `makeDateTimeInput`-fabrikken; én linje pr. felt:
  ```
  const whenInput = makeDateTimeInput("When", "add-when", { onChange: () => { syncVisibility(); scheduleEditAutosave(); } });
  ```
- **Bonus:** `AddPanelRefs` (`:73`–`:106`, 35 felt) blir overflødig hvis man lagrer wrapper-objektene direkte i stedet for å pakke dem ut.
- **Estimert besparelse:** ~80 linjer wiring + ~25 linjer i `AddPanelRefs`.

### `getShortcutAction`
- **Hvor:** `src/main.ts:1809`–`:1820`
- **Problem:** Hver tast sjekkes mot `key`, `e.code` *og* `e.keyCode`. `e.keyCode` er deprecated og `e.code` redundant når `key` allerede er sjekket.
- **Tiltak:** Et lite `Record<string, Action>`-map.
- **Estimert besparelse:** ~8 linjer.

### Tag-filter-helpere
- **Hvor:** `src/main.ts:1760`–`:1777`
- **Problem:** `filterDeadlinesByTags`, `filterOverdueByTags`, `filterSomedayByTags` har identisk kropp.
- **Tiltak:** Én generisk
  ```ts
  function filterByTags<T extends { entry: Pick<OrgEntry, "tags"> }>(items: T[]): T[]
  ```
- **Estimert besparelse:** ~10 linjer.

## 2. `src/ui/render.ts` (963 linjer)

### Item-render-wrappers
- **Hvor:** `src/ui/render.ts:600`–`:630`
- **Problem:** `renderAllDayItem`, `renderTimedItem`, `renderScheduledItem`, `renderDayDeadlineItem` er one-liner-wrappers rundt `renderItem` med ulike argument-permutasjoner.
- **Tiltak:** Inliner kallstedene, eller slå sammen til ett `renderItemForCategory(item, category, ...)`-kall.
- **Estimert besparelse:** ~30 linjer.

### `buildInstanceNoteClassName`
- **Hvor:** `src/ui/render.ts:574`–`:598`
- **Problem:** 25 linjer kaskaderende `if (item.category === ...)` som er et 5-rads tabell-oppslag.
- **Tiltak:** En `Record<RenderCategory, { layout, titleCol }>`-tabell med to felt for `with-time` vs. `compact`.
- **Estimert besparelse:** ~15 linjer.

## 3. Småduplikat

### Dag-/måned-forkortelser
- **Hvor:** `DAY_ABBREVS` på `src/main.ts:197`, og samme array inline i `formatPreviewDate` på `:1116`–`:1117` (pluss tilsvarende månedsarray).
- **Tiltak:** Eksporter ett sett konstanter fra én modul.
- **Estimert besparelse:** ~5 linjer, men fjerner kilde til drift.

## Total

Estimert ~170–200 linjer ned fra `main.ts` og ~45 fra `render.ts`, uten oppførselsendringer. Største enkeltstående gevinst er `buildAddPanel`-wiringen.

## Rekkefølge-forslag

1. `buildAddPanel`-wiring (størst gevinst, isolert til én funksjon)
2. `filterByTags` generisk + `getShortcutAction`-map (trivielt, lavt risiko)
3. `render.ts` item-wrappers + `buildInstanceNoteClassName`-tabell
4. Konstant-konsolidering
