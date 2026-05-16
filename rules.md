# dotgui-figma Plugin Rules

Coding constraints for `src/code.ts` — the plugin sandbox has a restricted JS engine.

---

## JavaScript Compatibility

The Figma plugin sandbox runs code through its own JS engine which does **not** support all modern syntax. Write code as if targeting ES2017 or older.

### No optional chaining (`?.`)

```ts
// ❌ breaks in the plugin sandbox
if (bv?.color?.id) { ... }
const x = col?.defaultModeId || fallback

// ✅ use explicit null checks
if (bv && bv.color && bv.color.id) { ... }
const x = (col && col.defaultModeId) || fallback
```

### No nullish coalescing (`??`)

```ts
// ❌
const v = node.value ?? 'default'

// ✅
const v = node.value !== undefined && node.value !== null ? node.value : 'default'
```

### No `for...of` on iterables (use index loops or `.forEach`)

```ts
// ❌ may fail on non-array iterables (Set, Map, etc.)
for (const id of ids) { ... }

// ✅
const idArr = Array.from(ids)
for (let i = 0; i < idArr.length; i++) { ... }
```

### No `Array.from` with map callback

```ts
// ❌
Array.from(set, x => x.id)

// ✅
Array.from(set).map(x => x.id)
```

---

## General Rules

- All code in `code.ts` runs in the plugin sandbox — never assume browser globals beyond what Figma exposes.
- `figma.variables` may not exist in all Figma versions — always guard with `typeof figma.variables !== 'undefined'` or `(figma as any).variables` before calling.
- Keep node converter functions (`frameToGui`, `textToGui`, etc.) synchronous where possible; async is only needed for image/SVG export and variable resolution.
- Reset all global state (`_imageMap`, `_tokenRegistry`, `_usedTokenIds`, etc.) at the start of each export to avoid stale data across selections.
