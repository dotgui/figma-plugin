# .gui Format — v0.2 Spec

A portable, text-based UI description format for representing Figma screens. XML-style tag markup carrying structure, visual properties, design tokens, and assets in a single file. Designed for 1-1 Figma layer mapping and AI agent consumption.

---

## File Structure

`.gui` is always a ZIP package. Never a bare XML file.

```
checkout.gui          ← the file you hand to anyone (ZIP)
├── design.guix       ← the UI markup (XML)
├── preview.webp      ← thumbnail shown before anything is parsed
└── assets/
    ├── img-1.webp    ← raster images (always WebP)
    └── svg-1.svg     ← complex vector artwork
```

A program distinguishes a package from raw markup by magic bytes: ZIP starts with `PK`, markup starts with `<`.

```xml
<gui version="0.2" name="Checkout Screen">
  <tokens />
  <styles />
  <fonts />
  <assets />
  <!-- components block here -->
  <col w="390" fill="#F2F2F7" gap="16" p="24">
    ...
  </col>
</gui>
```

Document order: `tokens` → `styles` → `fonts` → `assets` → `components` → root layout node.

### `<gui>` attrs

| Attr | Type | Description |
|---|---|---|
| `version` | string | Spec version (`0.2`) |
| `name` | string | Screen or layer name |

---

## Tokens

Design system primitives. Type is the tag name. All tokens are flat — just `name` and `value`.

```xml
<tokens>
  <color name="primary" value="#007AFF" />
  <color name="surface" value="#FFFFFF" />
  <color name="on-surface" value="#1C1C1E" />
  <number name="space-sm" value="8" />
  <number name="space-md" value="16" />
  <number name="radius-card" value="12" />
  <string name="font-base" value="Inter" />
</tokens>
```

### Token types

| Tag | W3C type | Value |
|---|---|---|
| `<color>` | color | hex, with optional alpha byte |
| `<number>` | number | unitless number |
| `<string>` | string | any string |

Reference tokens anywhere with `$name`:
```xml
<shape type="rect" fill="$primary" radius="$radius-card" />
```

---

## Styles

Named Figma styles. The `<styles>` block holds three style types: `<text-style>`, `<fill-style>`, and `<effect-style>`. Only styles that are actually used in the exported tree are emitted.

```xml
<styles>
  <text-style name="Heading/H1" font-family="Inter" font-size="32" font-weight="700" line-height="40" />
  <text-style name="Body/Regular" font-family="Inter" font-size="16" font-weight="400" line-height="24" />
  <fill-style name="Brand/Primary" value="#007AFF" />
  <fill-style name="Surface/Card" value="#FFFFFF" />
  <effect-style name="Elevation/1">
    <effect type="drop-shadow" x="0" y="4" radius="8" spread="0" color="#00000029" />
  </effect-style>
</styles>
```

### `<text-style>`

Captures a full Figma text style — typography only. Color and layout are always inlined on the node.

| Attr | Notes |
|---|---|
| `name` | Figma style name, e.g. `Heading/H1` |
| `font-family` | Font family |
| `font-size` | px |
| `font-weight` | `100`–`900` |
| `font-style` | `italic` — omitted when normal |
| `line-height` | px or `%` — omitted when auto |
| `letter-spacing` | px or `%` — omitted when 0 |
| `decoration` | `underline`, `strikethrough` — omitted when none |
| `text-case` | `uppercase`, `lowercase`, `capitalize`, `small-caps` — omitted when none |

Text nodes reference with `text-style="name"`. Individual typography attrs are omitted when a style is applied.

```xml
<text text-style="Heading/H1" value="Welcome" color="#1C1C1E" />
<text text-style="Body/Regular" value="Sign in to continue" color="#6E6E73" />
```

### `<fill-style>`

Captures a Figma color/fill style. Currently limited to solid colors.

| Attr | Notes |
|---|---|
| `name` | Figma style name |
| `value` | Hex color value |

Nodes reference with `fill-style="name"`. When applied, the `fill` attr is omitted.

### `<effect-style>`

Captures a Figma effect style. Effects are emitted as `<effect>` children using the same format as `<appearance><effect>` inline effects.

| Attr | Notes |
|---|---|
| `name` | Figma style name |

Nodes reference with `effect-style="name"`.

---

## Fonts

Font declarations describe where renderers may load a font from. Text nodes still carry their own `font-family`, `font-weight`, and `font-style`; the `<fonts>` block only makes those families resolvable.

```xml
<fonts>
  <font family="Inter" source="google" category="sans-serif" weights="400 500 700" styles="normal italic" />
  <font family="SF Pro Display" source="system" weights="400 600" styles="normal" />
  <font family="Brand Sans" source="unresolved" weights="500" styles="normal" />
</fonts>
```

| Attr | Values | Notes |
|---|---|---|
| `family` | string | Font family used by `<text font-family="...">` |
| `source` | `google`, `system`, `unresolved` | `google` may be loaded by the renderer; `system` and `unresolved` are left to CSS/browser resolution |
| `category` | string | Optional Google font category: `sans-serif`, `serif`, `monospace`, `display`, `handwriting` |
| `weights` | space-separated numbers | Used weights, e.g. `400 600 700` |
| `styles` | `normal`, `italic` | Used styles |

---

## Assets

Embedded assets referenced by `id` anywhere in the tree. The Figma plugin exports raster images as **WebP** (converted from Figma's native PNG/JPG via Canvas API). Complex vector artwork is stored as SVG assets.

```xml
<assets>
  <image id="img-1" format="webp" src="assets/img-1.webp" />
  <image id="svg-1" format="svg" src="assets/svg-1.svg" />
</assets>
```

Inline exports embed base64 directly:

```xml
<assets>
  <image id="img-1" format="webp" src="base64:..." />
</assets>
```

Reference assets with `$id`:
```xml
<img src="$img-1" w="390" h="240" fit="cover" />
```

| Attr | Values | Notes |
|---|---|---|
| `id` | string | Referenced as `$id` in the tree |
| `format` | `webp`, `png`, `jpg`, `svg` | `webp` is the plugin default for raster images |
| `src` | `base64:<data>` or path | Base64-encoded binary for inline, relative asset path for packaged |

---

## Fill Values

The `fill` attribute accepts:

| Value | Example |
|---|---|
| Hex color (opaque) | `#1C1C1E` |
| Hex color (with alpha) | `#1C1C1ECC` — 8-digit hex, last byte is alpha |
| Linear gradient | `linear-gradient(135deg, #FF6B6B 0%, #4ECDC4 100%)` |
| Radial gradient | `radial-gradient(circle at 50% 30%, #FFFFFF 0%, #000000 100%)` |
| Angular gradient | `conic-gradient(from 0deg at 50% 50%, #FF6B6B 0deg, #4ECDC4 360deg)` |
| Token reference | `$primary` |

`fill="..."` is shorthand for a single simple color-like paint. Nodes with image fills or multiple visible fills use an explicit `<appearance>` block instead.

---

## Appearance

`<appearance>` is a non-layout child that describes the parent layer's paint and effect stack. Use it when a node has multiple fills, any image fill, or multiple renderable effects.

```xml
<frame w="320" h="180">
  <appearance>
    <fill type="image" src="$img-1" fit="cover" />
    <fill type="color" value="#00000066" />
    <effect type="drop-shadow" x="0" y="8" radius="24" spread="0" color="#00000033" />
  </appearance>
  ...
</frame>
```

### `<fill>` attrs

| Attr | Type | Values |
|---|---|---|
| `type` | keyword | `color`, `linear-gradient`, `radial-gradient`, `angular-gradient`, `image` |
| `value` | color / gradient / token | Required for color and gradient fills |
| `src` | asset ref | Required for image fills |
| `fit` | keyword | `cover`, `contain`, `crop`, `tile` for image fills |
| `x` / `y` | number | Rendered image offset for `fit="crop"` |
| `width` / `height` | number | Rendered image dimensions for `fit="crop"` |
| `opacity` | number | 0–1 |

### `<effect>` attrs

| Attr | Type | Values |
|---|---|---|
| `type` | keyword | `drop-shadow`, `inner-shadow`, `layer-blur`, `background-blur`, `glass` |
| `x` / `y` | number | Shadow offset in px (shadows only) |
| `radius` | number | Shadow blur or blur radius in px |
| `spread` | number | Shadow spread in px (shadows only) |
| `color` | color | Shadow color (shadows only) |
| `blend` | keyword | Figma blend mode when not `normal` |
| `saturation` | number | Saturation percentage for `glass` (e.g. `180` = 180%) |

| Figma effect | .gui output |
|---|---|
| `DROP_SHADOW` | `<effect type="drop-shadow" ... />` |
| `INNER_SHADOW` | `<effect type="inner-shadow" ... />` |
| `LAYER_BLUR` | `<effect type="layer-blur" radius="..." />` |
| `BACKGROUND_BLUR` | `<effect type="background-blur" radius="..." />` |
| `GLASS` | `<effect type="glass" radius="..." saturation="..." />` |

---

## Shared Visual Attrs

These attrs apply to all layout, content, and shape tags unless noted.

| Attr | Type | Values | Notes |
|---|---|---|---|
| `name` | string | — | Figma layer name |
| `opacity` | number | 0–1 | Omitted when 1 |
| `blend` | keyword | `multiply`, `screen`, `overlay`, `darken`, `lighten`, `color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`, `exclusion`, `hue`, `saturation`, `color`, `luminosity`, `linear-burn`, `linear-dodge` | Omitted when `normal` or `pass-through` |
| `mask` | boolean presence | — | Alpha mask for subsequent siblings |
| `rotation` | number | degrees | Omitted when 0 |
| `constraint-h` | keyword | `right`, `center`, `scale`, `stretch` | `left` is default, omitted |
| `constraint-v` | keyword | `bottom`, `center`, `scale`, `stretch` | `top` is default, omitted |
| `w` | number, `"fill"` | — | Width. On `row`/`col`/`stack`/`text`/`instance`: absent = hug. On `frame`/`shape`/`img`/`svg`/`group`: required |
| `h` | number, `"fill"` | — | Height. On `row`/`col`/`stack`/`text`/`instance`: absent = hug. On `frame`/`shape`/`img`/`svg`/`group`: required |
| `abs` | boolean presence | — | Absolute child inside an auto-layout parent. Replaces `layout-position="absolute"` |
| `min-width` / `max-width` | number | px | Omitted when unset |
| `min-height` / `max-height` | number | px | Omitted when unset |

**`w` / `h` sizing rules**

| Node type | Absent means | `"fill"` | number |
|---|---|---|---|
| `row`, `col`, `stack` | hug children | fill parent | fixed px |
| `text` | hug content | fill parent | fixed px |
| `instance` | inherits from component | fill parent | fixed px |
| `frame`, `shape`, `img`, `svg`, `group` | **required — must provide a value** | fill parent | fixed px |

**Boolean presence convention**

Bare attributes without a value are treated as `true`. Applies to: `clip`, `mask`, `wrap`, `abs`, `truncate`, `reverse-z`.

---

## Layout Tags

### `<row>` — horizontal auto-layout

Sugar for `<stack direction="horizontal">`. Preferred form.

```xml
<row gap="12" p="16 24" align="middle-left" fill="#fff" radius="8">
  ...
</row>
```

### `<col>` — vertical auto-layout

Sugar for `<stack direction="vertical">`. Preferred form.

```xml
<col gap="16" p="24" align="top-left" fill="#F2F2F7" radius="12">
  ...
</col>
```

### `<grid>` — grid auto-layout

Sugar for `<stack direction="grid">`.

```xml
<grid columns="3" gap="16 12" p="16">
  ...
</grid>
```

`columns` = column count. `gap="col-gap row-gap"` (two values for column + row gap).

### `<stack>` — explicit direction

Use when the direction needs to be a variable or when migrating from v0.1. Prefer `<row>` / `<col>` / `<grid>` for new authoring.

```xml
<stack direction="horizontal" gap="12" p="16 24" align="middle-left" fill="#fff">
  ...
</stack>
```

### Layout attrs (all auto-layout tags)

| Attr | Values | Default | Notes |
|---|---|---|---|
| `w` | number, `"fill"` | absent = hug | |
| `h` | number, `"fill"` | absent = hug | |
| `gap` | number, `"auto"`, `"N N"` | — | `gap` bare = space-between; `"16"` = fixed; `"16 10"` = item + row gap |
| `align` | 9-point value, `stretch`, `baseline` | `top-left` | Replaces `justify` + `align` pair |
| `p` | CSS shorthand | — | Replaces `padding` |
| `pt` `pr` `pb` `pl` | px | — | Per-side padding, overrides `p` for that side |
| `wrap` | boolean presence | — | Allow children to wrap onto new lines |
| `reverse-z` | boolean presence | — | Draw earlier children above later children |
| `columns` | number | — | `<grid>` only |
| `direction` | `horizontal`, `vertical`, `grid` | — | `<stack>` only |
| `fill` | color / gradient / token | — | Background paint |
| `radius` | number / token | — | Corner radius |
| `clip` | boolean presence | — | Clip children to bounds |

**Align — 9-point grid**

`align` is a single attr that replaces both `justify` and `align`. Nine positions:

```
top-left      top-center      top-right
middle-left   middle-center   middle-right
bottom-left   bottom-center   bottom-right
```

Plus `stretch` (cross axis) and `baseline` (horizontal stacks only).

**Gap**

```xml
gap             →  space-between (presence = auto)
gap="auto"      →  same, explicit
gap="16"        →  fixed 16px between items
gap="16 10"     →  16px between items, 10px between rows (wrap/grid)
gap="16 auto"   →  16px between items, rows distributed evenly
```

### `<frame>` — fixed container

Children are absolutely positioned. Maps to a Figma frame without auto-layout.

```xml
<frame w="390" h="844" fill="#FFFFFF" radius="16" clip>
  <text abs x="24" y="80" value="Hello" ... />
</frame>
```

| Attr | Type | Values |
|---|---|---|
| `w` | number, `"fill"` | Required |
| `h` | number, `"fill"` | Required |
| `x` / `y` | number | Position (omitted on root frame) |
| `fill` | color / gradient / token | Single background paint |
| `radius` | number / token | Corner radius. `"12 12 0 0"` for per-corner (TL TR BR BL) |
| `corner-smoothing` | number | 0–1 (Figma squircle) |
| `stroke` | color / token | Border color (shorthand) |
| `stroke-width` | number | Border width in px |
| `stroke-position` | keyword | `inside`, `outside`, `center` |
| `clip` | boolean presence | Clip children to bounds |
| + shared visual attrs | | See Shared Visual Attrs table |

### `<group>` — logical grouping

No layout behavior. Children are absolutely positioned relative to the group origin.

```xml
<group x="0" y="0" w="390" h="200" opacity="0.8">
  ...
</group>
```

When the first child of a Figma group is a mask node, the plugin extracts the mask shape as an SVG asset and hoists it onto the `<group>`:

```xml
<group x="0" y="0" w="390" h="200"
       mask-src="$svg-2" mask-x="0" mask-y="0" mask-width="390" mask-height="200">
  ...
</group>
```

| Attr | Notes |
|---|---|
| `w` / `h` | Required |
| `mask-src` | Asset ref (`$id`) for the SVG mask shape |
| `mask-x` / `mask-y` | Position of the mask relative to group origin |
| `mask-width` / `mask-height` | Dimensions of the mask |

---

## Content Tags

### `<text>`

Single-style text is self-closing with a `value` attribute. Mixed-style text has `<segment>` children.

```xml
<!-- Single style -->
<text value="Welcome back" font-family="Inter" font-size="22" font-weight="700"
      color="#1C1C1E" line-height="28" />

<!-- With a named text style -->
<text text-style="Heading/H1" value="Welcome back" color="#1C1C1E" />

<!-- Mixed styles -->
<text>
  <segment value="Hello " font-size="16" font-weight="400" color="#6E6E73" />
  <segment value="World" font-size="16" font-weight="700" color="#1C1C1E" />
</text>
```

| Attr | Type | Values | Notes |
|---|---|---|---|
| `value` | string | Text content | XML-escaped; line breaks are `&#10;`. Omitted when using `<segment>` children |
| `x` / `y` | number | Position | |
| `w` / `h` | number, `"fill"` | — | Absent = hug text content |
| `text-style` | string | Style name | Reference to `<text-style>` |
| `font-family` | string / token | — | |
| `font-size` | number | px | |
| `font-weight` | number | `100`–`900` | |
| `font-style` | keyword | `italic` | Omitted when normal |
| `color` | color / token | — | |
| `line-height` | number / string | px or `%` | `auto` omitted |
| `letter-spacing` | number / string | px or `%` | Omitted when 0 |
| `paragraph-spacing` | number | px | |
| `paragraph-indent` | number | px | |
| `align` | keyword | `left`, `center`, `right`, `justified` | `left` omitted |
| `vertical-align` | keyword | `top`, `center`, `bottom` | `top` omitted |
| `decoration` | keyword | `underline`, `strikethrough` | Omitted when none |
| `text-case` | keyword | `uppercase`, `lowercase`, `capitalize`, `small-caps`, `small-caps-forced` | |
| `leading-trim` | keyword | `cap-height`, `normal` | |
| `truncate` | boolean presence | — | Ellipsis truncation |
| `max-lines` | number | — | Max visible lines |
| `href` | string | URL | |

### `<segment>`

Child of `<text>`. Represents a run of characters sharing the same style.

| Attr | Type | Values |
|---|---|---|
| `value` | string | Characters in this run |
| `font-family` | string | Font name |
| `font-size` | number | px |
| `font-weight` | number | `100`–`900` |
| `font-style` | keyword | `italic` |
| `line-height` | number / string | px or `%` |
| `letter-spacing` | number / string | px or `%` |
| `color` | color | Text color for this run |
| `decoration` | keyword | `underline`, `strikethrough` |
| `text-case` | keyword | `uppercase`, `lowercase`, `capitalize`, `small-caps` |
| `href` | string | URL — hyperlink for this run only |

---

### `<img>`

Raster image. `src` accepts an asset reference or an external URL.

```xml
<!-- From assets -->
<img src="$img-1" w="390" h="240" fit="cover" radius="12" />

<!-- External URL — no asset declaration needed -->
<img src="https://example.com/photo.jpg" w="390" h="240" fit="cover" />
```

| Attr | Type | Values |
|---|---|---|
| `src` | asset ref or URL | `$id` or `https://...` |
| `x` / `y` | number | Position |
| `w` / `h` | number, `"fill"` | Required |
| `fit` | keyword | `cover`, `contain`, `fill`, `none` |
| `radius` | number / token | Corner radius |
| `corner-smoothing` | number | 0–1. Advisory only |
| + shared visual attrs | | See Shared Visual Attrs table |

---

### `<svg>`

Vector artwork. Two modes: **asset reference** or **inline content**.

**Asset reference** — `src` points to an `<assets>` entry or external URL:

```xml
<svg src="$svg-1" x="24" y="24" w="48" h="48" />
```

**Inline content** — omit `src`. Children are raw SVG elements rendered directly. No asset entry needed:

```xml
<svg w="48" h="48">
  <circle cx="24" cy="24" r="20" fill="#007AFF" />
  <path d="M12 24l8 8 16-16" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" />
</svg>
```

The distinction is `src` presence. When `src` is absent, all XML children are serialized into a `<svg viewBox="0 0 w h">` container. Inline SVG is not validated by the `.gui` parser.

| Attr | Type | Values |
|---|---|---|
| `src` | asset ref or URL | Optional — omit for inline content |
| `x` / `y` | number | Position |
| `w` / `h` | number | Required |
| + shared visual attrs | | See Shared Visual Attrs table |

---

## Shape Tag

### `<shape>`

Unified tag for primitive shapes. `type="path"` is used for VECTOR, STAR, POLYGON, and BOOLEAN_OPERATION nodes.

```xml
<!-- Rectangle -->
<shape type="rect" w="340" h="52" fill="$primary" radius="12" />

<!-- Ellipse (full circle) -->
<shape type="ellipse" w="40" h="40" fill="#007AFF" />

<!-- Arc / donut segment -->
<shape type="ellipse" w="100" h="100"
       fill="#007AFF" arc-start="0" arc-end="270" arc-inner="0.6" />

<!-- Line -->
<shape type="line" w="390" stroke="#E5E5EA" stroke-width="1" />

<!-- Path — filled (star, polygon, boolean op) -->
<shape type="path" w="24" h="24" fill="#1C1C1E">
  <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
</shape>

<!-- Path — stroked icon (Lucide, Heroicons pattern) -->
<shape type="path" w="24" h="24" fill="none" stroke="#6366F1" stroke-width="1.5">
  <path d="M5 12h14M12 5l7 7-7 7" />
</shape>
```

#### `<shape>` attrs

| Attr | Type | Values | Applies to |
|---|---|---|---|
| `type` | keyword | `rect`, `ellipse`, `line`, `path` | all |
| `x` / `y` | number | Position | all |
| `w` / `h` | number | Required | all (h omitted for `line`) |
| `fill` | color / gradient / token | — | `rect`, `ellipse`, `path` |
| `fill-style` | string | Style name | `rect`, `ellipse`, `path` |
| `radius` | number / token | Corner radius | `rect` |
| `corner-smoothing` | number | 0–1. Advisory only | `rect` |
| `stroke` | color / token | Stroke color | all |
| `stroke-width` | number | Stroke width in px | all |
| `stroke-position` | keyword | `inside`, `outside`, `center` | `rect`, `ellipse`, `path` |
| `stroke-cap` | keyword | `round`, `square`, `arrow-lines`, `arrow-equilateral` | `line` |
| `arc-start` | number | Start angle in degrees (0 = 3 o'clock, clockwise) | `ellipse` |
| `arc-end` | number | End angle in degrees | `ellipse` |
| `arc-inner` | number | 0–1 inner radius ratio for donut shapes | `ellipse` |
| + shared visual attrs | | See Shared Visual Attrs table | all |

---

## Tag Summary

| Tag | Figma Node | Notes |
|---|---|---|
| `<gui>` | — | Root element |
| `<tokens>` | Styles / Variables | `<color>` `<number>` `<string>` children |
| `<styles>` | Text / Fill / Effect styles | `<text-style>` `<fill-style>` `<effect-style>` children |
| `<fonts>` | Text fonts | `<font>` children |
| `<assets>` | — | `<image>` children; webp preferred |
| `<appearance>` | Fills / Effects | Non-layout appearance block |
| `<fill>` | Fill paint | Child of `<appearance>` |
| `<effect>` | Effect | Child of `<appearance>` |
| `<col>` | Auto Layout Frame (vertical) | Preferred for vertical flow |
| `<row>` | Auto Layout Frame (horizontal) | Preferred for horizontal flow |
| `<grid>` | Auto Layout Frame (grid) | Preferred for multi-column grids |
| `<stack>` | Auto Layout Frame | Explicit direction via `direction` attr |
| `<frame>` | Frame | Fixed container, children absolutely positioned |
| `<group>` | Group | Logical grouping, children absolutely positioned |
| `<text>` | Text | Leaf node; self-closing or with `<segment>` children |
| `<segment>` | Text run | Child of `<text>` for mixed-style text |
| `<img>` | Image fill | Raster image; asset ref or external URL |
| `<svg>` | Complex vector artwork | Asset ref or inline SVG children |
| `<shape>` | Rectangle / Ellipse / Line / Path | `type="rect\|ellipse\|line\|path"` |

---

## Components & Instances

Reusable component definitions and instances. A `<components>` block holds all definitions. Instances reference a component by id and pass prop values as flat attributes.

### Tags

| Tag | Description |
|---|---|
| `<component>` | Standalone reusable component |
| `<component-set>` | Variant group — contains `<variant>` children |
| `<variant>` | One variant inside a `<component-set>` — has variant key attrs and optional `<props>` |
| `<instance>` | Component usage — references a component or variant by `component` id |
| `<props>` | Declares the overridable surface of a component or variant |
| `<prop>` | One overridable property — `name`, `type`, `target`, optional `bind` |

---

### Prop types

Every `<prop>` has a data type. The type determines how the value is applied to the target layer.

| type | Applied as | `bind` required |
|---|---|---|
| `string` | `value` attr on the target `<text>` layer | no |
| `boolean` | Removes target layer from render when `"false"` | no |
| `color` | `fill` attr on the target layer | no |
| `image` | `src` attr on the target `<img>` layer | no |
| `component` | `component` attr on a target `<instance>` — swaps the nested instance | no |
| `number` | The layout or visual property named by `bind` | **yes** |

`bind` accepts any numeric property: `radius`, `opacity`, `gap`, `font-size`, `stroke-width`, `font-weight`, `letter-spacing`, `line-height`, `padding`, `pt`, `pr`, `pb`, `pl`.

---

### `target` — binding a prop to layers

`target` is the `id` of the layer this prop applies to.

**`target` is optional for `string` props** when the component body has exactly one `<text>` layer — the binding is unambiguous:

```xml
<!-- implicit target — only one text layer -->
<prop name="label" type="string" />

<!-- explicit target — multiple text layers, disambiguation required -->
<prop name="title"    type="string" target="card-title" />
<prop name="subtitle" type="string" target="card-subtitle" />
```

**`target` accepts a space-separated list** to apply one value to multiple layers at once — common in design systems where a theme color drives several layers simultaneously:

```xml
<!-- one prop updates icon, label, and indicator all at once -->
<prop name="accent" type="color" target="icon label indicator" />
```

Instances pass a single value and the renderer applies it to every listed target:

```xml
<instance component="comp-tab" accent="#007AFF" />
```

This works for all prop types. A `boolean` prop can show/hide multiple layers; a `number` prop with `bind="opacity"` can fade multiple layers together.

---

### 1. String — text content

Updates the text content of a `<text>` layer.

```xml
<components>
  <component name="Button" id="comp-button">
    <props>
      <prop name="label" type="string" target="label" />
    </props>
    <row gap="8" p="12 24" fill="$primary" radius="8">
      <text id="label" value="Button" font-size="16" font-weight="600" color="#fff" />
    </row>
  </component>
</components>

<instance component="comp-button" x="24" y="48" label="Get Started" />
<instance component="comp-button" x="24" y="96" label="Cancel" />
```

---

### 2. Boolean — show / hide a layer

Removes the target layer from render when the value is `"false"`. The layer is visible by default (the component body defines the default state).

```xml
<components>
  <component name="Button" id="comp-button">
    <props>
      <prop name="label"     type="string"  target="label" />
      <prop name="show-icon" type="boolean" target="icon" />
    </props>
    <row gap="8" p="12 24" fill="$primary" radius="8">
      <svg id="icon" src="$svg-arrow" w="16" h="16" />
      <text id="label" value="Button" font-size="16" font-weight="600" color="#fff" />
    </row>
  </component>
</components>

<!-- icon visible (default) -->
<instance component="comp-button" x="24" y="48" label="Continue" />

<!-- icon hidden -->
<instance component="comp-button" x="24" y="96" label="Skip" show-icon="false" />
```

---

### 3. Color — fill override

Updates the `fill` of any layer.

```xml
<components>
  <component name="Badge" id="comp-badge">
    <props>
      <prop name="label" type="string"  target="label" />
      <prop name="bg"    type="color"   target="surface" />
      <prop name="color" type="color"   target="label" />
    </props>
    <row id="surface" p="4 10" fill="$gray-100" radius="99">
      <text id="label" value="New" font-size="12" font-weight="600" color="$gray-800" />
    </row>
  </component>
</components>

<instance component="comp-badge" label="Live" bg="#FF3B30" color="#fff" />
<instance component="comp-badge" label="Beta" bg="#007AFF" color="#fff" />
```

Token references work the same way:

```xml
<instance component="comp-badge" label="Sale" bg="$brand-danger" color="$white" />
```

---

### 4. Image — asset override

Swaps the `src` of an `<img>` layer. The value is an asset reference (`$name`) or a direct URL.

```xml
<components>
  <component name="Avatar" id="comp-avatar">
    <props>
      <prop name="photo" type="image" target="photo" />
    </props>
    <img id="photo" src="$img-placeholder" w="40" h="40" radius="99" fit="cover" />
  </component>
</components>

<instance component="comp-avatar" photo="$img-user-1" />
<instance component="comp-avatar" photo="$img-user-2" />
```

---

### 5. Component — nested instance swap

Replaces a nested `<instance>` inside the component body with a different component. The value is the id of the replacement component.

```xml
<components>
  <component name="List Item" id="comp-list-item">
    <props>
      <prop name="label"       type="string"    target="label" />
      <prop name="leading-icon" type="component" target="leading-icon" />
    </props>
    <row gap="12" p="12 16" align="center">
      <instance id="leading-icon" component="comp-icon-placeholder" w="20" h="20" />
      <text id="label" value="Item" font-size="15" color="$text-primary" />
    </row>
  </component>
</components>

<instance component="comp-list-item" label="Notifications" leading-icon="comp-icon-bell" />
<instance component="comp-list-item" label="Settings"      leading-icon="comp-icon-gear" />
```

---

### 6. Number — numeric property override

Overrides any numeric layout or visual property on a layer. The `bind` attr names the property to update.

```xml
<components>
  <component name="Card" id="comp-card">
    <props>
      <prop name="title"   type="string" target="title" />
      <prop name="radius"  type="number" target="surface" bind="radius" />
      <prop name="opacity" type="number" target="surface" bind="opacity" />
      <prop name="gap"     type="number" target="surface" bind="gap" />
    </props>
    <col id="surface" gap="16" p="16" fill="$surface" radius="12">
      <text id="title" value="Card Title" font-size="18" font-weight="700" />
    </col>
  </component>
</components>

<instance component="comp-card" title="Rounded" radius="24" />
<instance component="comp-card" title="Faded"   opacity="0.5" />
```

---

### Component sets (variants)

A `<component-set>` groups related variants. Each `<variant>` has key-value attrs describing which variant it is (matching Figma variant properties) and its own `<props>` block.

```xml
<components>
  <component-set name="Button" id="compset-button">
    <variant id="comp-button-primary" style="primary" size="md">
      <props>
        <prop name="label"     type="string"  target="label" />
        <prop name="show-icon" type="boolean" target="icon" />
        <prop name="bg"        type="color"   target="surface" />
      </props>
      <row id="surface" gap="8" p="12 24" fill="$primary" radius="8">
        <svg id="icon" src="$svg-arrow" w="16" h="16" />
        <text id="label" value="Button" font-size="16" font-weight="600" color="#fff" />
      </row>
    </variant>
    <variant id="comp-button-secondary" style="secondary" size="md">
      <props>
        <prop name="label" type="string" target="label" />
      </props>
      <row gap="8" p="12 24" stroke="$primary" stroke-width="1.5" radius="8">
        <text id="label" value="Button" font-size="16" font-weight="600" color="$primary" />
      </row>
    </variant>
  </component-set>
</components>

<instance component="comp-button-primary"   label="Continue" />
<instance component="comp-button-secondary" label="Cancel" />
<instance component="comp-button-primary"   label="Buy Now" show-icon="false" bg="#FF3B30" />
```

Instances always reference a specific variant id — not the `<component-set>` id.

---

### Inferred props (Figma-authored components)

When exporting from Figma, the plugin does not require designers to have set up formal Figma component properties. It scans every instance of each component across the file, collects all overrides that were applied, and auto-generates the `<props>` block from actual usage.

| What the designer did in Figma | Inferred prop type |
|---|---|
| Edited text content on an instance | `string` |
| Toggled layer visibility on an instance | `boolean` |
| Changed a solid fill color on an instance | `color` |
| Swapped an image fill on an instance | `image` |
| Swapped a nested component on an instance | `component` |

The layer's sanitized name (kebab-case) becomes the prop name. If a formal Figma component property exists for the same field, that name is preferred.

---

### Detached instances

When an instance has overrides on **≥ 75% of the component body's layers** and the component body has **at least 4 layers**, it is considered structurally diverged. The plugin emits the live children as an inline node tree instead of an `<instance>` reference. A `component` attribute is preserved as origin metadata — informational only, no rendering promise:

```xml
<!-- detached — too many overrides, emitted as inline tree -->
<col component="comp-card" gap="16" p="16" fill="#FF3B30" radius="12">
  <text value="Custom title" font-size="18" font-weight="700" color="#fff" />
  <img src="$img-custom" w="fill" h="120" fit="cover" radius="8" />
</col>
```

The renderer treats this as a plain layout node. The `component` attr is ignored for rendering.

<instance component="comp-button-style-primary" x="24" y="400" label="Continue" />
<instance component="comp-button-style-secondary" x="24" y="460" label="Cancel" />
```

### Id generation

Every node inside a component body gets `id` = sanitized layer name (lowercase kebab-case). Duplicates are deduplicated: first `"Icon"` → `id="icon"`, second → `id="icon-2"`.

---

## dotgui-render API

A standalone renderer that converts `.gui` code into live DOM. Zero dependencies.

```ts
import { render } from 'dotgui-render'
```

### `render(code, container, assetMap?)`

| Param | Type | Description |
|---|---|---|
| `code` | `string` | Full `.gui` XML document string |
| `container` | `HTMLElement` | Host element — cleared and populated on each call |
| `assetMap` | `Record<string, string>` _(optional)_ | Pre-built asset map `{ '$img-1': 'data:image/webp;base64,...' }`. When provided, the `<assets>` block in the XML is skipped — avoids re-parsing large base64 blobs |

**Returns** `((factor: number) => void) | null`

A zoom setter where `1` = fit-to-container. Returns `null` if parsing fails.

```ts
const setZoom = render(guiCode, containerEl, assetMap)
setZoom?.(2)    // 2× the fit-to-container scale
setZoom?.(0.5)  // half the fit scale
setZoom?.(1)    // reset to fit
```

Zoom is implemented via CSS `zoom` so the scrollable area updates correctly.

---

## Selection

The Figma plugin accepts any visible layer as input — not just frames. When a non-frame layer is selected (text, shape, group, vector, etc.), it is automatically wrapped in a `<frame>` of matching dimensions.

---

## Removed in v0.2

These attrs from v0.1 are **replaced** — do not use them in v0.2 files.

| Removed | Replaced by |
|---|---|
| `width` / `height` | `w` / `h` |
| `sizing-h` / `sizing-v` | `w` / `h` (absent = hug) |
| `padding` | `p` |
| `justify` | `align` (9-point) |
| `wrap-gap` | second value of `gap` |
| `wrap-align` | `gap="... auto"` |
| `layout-position="absolute"` | `abs` (boolean presence) |
| `clip="true"` `wrap="true"` etc. | `clip` `wrap` (bare attribute) |

---

## Deferred to v1.0 / v2

- `<scroll>` — scrollable containers
- `<overlay>` `<sheet>` — modal and bottom sheet layers
- Semantic roles — `role="button|input|nav"`
- W3C composite token types — `shadow`, `typography`, `border`
- `platform` / `theme` on root
- Interactions and prototyping
