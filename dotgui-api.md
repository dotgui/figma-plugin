# .gui Format — v1.0 Spec

A portable, text-based UI description format for representing Figma screens. XML-style tag markup carrying structure, visual properties, design tokens, and assets in a single file. Designed for 1-1 Figma layer mapping and AI agent consumption.

---

## File Structure

`.gui` can be exported in two forms:

- **Inline `.gui`**: a plain XML file with base64 assets embedded directly in `<assets>`.
- **Packaged `.gui`**: a ZIP/container file using the `.gui` extension. When unpacked it contains `index.gui` and an `assets/` folder.

```xml
<gui version="1.0" name="Checkout Screen" viewport="390x844">
  <preview format="webp" src="base64:..." />
  <tokens />
  <fonts />
  <assets />
  <frame>
    ...
  </frame>
</gui>
```

Packaged layout:

```txt
checkout.gui
```

Unpacked:

```txt
index.gui
preview.webp
assets/
  img-1.webp
  svg-1.svg
```

### `<gui>` attrs

| Attr | Type | Description |
|---|---|---|
| `version` | string | Spec version |
| `name` | string | Screen or layer name |
| `viewport` | string | Canvas dimensions `WxH` |

---

## Preview

`<preview>` stores a rendered thumbnail/preview of the full exported selection. It is metadata for file browsers, importers, and galleries; it is not rendered as part of the UI tree.

Inline exports embed the preview as WebP:

```xml
<preview format="webp" src="base64:..." />
```

Packaged exports store the preview as a root file:

```xml
<preview format="webp" src="preview.webp" />
```

| Attr | Values | Notes |
|---|---|---|
| `format` | `webp` | Preview image format |
| `src` | `base64:<data>` or `preview.webp` | Inline base64 in standalone XML, path in packaged exports |

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
| `<color>` | color | hex, rgb, rgba |
| `<number>` | number | unitless number |
| `<string>` | string | any string |

Reference tokens anywhere with `$name`:
```xml
<shape type="rect" fill="$primary" radius="$radius-card" />
```

> Text styles deferred to v2. Use inline props on `<text>` for now.

---

## Fonts

Font declarations describe where renderers may load a font from. Text nodes still carry their own `font-family`, `font-weight`, and `font-style`; the `<fonts>` block only makes those families resolvable.

```xml
<fonts>
  <font family="Inter" source="google" category="sans-serif" weights="400 500 700" styles="normal italic" variants="regular italic 500 700" />
  <font family="SF Pro Display" source="system" weights="400 600" styles="normal" />
  <font family="Brand Sans" source="unresolved" weights="500" styles="normal" />
</fonts>
```

| Attr | Values | Notes |
|---|---|---|
| `family` | string | Font family used by `<text font-family="...">` |
| `source` | `google`, `system`, `unresolved` | `google` may be loaded by the renderer; `system` and `unresolved` are left to CSS/browser resolution |
| `category` | string | Optional Google font category used for CSS fallback selection, e.g. `sans-serif`, `serif`, `monospace`, `display`, `handwriting` |
| `weights` | space-separated numbers | Used weights, e.g. `400 600 700` |
| `styles` | `normal`, `italic` | Used styles |
| `variants` | space-separated strings | Optional Google font variants from the Webfonts API, used to build valid Google CSS requests |

The Figma plugin validates families against `src/google-fonts.json`, emits `google` only for families in that catalog, emits `system` for common platform fonts, and emits `unresolved` otherwise. Font files are not embedded by default.

---

## Assets

Embedded assets referenced by `id` anywhere in the tree. The Figma plugin exports raster images as **WebP** (converted from Figma's native PNG/JPG via Canvas API) for optimal file size. Complex vector artwork is stored as SVG assets and referenced from `<svg>` nodes.

```xml
<assets>
  <image id="img-1" format="webp" src="base64:..." />
  <image id="img-2" format="png" src="base64:..." />
  <image id="svg-1" format="svg" src="base64:..." />
</assets>
```

In packaged exports, `index.gui` references external files instead of embedding base64:

```xml
<assets>
  <image id="img-1" format="webp" src="assets/img-1.webp" />
  <image id="svg-1" format="svg" src="assets/svg-1.svg" />
</assets>
```

Reference assets with `$id`:
```xml
<img src="$img-1" />
```

| Attr | Values | Notes |
|---|---|---|
| `id` | string | Referenced as `$id` in the tree |
| `format` | `webp`, `png`, `jpg`, `svg` | `webp` is the plugin default for raster images |
| `src` | `base64:<data>` or path | Base64-encoded binary for inline exports, relative asset path for packaged exports |

The plugin keeps small/simple exports inline. Larger or asset-heavy exports download as packaged `.gui`, where the visible file size reflects the final container size rather than the inline XML size.

---

## Fill Values

The `fill` attribute on `<frame>`, `<stack>`, and `<shape>` accepts:

| Value | Example |
|---|---|
| Hex color (opaque) | `#1C1C1E` |
| Hex color (with alpha) | `#1C1C1ECC` — 8-digit hex, last byte is alpha |
| Linear gradient | `linear-gradient(135deg, #FF6B6B 0%, #4ECDC4 100%)` |
| Radial gradient | `radial-gradient(circle at 50% 30%, #FFFFFF 0%, #000000 100%)` |
| Angular gradient | `conic-gradient(from 0deg at 50% 50%, #FF6B6B 0deg, #4ECDC4 360deg)` |

Gradient angles are computed from Figma's `gradientTransform` matrix, corrected for the node's aspect ratio so the visual angle matches exactly. Radial and angular gradient center position is derived from the transform as well.

`fill="..."` is shorthand for a single simple color-like paint. Figma nodes with image fills or multiple visible fills use an explicit `<appearance>` block instead.

---

## Appearance

`<appearance>` is a non-layout child that describes the parent layer's paint and effect stack. The renderer draws appearance fills behind normal children and applies appearance effects to the parent layer. Use it when a node has multiple fills, any image fill, or multiple renderable effects.

```xml
<frame x="0" y="0" width="320" height="180">
  <appearance>
    <fill type="image" src="$img-1" fit="cover" />
    <fill type="image" src="$img-2" fit="crop" x="-24" y="-10" width="420" height="260" />
    <fill type="color" value="#00000066" />
    <effect type="drop-shadow" x="0" y="8" radius="24" spread="0" color="#00000033" />
  </appearance>
  ...
</frame>
```

The simple shorthand:

```xml
<frame fill="#FFFFFF" />
```

is equivalent to a single appearance color fill.

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

For cropped image fills, `x`, `y`, `width`, and `height` describe the rendered image box inside the parent layer. The parent bounds clip that image box, preserving Figma's crop position and scale.

### `<effect>` attrs

Renderable Figma effects are emitted as child tags of `<appearance>`.

| Attr | Type | Values |
|---|---|---|
| `type` | keyword | `drop-shadow`, `inner-shadow`, `layer-blur`, `background-blur` |
| `x` / `y` | number | Shadow offset in px. Shadows only |
| `radius` | number | Shadow blur or blur radius in px |
| `spread` | number | Shadow spread in px. Shadows only |
| `color` | color | Shadow color. Shadows only |
| `blend` | keyword | Figma blend mode when not `normal` |

The plugin maps Figma's effect API this way:

| Figma effect | .gui output |
|---|---|
| `DROP_SHADOW` | `<effect type="drop-shadow" ... />` |
| `INNER_SHADOW` | `<effect type="inner-shadow" ... />` |
| `LAYER_BLUR` with normal blur | `<effect type="layer-blur" radius="..." />` |
| `BACKGROUND_BLUR` with normal blur | `<effect type="background-blur" radius="..." />` |
| `NOISE`, `TEXTURE`, `GLASS`, progressive blurs | Exported as SVG assets for fidelity |

---

## Shared Visual Attrs

These attrs apply to all layout, content, and shape tags unless noted.

| Attr | Type | Values | Notes |
|---|---|---|---|
| `opacity` | number | 0–1 | Omitted when 1 |
| `blend` | keyword | `multiply`, `screen`, `overlay`, `darken`, `lighten`, `color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`, `exclusion`, `hue`, `saturation`, `color`, `luminosity`, `linear-burn`, `linear-dodge` | Omitted when `normal` or `pass-through` |
| `mask` | boolean | `true` | Marks node as an alpha mask for subsequent siblings |
| `rotation` | number | Degrees | Omitted when 0 |
| `constraint-h` | keyword | `right`, `center`, `scale`, `stretch` | Horizontal pin/resize constraint. `left` is default and omitted |
| `constraint-v` | keyword | `bottom`, `center`, `scale`, `stretch` | Vertical pin/resize constraint. `top` is default and omitted |
| `sizing-h` | keyword | `hug`, `fill` | Horizontal sizing mode when inside auto-layout. Omitted when `fixed` |
| `sizing-v` | keyword | `hug`, `fill` | Vertical sizing mode when inside auto-layout. Omitted when `fixed` |
| `layout-position` | keyword | `absolute` | Marks an auto-layout child as absolute-positioned, so it uses `x` / `y` instead of participating in stack flow |
| `min-width` | number | px | Min width constraint. Omitted when unset |
| `max-width` | number | px | Max width constraint. Omitted when unset |
| `min-height` | number | px | Min height constraint. Omitted when unset |
| `max-height` | number | px | Max height constraint. Omitted when unset |

---

## Layout Tags

### `<frame>`

Fixed container. Maps to Figma Frame. Children are absolutely positioned.

```xml
<frame name="Card" width="358" height="200" x="16" y="100"
       fill="#FFFFFF" radius="12" corner-smoothing="0.6"
       stroke="#E5E5EA" stroke-width="1"
       shadow="0 4 16 0 #00000026" clip="true"
       opacity="0.9" blend="multiply">
  ...
</frame>
```

| Attr | Type | Values |
|---|---|---|
| `name` | string | Layer name |
| `width` | number | px (root frame only uses numbers) |
| `height` | number | px |
| `x` | number | Absolute x position (omitted on root frame) |
| `y` | number | Absolute y position (omitted on root frame) |
| `fill` | color / gradient / token | Single simple background paint — see Fill Values |
| `radius` | number / token | Corner radius. `"12 12 0 0"` for per-corner (TL TR BR BL) |
| `corner-smoothing` | number | 0–1 smoothing factor (Figma squircle). Advisory only |
| `stroke` | color / token | Border color |
| `stroke-width` | number | Border width in px |
| `stroke-position` | keyword | `inside`, `outside`, `center` |
| `shadow` | string | `offsetX offsetY blur spread color` |
| `clip` | boolean | Clip children to bounds |
| + shared visual attrs | | See Shared Visual Attrs table |

---

### `<stack>`

Auto-layout container. Maps to Figma Auto Layout Frame. Children are flow-positioned.

```xml
<stack name="Navbar" direction="horizontal" gap="12" padding="16 24"
       align="center" justify="space-between"
       wrap="true" wrap-gap="8" wrap-align="space-between"
       fill="$surface">
  ...
</stack>
```

Inherits all `<frame>` attrs plus:

| Attr | Type | Values |
|---|---|---|
| `direction` | keyword | `horizontal`, `vertical`, `grid` |
| `gap` | number / token | Space between children in px. `horizontal` and `vertical` only |
| `reverse-z` | boolean | Draw earlier children above later children for overlapping auto-layout items |
| `padding` | number / token | `all`, `v h`, `top right bottom left` |
| `align` | keyword | Cross-axis: `start`, `center`, `end`, `stretch`, `baseline` |
| `justify` | keyword | Main-axis: `start`, `center`, `end`, `space-between` |
| `wrap` | boolean | Allow children to wrap onto new lines |
| `wrap-gap` | number | Gap between wrap rows/columns in px |
| `wrap-align` | keyword | `space-between` — distribution of wrap lines on the cross axis |
| `grid-columns` | number | Column count for `direction="grid"` |
| `grid-rows` | number | Row count for `direction="grid"` |
| `grid-col-gap` | number | Column gap in px for `direction="grid"` |
| `grid-row-gap` | number | Row gap in px for `direction="grid"` |

---

### `<group>`

Logical grouping with no layout. Maps to Figma Group. The group `x` / `y` is relative to its parent, and children are absolutely positioned relative to the group bounds.

```xml
<group name="Hero Section" x="0" y="0" width="390" height="200" opacity="0.8" blend="multiply">
  ...
</group>
```

| Attr | Type | Description |
|---|---|---|
| `name` | string | Layer name |
| `x` / `y` | number | Position |
| `width` / `height` | number | Bounding box dimensions |
| + shared visual attrs | | See Shared Visual Attrs table |

---

## Content Tags

### `<text>`

Text node. Self-closing when all characters share the same style. When a text node has mixed styles (different fonts, colors, or decorations per range), it renders `<segment>` children instead of a flat `value` attr.

```xml
<!-- Single style -->
<text value="Welcome back" x="24" y="80" width="200" height="56"
      font-family="Inter" font-size="28" font-weight="700" font-style="italic"
      line-height="34" letter-spacing="-0.5"
      paragraph-spacing="16" paragraph-indent="24"
      color="#1C1C1E" align="center" vertical-align="center"
      decoration="underline" text-case="uppercase"
      leading-trim="cap-height"
      truncate="true" max-lines="2"
      href="https://example.com"
      opacity="1" />

<!-- Mixed styles -->
<text x="24" y="80" width="200" height="56" align="left">
  <segment value="Hello " font-family="Inter" font-size="16" font-weight="400" color="#1C1C1E" />
  <segment value="World" font-family="Poppins" font-size="24" font-weight="700" color="#007AFF" href="https://example.com" />
</text>
```

| Attr | Type | Values | Notes |
|---|---|---|---|
| `value` | string | Text content | XML-escaped; line breaks are encoded as `&#10;`. Omitted when using `<segment>` children |
| `x` / `y` | number | Position | |
| `width` / `height` | number / keyword | `n`, `hug` | `hug` = fit-content; emitted when Figma text auto-resizes on that axis |
| `font-family` | string / token | Font name | |
| `font-size` | number | px | |
| `font-weight` | number | `100`–`900` | Derived from Figma style name |
| `font-style` | keyword | `italic` | Omitted when normal |
| `line-height` | number / string | `34` (px), `150%` | `auto` omitted |
| `letter-spacing` | number / string | `1.5` (px), `5%` | Omitted when 0 |
| `paragraph-spacing` | number | px | Space between paragraphs |
| `paragraph-indent` | number | px | First-line indent |
| `color` | color / token | Text color | Solid fill only; use `<appearance>` for multi-fill |
| `align` | keyword | `left`, `center`, `right`, `justified` | `left` omitted |
| `vertical-align` | keyword | `top`, `center`, `bottom` | `top` omitted |
| `decoration` | keyword | `underline`, `strikethrough` | Omitted when none |
| `text-case` | keyword | `uppercase`, `lowercase`, `capitalize`, `small-caps`, `small-caps-forced` | Omitted when none |
| `leading-trim` | keyword | `cap-height`, `normal` | Trims ascender/descender whitespace |
| `truncate` | boolean | `true` | Enable text truncation with ellipsis |
| `max-lines` | number | Line count | Max visible lines before ellipsis. Used with `truncate="true"` |
| `href` | string | URL | Hyperlink applied to the whole text node |
| + shared visual attrs | | See Shared Visual Attrs table | |

### `<segment>`

Child of `<text>`. Represents a run of characters sharing the same style within a mixed-style text node. Has no children.

| Attr | Type | Values |
|---|---|---|
| `value` | string | Characters in this run (XML-escaped; line breaks are encoded as `&#10;`) |
| `font-family` | string | Font name |
| `font-size` | number | px |
| `font-weight` | number | `100`–`900` |
| `font-style` | keyword | `italic` |
| `line-height` | number / string | `34` (px), `150%` |
| `letter-spacing` | number / string | `1.5` (px), `5%` |
| `color` | color | Text color for this run |
| `decoration` | keyword | `underline`, `strikethrough` |
| `text-case` | keyword | `uppercase`, `lowercase`, `capitalize`, `small-caps` |
| `href` | string | URL — hyperlink for this run only |

---

### `<img>`

Raster image. References an asset from `<assets>`.

```xml
<img src="$img-1" x="0" y="0" width="390" height="240"
     fit="cover" radius="12" corner-smoothing="0.5" opacity="1" />
```

| Attr | Type | Values |
|---|---|---|
| `src` | asset ref | `$id` referencing an `<assets>` entry |
| `x` / `y` | number | Position |
| `width` / `height` | number / keyword | `n`, `fill`, `hug` |
| `fit` | keyword | `cover`, `contain`, `fill`, `none` |
| `radius` | number / token | Corner radius |
| `corner-smoothing` | number | 0–1 smoothing factor. Advisory only |
| `stroke` | color | Border color |
| `stroke-width` | number | Border width |
| + shared visual attrs | | See Shared Visual Attrs table |

---

### `<svg>`

Exported vector artwork. References an SVG asset from `<assets>`. The Figma plugin uses this for complex graphic-only clusters where native shapes would lose fidelity, such as boolean operations, compound vectors, vector effects, and multi-layer icon groups.

```xml
<svg src="$svg-1" x="24" y="24" width="48" height="48" opacity="1" />
```

| Attr | Type | Values |
|---|---|---|
| `src` | asset ref | `$id` referencing an SVG `<assets>` entry |
| `x` / `y` | number | Position |
| `width` / `height` | number | Dimensions |
| + shared visual attrs | | See Shared Visual Attrs table |

---

## Shape Tags

### `<shape>`

Unified tag for primitive shapes. Vector/path artwork is exported as `<svg>` assets instead.

```xml
<!-- Rectangle -->
<shape type="rect" x="0" y="0" width="48" height="48" radius="24"
       fill="$primary" stroke="#000" stroke-width="1" corner-smoothing="0.6" />

<!-- Ellipse (full circle) -->
<shape type="ellipse" x="12" y="12" width="8" height="8" fill="#FF3B30" />

<!-- Arc / pie slice -->
<shape type="ellipse" x="0" y="0" width="100" height="100"
       fill="#007AFF" arc-start="0" arc-end="270" />

<!-- Donut segment -->
<shape type="ellipse" x="0" y="0" width="100" height="100"
       fill="#007AFF" arc-start="0" arc-end="270" arc-inner="0.6" />

<!-- Line -->
<shape type="line" x="0" y="100" width="390"
       stroke="#E5E5EA" stroke-width="1" stroke-cap="round" />
```

#### `<shape>` attrs

| Attr | Type | Values | Applies to |
|---|---|---|---|
| `type` | keyword | `rect`, `ellipse`, `line`, `path` | all |
| `x` / `y` | number | Position | all |
| `width` / `height` | number | Dimensions | all (height omitted for `line`) |
| `fill` | color / gradient / token | Fill — see Fill Values | `rect`, `ellipse`, `path` |
| `radius` | number / token | Corner radius | `rect` |
| `corner-smoothing` | number | 0–1 smoothing factor. Advisory only | `rect` |
| `stroke` | color / token | Stroke color | all |
| `stroke-width` | number | Stroke width in px | all |
| `stroke-position` | keyword | `inside`, `outside`, `center` | `rect`, `ellipse`, `path` |
| `stroke-cap` | keyword | `round`, `square`, `arrow-lines`, `arrow-equilateral` | `line` |
| `arc-start` | number | Start angle in degrees (0 = 3 o'clock, clockwise) | `ellipse` |
| `arc-end` | number | End angle in degrees | `ellipse` |
| `arc-inner` | number | 0–1 inner radius ratio for donut shapes | `ellipse` |
| `shadow` | string | `offsetX offsetY blur spread color` | `rect`, `ellipse` |
| + shared visual attrs | | See Shared Visual Attrs table | all |

When `arc-start` or `arc-end` is omitted, full-circle defaults apply (0° and 360° respectively). When `arc-inner` is omitted the shape is a solid pie/sector; values > 0 produce a donut/annular sector.

---

## Tag Summary

| Tag | Figma Node | Notes |
|---|---|---|
| `<gui>` | — | Root element |
| `<tokens>` | Styles / Variables | `<color>` `<number>` `<string>` children |
| `<fonts>` | Text fonts | `<font>` children |
| `<font>` | Font declaration | Child of `<fonts>` |
| `<assets>` | — | `<image>` children; webp preferred |
| `<appearance>` | Fills / Effects | Non-layout appearance block |
| `<fill>` | Fill paint | Child of `<appearance>` |
| `<effect>` | Effect | Child of `<appearance>` |
| `<frame>` | Frame | Fixed container, children absolutely positioned |
| `<stack>` | Auto Layout Frame | Flow container, children in flex or grid layout |
| `<group>` | Group | Logical grouping, children absolutely positioned |
| `<text>` | Text | Leaf node; self-closing or with `<segment>` children |
| `<segment>` | Text run | Child of `<text>` for mixed-style text |
| `<img>` | Image fill | Raster image referencing `<assets>` |
| `<svg>` | Complex vector artwork | SVG asset referencing `<assets>` |
| `<shape>` | Rectangle / Ellipse / Line / Path | `type="rect\|ellipse\|line\|path"` |

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
| `assetMap` | `Record<string, string>` _(optional)_ | Pre-built asset map `{ '$img-1': 'data:image/webp;base64,...' }`. When provided, the `<assets>` block in the XML is skipped — avoids re-parsing large base64 blobs and prevents parse errors on large files |

**Returns** `((factor: number) => void) | null`

A zoom setter where `1` = fit-to-container. Multiply to zoom in/out. Returns `null` if the document failed to parse.

```ts
const setZoom = render(guiCode, containerEl, assetMap)
setZoom?.(2)    // 2× the fit-to-container scale
setZoom?.(0.5)  // half the fit scale
setZoom?.(1)    // reset to fit
```

Zoom is implemented via CSS `zoom` (not `transform`) so the scrollable area updates correctly — zooming in past fit enables native scroll on the container.

---

## Selection

The Figma plugin accepts any visible layer as input — not just frames. When a non-frame layer is selected (text, shape, group, vector, etc.), it is automatically wrapped in a `<frame>` of matching dimensions.

---

## Deferred to v2

- `<component>` + `<instance>` — component definitions and reuse
- `<scroll>` — scrollable containers
- `<overlay>` `<sheet>` — modal and bottom sheet layers
- Semantic roles — `role="button|input|nav"`
- Text style tokens — named typography styles
- W3C composite token types — `shadow`, `typography`, `border`
- `platform` / `theme` on root
- Interactions and prototyping
