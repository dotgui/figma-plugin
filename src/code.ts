import googleFonts from './google-fonts-compact.json'

figma.showUI(__html__, { width: 480, height: 600, title: 'dotgui' })

// --- constants (must be before any function calls due to const TDZ) ---

type AttrVal = string | number | boolean | null | undefined
interface ImageAsset { id: string; format: string; b64: string }
interface FontUsage { family: string; weights: Record<string, boolean>; styles: Record<string, boolean> }
interface GoogleFont { family: string; category?: string; variants?: string[] }

const ind = function(depth: number) { return '  '.repeat(depth) }

const ALIGN: Record<string, string> = {
  MIN: 'start', CENTER: 'center', MAX: 'end',
  BASELINE: 'baseline', SPACE_BETWEEN: 'space-between',
}

const VERT_FROM: Record<string, string> = { MIN: 'top', CENTER: 'middle', MAX: 'bottom' }
const HORIZ_FROM: Record<string, string> = { MIN: 'left', CENTER: 'center', MAX: 'right' }

function ninePointAlign(node: FrameNode): string | undefined {
  var primary = node.primaryAxisAlignItems as string
  var counter = node.counterAxisAlignItems as string
  var direction = node.layoutMode as string
  if (counter === 'BASELINE') return 'baseline'
  if (primary === 'SPACE_BETWEEN') primary = 'MIN'
  var vert: string
  var horiz: string
  if (direction === 'HORIZONTAL') {
    vert = VERT_FROM[counter] || 'top'
    horiz = HORIZ_FROM[primary] || 'left'
  } else {
    vert = VERT_FROM[primary] || 'top'
    horiz = HORIZ_FROM[counter] || 'left'
  }
  return vert + '-' + horiz
}

function stackGap(node: FrameNode): string | number | undefined {
  var primary = node.primaryAxisAlignItems as string
  var mainGapRaw: string | null = null
  if (primary === 'SPACE_BETWEEN') {
    mainGapRaw = 'auto'
  } else if (node.itemSpacing !== 0) {
    var gapBv = (node as any).boundVariables
    var tokenGap = gapBv && gapBv.itemSpacing && gapBv.itemSpacing.id && tokenRef(gapBv.itemSpacing.id)
    mainGapRaw = tokenGap || String(node.itemSpacing)
  }
  var crossGapRaw: string | null = null
  if (node.layoutWrap === 'WRAP') {
    if (node.counterAxisAlignContent === 'SPACE_BETWEEN') {
      crossGapRaw = 'auto'
    } else if (node.counterAxisSpacing != null && node.counterAxisSpacing > 0) {
      crossGapRaw = String(node.counterAxisSpacing)
    }
  }
  if (mainGapRaw !== null && crossGapRaw !== null) return mainGapRaw + ' ' + crossGapRaw
  if (mainGapRaw !== null) return mainGapRaw
  return undefined
}

const FIT_MODE: Record<string, string> = {
  FILL: 'cover', FIT: 'contain', CROP: 'crop', TILE: 'tile',
}

const TEXT_CASE: Record<string, string> = {
  UPPER: 'uppercase',
  LOWER: 'lowercase',
  TITLE: 'capitalize',
  SMALL_CAPS: 'small-caps',
  SMALL_CAPS_FORCED: 'small-caps-forced',
}

const BLEND_MODE: Record<string, string> = {
  MULTIPLY: 'multiply', SCREEN: 'screen', OVERLAY: 'overlay',
  DARKEN: 'darken', LIGHTEN: 'lighten', COLOR_DODGE: 'color-dodge',
  COLOR_BURN: 'color-burn', HARD_LIGHT: 'hard-light', SOFT_LIGHT: 'soft-light',
  DIFFERENCE: 'difference', EXCLUSION: 'exclusion', HUE: 'hue',
  SATURATION: 'saturation', COLOR: 'color', LUMINOSITY: 'luminosity',
  LINEAR_BURN: 'linear-burn', LINEAR_DODGE: 'linear-dodge',
}

const SYSTEM_FONTS: Record<string, boolean> = {
  'SF Pro': true,
  'SF Pro Display': true,
  'SF Pro Text': true,
  'New York': true,
  'Helvetica': true,
  'Helvetica Neue': true,
  'Arial': true,
  'Verdana': true,
  'Tahoma': true,
  'Trebuchet MS': true,
  'Times New Roman': true,
  'Georgia': true,
  'Courier New': true,
  'Menlo': true,
  'Monaco': true,
  'Avenir': true,
  'Avenir Next': true,
}

const GOOGLE_FONT_MAP: Record<string, GoogleFont> = (googleFonts as GoogleFont[]).reduce(function(map, font) {
  map[font.family] = font
  return map
}, {} as Record<string, GoogleFont>)

var _imageMap: { [hash: string]: ImageAsset } = {}
var _imageCounter = 0
var _svgNodeMap: { [nodeId: string]: ImageAsset } = {}
var _svgB64Map: { [b64: string]: ImageAsset } = {}
var _svgUsageCounts: { [assetId: string]: number } = {}
var _svgCounter = 0
var _debugExport = false
var _tokenRegistry: Map<string, { name: string; value: string; type: 'color' | 'number' | 'string' }> = new Map()
var _usedTokenIds: Set<string> = new Set()
interface StyleEntry {
  name: string
  tag: 'text-style' | 'fill-style' | 'effect-style'
  entryAttrs: Record<string, AttrVal>
  children?: string[]
}
var _styleRegistry: Map<string, StyleEntry> = new Map()
var _usedStyleIds: Set<string> = new Set()

interface PropEntry {
  name: string
  type: 'string' | 'boolean' | 'number' | 'color' | 'image' | 'component' | 'style'
  target: string
  bind?: string
}

interface InferredOverride {
  bodyId: string
  type: 'string' | 'boolean' | 'color' | 'image' | 'component' | 'style'
  bind?: string
}

interface ComponentEntry {
  guiId: string
  figmaNode: ComponentNode
  props: PropEntry[]
  setGuiId?: string
  variantAttrs?: Record<string, string>
}

interface ComponentSetEntry {
  guiId: string
  name: string
  figmaNode: any
  componentIds: string[]
}

var _componentRegistry: Map<string, ComponentEntry> = new Map()
var _componentSetRegistry: Map<string, ComponentSetEntry> = new Map()
var _instanceOverrideAccum: Map<string, InferredOverride[]> = new Map()
var _generatingComponentBody = false
var _generatingComponentRoot = false
var _componentBodyUsedIds: Set<string> | null = null
var _invisibleNodeIds: Set<string> = new Set()
var _currentComponentDefs: Record<string, { type: string; defaultValue: unknown }> | null = null

// --- messaging ---

async function sendSelection() {
  const sel = figma.currentPage.selection

  if (sel.length === 0) {
    figma.ui.postMessage({ type: 'no-selection' })
    return
  }
  if (sel.length > 1) {
    figma.ui.postMessage({ type: 'multi-selection' })
    return
  }

  const node = sel[0]
  if (!('width' in node)) {
    figma.ui.postMessage({ type: 'not-frame', nodeType: node.type })
    return
  }

  figma.ui.postMessage({ type: 'loading' })

  const expNode = node as FrameNode
  const results = await Promise.all([
    collectAndFetchImages(node as SceneNode),
    resolveAllVariables(node as SceneNode),
    expNode.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 1 } }),
    expNode.exportAsync({ format: 'SVG' }),
  ])

  const pngBytes = results[2] as Uint8Array
  const svgBytes = results[3] as Uint8Array
  // Prewalk to collect all SVG assets and count usages before generating XML
  if (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') {
    await prewalkNode(node as SceneNode, 1)
  } else {
    await prewalkNode(node as SceneNode, 2)
  }
  var svgNodeIds = Object.keys(_svgNodeMap)
  for (var pi = 0; pi < svgNodeIds.length; pi++) {
    var svgAssetId = _svgNodeMap[svgNodeIds[pi]].id
    _svgUsageCounts[svgAssetId] = (_svgUsageCounts[svgAssetId] || 0) + 1
  }

  // Two-pass: collect all instance overrides before generating XML so
  // component <props> blocks are inferred from actual usage, not just
  // formally declared componentPropertyDefinitions.
  await prewalkAllInstances(node as SceneNode)

  const guiCode = await generateGui(node as SceneNode)

  const assetMap: Record<string, string> = {}
  const hks = Object.keys(_imageMap)
  for (let i = 0; i < hks.length; i++) {
    const a = _imageMap[hks[i]]
    assetMap['assets/' + a.id + '.' + a.format] = dataUrl(a)
  }
  const sks = Object.keys(_svgNodeMap)
  const seenSvgIds: Record<string, boolean> = {}
  for (let i = 0; i < sks.length; i++) {
    const a = _svgNodeMap[sks[i]]
    if (seenSvgIds[a.id]) continue
    seenSvgIds[a.id] = true
    assetMap['assets/' + a.id + '.svg'] = dataUrl(a)
  }

  figma.ui.postMessage({
    type: 'gui',
    code: guiCode,
    displayCode: makeDisplayCode(guiCode),
    assetMap: assetMap,
    preview: 'data:image/png;base64,' + bytesToBase64(pngBytes),
    name: node.name,
    sizes: { gui: guiCode.length, png: pngBytes.length, svg: svgBytes.length },
  })
}

sendSelection()
figma.on('selectionchange', sendSelection)

figma.ui.onmessage = async (msg: { type: string }) => {
  if (msg.type === 'close') figma.closePlugin()
  if (msg.type === 'copy-debug') {
    const sel = figma.currentPage.selection
    if (sel.length === 1) logDebugTree(sel[0] as SceneNode)
    _debugExport = true
    await sendSelection()
    _debugExport = false
  }
}

// --- helpers ---

function rgbToHex(r: number, g: number, b: number, a = 1): string {
  const h = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0')
  return a < 1 ? `#${h(r)}${h(g)}${h(b)}${h(a)}` : `#${h(r)}${h(g)}${h(b)}`
}

function solidFill(fills: readonly Paint[] | typeof figma.mixed): string | null {
  if (fills === figma.mixed || !Array.isArray(fills)) return null
  const f = (fills as Paint[]).find(p => p.type === 'SOLID' && p.visible !== false) as SolidPaint | undefined
  if (!f) return null
  const bv = (f as any).boundVariables
  if (bv && bv.color && bv.color.id) {
    const ref = tokenRef(bv.color.id)
    if (ref) return ref
  }
  return rgbToHex(f.color.r, f.color.g, f.color.b, f.opacity !== undefined ? f.opacity : 1)
}

function visiblePaints(fills: readonly Paint[] | typeof figma.mixed): Paint[] {
  if (fills === figma.mixed || !Array.isArray(fills)) return []
  return (fills as Paint[]).filter(p => p.visible !== false)
}

function paintValue(p: Paint, nodeW: number, nodeH: number): string | null {
  if (p.type === 'SOLID') {
    const s = p as SolidPaint
    const bv = (s as any).boundVariables
    if (bv && bv.color && bv.color.id) {
      const ref = tokenRef(bv.color.id)
      if (ref) return ref
    }
    return rgbToHex(s.color.r, s.color.g, s.color.b, s.opacity !== undefined ? s.opacity : 1)
  }
  if (p.type === 'GRADIENT_LINEAR' || p.type === 'GRADIENT_RADIAL' || p.type === 'GRADIENT_ANGULAR') {
    const g = p as GradientPaint
    var stopParts: string[] = []
    for (var j = 0; j < g.gradientStops.length; j++) {
      const st = g.gradientStops[j]
      const sr = Math.round(st.color.r * 255)
      const sg = Math.round(st.color.g * 255)
      const sb = Math.round(st.color.b * 255)
      const paintOpacity = g.opacity !== undefined ? g.opacity : 1
      const sa = parseFloat((st.color.a * paintOpacity).toFixed(3))
      const sc = sa >= 1
        ? 'rgb(' + sr + ',' + sg + ',' + sb + ')'
        : 'rgba(' + sr + ',' + sg + ',' + sb + ',' + sa + ')'
      if (p.type === 'GRADIENT_ANGULAR') {
        stopParts.push(sc + ' ' + Math.round(st.position * 360) + 'deg')
      } else {
        stopParts.push(sc + ' ' + Math.round(st.position * 100) + '%')
      }
    }
    const stops = stopParts.join(', ')
    const t = g.gradientTransform
    if (p.type === 'GRADIENT_LINEAR') {
      // Convert normalised direction (a,d) to pixel space so aspect ratio is correct
      const dx = t[0][0] * nodeW
      const dy = t[1][0] * nodeH
      const angle = (Math.round(Math.atan2(dx, -dy) * 180 / Math.PI) + 180) % 360
      return 'linear-gradient(' + angle + 'deg, ' + stops + ')'
    }
    if (p.type === 'GRADIENT_ANGULAR') {
      const cx = Math.round((t[0][0] * 0.5 + t[0][1] * 0.5 + t[0][2]) * 100)
      const cy = Math.round((t[1][0] * 0.5 + t[1][1] * 0.5 + t[1][2]) * 100)
      const startAngle = Math.round(Math.atan2(t[1][0], t[0][0]) * 180 / Math.PI)
      return 'conic-gradient(from ' + startAngle + 'deg at ' + cx + '% ' + cy + '%, ' + stops + ')'
    }
    // Radial: derive centre from transform (maps 0.5,0.5 in gradient space → node space)
    const cx = Math.round((t[0][0] * 0.5 + t[0][1] * 0.5 + t[0][2]) * 100)
    const cy = Math.round((t[1][0] * 0.5 + t[1][1] * 0.5 + t[1][2]) * 100)
    return 'radial-gradient(circle at ' + cx + '% ' + cy + '%, ' + stops + ')'
  }
  return null
}

function fillValue(fills: readonly Paint[] | typeof figma.mixed, nodeW: number, nodeH: number): string | null {
  const paints = visiblePaints(fills)
  if (paints.length !== 1 || paints[0].type === 'IMAGE') return null
  return paintValue(paints[0], nodeW, nodeH)
}

function rounded(n: number): number {
  return Math.round(n * 100) / 100
}

function cropBoxAttrs(img: ImagePaint, nodeW: number, nodeH: number): Record<string, number | undefined> {
  if (img.scaleMode !== 'CROP' || !img.imageTransform) return {}

  const t = img.imageTransform
  const sx = t[0][0]
  const sy = t[1][1]
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || Math.abs(sx) < 0.0001 || Math.abs(sy) < 0.0001) return {}

  const imgW = nodeW / sx
  const imgH = nodeH / sy
  return {
    x: rounded(-imgW * t[0][2]),
    y: rounded(-imgH * t[1][2]),
    w: rounded(imgW),
    h: rounded(imgH),
  }
}

function appearanceFillLines(fills: readonly Paint[] | typeof figma.mixed, nodeW: number, nodeH: number, depth: number): string[] {
  // Trigger based on visible paints only
  const visible = visiblePaints(fills)
  if (visible.length <= 1 && (!visible[0] || visible[0].type !== 'IMAGE')) return []

  // Process all paints (visible + hidden) to preserve the full stack
  const allFills = fills === figma.mixed || !Array.isArray(fills) ? [] : fills as Paint[]

  const fillLines: string[] = []
  for (let i = 0; i < allFills.length; i++) {
    const p = allFills[i]
    const isHidden = p.visible === false
    const blendMapped = (p.blendMode && p.blendMode !== 'NORMAL') ? (BLEND_MODE[p.blendMode] || undefined) : undefined

    if (p.type === 'IMAGE') {
      const img = p as ImagePaint
      if (!img.imageHash || !_imageMap[img.imageHash]) continue
      const cropAttrs = cropBoxAttrs(img, nodeW, nodeH)
      var imgFillAttrs: Record<string, AttrVal> = {
        type: 'image',
        src: 'assets/' + _imageMap[img.imageHash].id + '.' + _imageMap[img.imageHash].format,
        fit: FIT_MODE[img.scaleMode] || 'cover',
        opacity: img.opacity !== undefined && img.opacity < 1 ? img.opacity : undefined,
        blend: blendMapped,
        visible: isHidden ? 'false' : undefined,
        x: cropAttrs.x,
        y: cropAttrs.y,
        w: cropAttrs.w,
        h: cropAttrs.h,
      }
      var imgFilters = (p as any).imageFilters
      if (imgFilters && typeof imgFilters === 'object') {
        if (typeof imgFilters.exposure === 'number' && imgFilters.exposure !== 0) imgFillAttrs['filter-exposure'] = parseFloat(imgFilters.exposure.toFixed(3))
        if (typeof imgFilters.contrast === 'number' && imgFilters.contrast !== 0) imgFillAttrs['filter-contrast'] = parseFloat(imgFilters.contrast.toFixed(3))
        if (typeof imgFilters.saturation === 'number' && imgFilters.saturation !== 0) imgFillAttrs['filter-saturation'] = parseFloat(imgFilters.saturation.toFixed(3))
        if (typeof imgFilters.temperature === 'number' && imgFilters.temperature !== 0) imgFillAttrs['filter-temperature'] = parseFloat(imgFilters.temperature.toFixed(3))
        if (typeof imgFilters.tint === 'number' && imgFilters.tint !== 0) imgFillAttrs['filter-tint'] = parseFloat(imgFilters.tint.toFixed(3))
        if (typeof imgFilters.highlights === 'number' && imgFilters.highlights !== 0) imgFillAttrs['filter-highlights'] = parseFloat(imgFilters.highlights.toFixed(3))
        if (typeof imgFilters.shadows === 'number' && imgFilters.shadows !== 0) imgFillAttrs['filter-shadows'] = parseFloat(imgFilters.shadows.toFixed(3))
      }
      fillLines.push(ind(depth + 1) + '<fill ' + attrs(imgFillAttrs) + ' />')
      continue
    }

    const value = paintValue(p, nodeW, nodeH)
    if (!value) continue
    var fillType = 'color'
    if (p.type === 'GRADIENT_LINEAR') fillType = 'linear-gradient'
    else if (p.type === 'GRADIENT_ANGULAR') fillType = 'angular-gradient'
    else if (p.type === 'GRADIENT_RADIAL') fillType = 'radial-gradient'
    fillLines.push(ind(depth + 1) + '<fill ' + attrs({
      type: fillType,
      value: value,
      opacity: p.opacity !== undefined && p.opacity < 1 ? p.opacity : undefined,
      blend: blendMapped,
      visible: isHidden ? 'false' : undefined,
    }) + ' />')
  }

  return fillLines
}

function visibleEffects(effects: readonly Effect[] | typeof figma.mixed): Effect[] {
  if (effects === figma.mixed || !Array.isArray(effects)) return []
  return (effects as Effect[]).filter(e => e.visible !== false)
}

function effectType(e: Effect): string {
  if (e.type === 'DROP_SHADOW') return 'drop-shadow'
  if (e.type === 'INNER_SHADOW') return 'inner-shadow'
  if (e.type === 'LAYER_BLUR') return 'layer-blur'
  if (e.type === 'BACKGROUND_BLUR') return 'background-blur'
  return e.type.toLowerCase()
}

function appearanceEffectLines(effects: readonly Effect[] | typeof figma.mixed, depth: number): string[] {
  const out: string[] = []
  const items = visibleEffects(effects)

  for (let i = 0; i < items.length; i++) {
    const e = items[i]
    if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
      var effOpacity = (e as any).opacity
      out.push(ind(depth + 1) + '<effect ' + attrs({
        type: effectType(e),
        x: e.offset.x,
        y: e.offset.y,
        radius: e.radius,
        spread: e.spread !== undefined ? e.spread : 0,
        color: rgbToHex(e.color.r, e.color.g, e.color.b, e.color.a),
        blend: e.blendMode && e.blendMode !== 'NORMAL' ? e.blendMode.toLowerCase() : undefined,
        opacity: (typeof effOpacity === 'number' && effOpacity < 1) ? parseFloat(effOpacity.toFixed(3)) : undefined,
      }) + ' />')
    } else if (e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR') {
      if (e.blurType === 'NORMAL') {
        out.push(ind(depth + 1) + '<effect ' + attrs({
          type: effectType(e),
          radius: e.radius,
        }) + ' />')
      } else {
        // rf027: unsupported blur type — report rather than silently drop
        out.push(ind(depth + 1) + '<!-- unsupported-effect: ' + e.type + ' blurType=' + e.blurType + ' -->')
      }
    } else if (e.type === 'GLASS') {
      const ge = e as unknown as { radius?: number; saturation?: number }
      out.push(ind(depth + 1) + '<effect ' + attrs({
        type: 'glass',
        radius: ge.radius !== undefined ? ge.radius : 20,
        saturation: ge.saturation !== undefined ? Math.round(ge.saturation * 100) : 180,
      }) + ' />')
    } else {
      // rf027: unsupported effect type — report rather than silently drop
      out.push(ind(depth + 1) + '<!-- unsupported-effect: ' + e.type + ' -->')
    }
  }

  return out
}

function appearanceBlock(
  fills: readonly Paint[] | typeof figma.mixed,
  effects: readonly Effect[] | typeof figma.mixed,
  nodeW: number,
  nodeH: number,
  depth: number,
  strokeNode?: GeometryMixin,
): string {
  var strokeLines = strokeNode ? appearanceStrokeLines(strokeNode, nodeW, nodeH, depth) : []
  const lines = appearanceFillLines(fills, nodeW, nodeH, depth)
    .concat(appearanceEffectLines(effects, depth))
    .concat(strokeLines)
  if (!lines.length) return ''
  return `${ind(depth)}<appearance>\n${lines.join('\n')}\n${ind(depth)}</appearance>`
}

function strokeAttrs(node: GeometryMixin): Record<string, AttrVal> {
  if (!Array.isArray(node.strokes) || node.strokes.length === 0) return {}
  const f = (node.strokes as Paint[]).find(function(p) { return p.type === 'SOLID' && p.visible !== false }) as SolidPaint | undefined
  if (!f) {
    // No SOLID stroke — try gradient stroke for border shorthand
    const gf = (node.strokes as Paint[]).find(function(p) {
      return p.visible !== false && (p.type === 'GRADIENT_LINEAR' || p.type === 'GRADIENT_RADIAL' || p.type === 'GRADIENT_ANGULAR')
    }) as GradientPaint | undefined
    if (!gf) return {}
    // Gradient stroke — can't use border shorthand color, skip shorthand
    return {}
  }
  const bv = (f as any).boundVariables
  const color = (bv && bv.color && bv.color.id && tokenRef(bv.color.id))
    || rgbToHex(f.color.r, f.color.g, f.color.b, f.opacity !== undefined ? f.opacity : 1)
  const width = typeof (node as any).strokeWeight === 'number' ? (node as any).strokeWeight : 1
  const align = (node as any).strokeAlign ? (node as any).strokeAlign.toLowerCase() : 'center'
  // Build shorthand — omit defaults (width=1, align=center)
  const parts: string[] = []
  if (width !== 1) parts.push(String(width))
  parts.push(color)
  if (align !== 'center') parts.push(align)
  var result: Record<string, AttrVal> = { border: parts.join(' ') }
  // Stroke join
  var sj = (node as any).strokeJoin
  if (sj && sj !== figma.mixed) {
    var sjVal = strokeJoinVal(sj as string)
    if (sjVal) result['stroke-join'] = sjVal
  }
  // Dash pattern
  var dashPattern = (node as any).strokeDashPattern
  if (dashPattern && Array.isArray(dashPattern) && dashPattern.length > 0) {
    result['dash-array'] = dashPattern.join(' ')
  }
  var dashOffset = (node as any).strokeDashOffset
  if (typeof dashOffset === 'number' && dashOffset !== 0) {
    result['dash-offset'] = dashOffset
  }
  return result
}

function appearanceStrokeLines(node: GeometryMixin, nodeW: number, nodeH: number, depth: number): string[] {
  if (!Array.isArray(node.strokes) || node.strokes.length === 0) return []
  var strokePaints = node.strokes as Paint[]
  var width = typeof (node as any).strokeWeight === 'number' ? (node as any).strokeWeight : 1
  var align = (node as any).strokeAlign ? (node as any).strokeAlign.toLowerCase() : 'center'
  var sj = (node as any).strokeJoin
  var sjVal = (sj && sj !== figma.mixed) ? strokeJoinVal(sj as string) : undefined
  var dashPattern = (node as any).strokeDashPattern
  var dashArray = (dashPattern && Array.isArray(dashPattern) && dashPattern.length > 0) ? dashPattern.join(' ') : undefined
  var dashOffset = (node as any).strokeDashOffset
  var dashOffsetVal = (typeof dashOffset === 'number' && dashOffset !== 0) ? dashOffset : undefined

  var hasSolid = false
  for (var si = 0; si < strokePaints.length; si++) {
    if (strokePaints[si].type === 'SOLID' && strokePaints[si].visible !== false) { hasSolid = true; break }
  }

  // Emit gradient strokes (or second+ strokes) as <stroke> elements in appearance
  var lines: string[] = []
  var solidCount = 0
  for (var gi = 0; gi < strokePaints.length; gi++) {
    var sp = strokePaints[gi]
    var isHidden = sp.visible === false
    if (sp.type === 'SOLID') {
      solidCount++
      // First solid is covered by border shorthand — only emit extras
      if (solidCount <= 1 && hasSolid) continue
      var sf = sp as SolidPaint
      var bv = (sf as any).boundVariables
      var sColor = (bv && bv.color && bv.color.id && tokenRef(bv.color.id))
        || rgbToHex(sf.color.r, sf.color.g, sf.color.b, sf.opacity !== undefined ? sf.opacity : 1)
      lines.push(ind(depth + 1) + '<border ' + attrs({
        color: sColor,
        w: width !== 1 ? width : undefined,
        align: align !== 'center' ? align : undefined,
        join: sjVal,
        'dash-array': dashArray,
        'dash-offset': dashOffsetVal,
        visible: isHidden ? 'false' : undefined,
      }) + ' />')
    } else if (sp.type === 'GRADIENT_LINEAR' || sp.type === 'GRADIENT_RADIAL' || sp.type === 'GRADIENT_ANGULAR') {
      var gradVal = paintValue(sp, nodeW, nodeH)
      if (!gradVal) continue
      lines.push(ind(depth + 1) + '<border ' + attrs({
        paint: gradVal,
        w: width !== 1 ? width : undefined,
        align: align !== 'center' ? align : undefined,
        join: sjVal,
        'dash-array': dashArray,
        'dash-offset': dashOffsetVal,
        visible: isHidden ? 'false' : undefined,
      }) + ' />')
    }
  }
  return lines
}

function shadowAttr(node: BlendMixin): string | null {
  if (!Array.isArray(node.effects)) return null
  const s = node.effects.find(e => e.type === 'DROP_SHADOW' && e.visible !== false) as DropShadowEffect | undefined
  if (!s) return null
  return `${s.offset.x} ${s.offset.y} ${s.radius} ${s.spread !== undefined ? s.spread : 0} ${rgbToHex(s.color.r, s.color.g, s.color.b, s.color.a)}`
}

function rotationAttr(node: SceneNode): number | undefined {
  if (!('rotation' in node)) return undefined
  const rotation = (node as unknown as { rotation: number }).rotation
  if (!rotation) return undefined
  return Math.round(rotation * 100) / 100
}

function blendModeAttr(node: SceneNode): string | undefined {
  if (!('blendMode' in node)) return undefined
  const bm = (node as BlendMixin).blendMode as string
  if (bm === 'NORMAL' || bm === 'PASS_THROUGH') return undefined
  return BLEND_MODE[bm] || bm.toLowerCase().replace(/_/g, '-')
}

function maskAttr(node: SceneNode): true | undefined {
  if (!('isMask' in node)) return undefined
  return (node as BlendMixin).isMask || undefined
}

const CONSTRAINT_H_MAP: Record<string, string> = {
  MAX: 'right', CENTER: 'center', SCALE: 'scale', STRETCH: 'stretch',
}
const CONSTRAINT_V_MAP: Record<string, string> = {
  MAX: 'bottom', CENTER: 'center', SCALE: 'scale', STRETCH: 'stretch',
}

function constraintAttrs(node: SceneNode): Record<string, AttrVal> {
  if (!('constraints' in node)) return {}
  const c = (node as any).constraints as Constraints
  if (!c) return {}
  // Figma uses 'MIN' for left/top (the default) — omit it; map MAX → right/bottom
  return {
    'constraint-h': CONSTRAINT_H_MAP[c.horizontal] || undefined,
    'constraint-v': CONSTRAINT_V_MAP[c.vertical] || undefined,
  }
}

function sizingAttrs(node: SceneNode): Record<string, AttrVal> {
  const result: Record<string, AttrVal> = {}
  if ('layoutSizingHorizontal' in node) {
    const h = (node as FrameNode).layoutSizingHorizontal
    if (h === 'FILL') result.w = 'fill'
    else if (h === 'HUG') result.w = undefined  // absent = hug
    // FIXED: base w value stays
  }
  if ('layoutSizingVertical' in node) {
    const v = (node as FrameNode).layoutSizingVertical
    if (v === 'FILL') result.h = 'fill'
    else if (v === 'HUG') result.h = undefined  // absent = hug
    // FIXED: base h value stays
  }
  return result
}

function layoutPositionAttrs(node: SceneNode): Record<string, AttrVal> {
  if (!('layoutPositioning' in node)) return {}
  return (node as unknown as { layoutPositioning?: string }).layoutPositioning === 'ABSOLUTE'
    ? { abs: true }
    : {}
}

function minMaxAttrs(node: SceneNode): Record<string, AttrVal> {
  if (!('minWidth' in node)) return {}
  const n = node as FrameNode
  return {
    'min-width': n.minWidth != null ? n.minWidth : undefined,
    'max-width': n.maxWidth != null ? n.maxWidth : undefined,
    'min-height': n.minHeight != null ? n.minHeight : undefined,
    'max-height': n.maxHeight != null ? n.maxHeight : undefined,
  }
}

function cornerRadius(node: RectangleNode | FrameNode): string | null {
  if (node.cornerRadius === figma.mixed) {
    const n = node as RectangleNode
    return `${n.topLeftRadius} ${n.topRightRadius} ${n.bottomRightRadius} ${n.bottomLeftRadius}`
  }
  if (node.cornerRadius <= 0) return null
  const bv = (node as any).boundVariables
  if (bv && bv.cornerRadius && bv.cornerRadius.id) {
    const ref = tokenRef(bv.cornerRadius.id)
    if (ref) return ref
  }
  return String(node.cornerRadius)
}

function padding(node: FrameNode): string | null {
  const { paddingTop: t, paddingRight: r, paddingBottom: b, paddingLeft: l } = node
  if (!t && !r && !b && !l) return null
  if (t === r && r === b && b === l) return String(t)
  if (t === b && r === l) return `${t} ${r}`
  return `${t} ${r} ${b} ${l}`
}

function getImageFill(fills: readonly Paint[] | typeof figma.mixed): ImagePaint | null {
  if (fills === figma.mixed || !Array.isArray(fills)) return null
  for (let i = 0; i < (fills as Paint[]).length; i++) {
    const f = (fills as Paint[])[i]
    if (f.type === 'IMAGE' && f.visible !== false) return f as ImagePaint
  }
  return null
}

function collectImageHashes(node: SceneNode, hashes: string[]): void {
  if ('fills' in node) {
    const fill = getImageFill((node as GeometryMixin).fills)
    if (fill && fill.imageHash && hashes.indexOf(fill.imageHash) === -1) {
      hashes.push(fill.imageHash)
    }
  }
  if ('children' in node) {
    const ch = (node as ChildrenMixin).children
    for (let i = 0; i < ch.length; i++) collectImageHashes(ch[i], hashes)
  }
}

function detectFormat(bytes: Uint8Array): string {
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'jpg'
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'gif'
  return 'png'
}

function bytesToBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let result = ''
  const len = bytes.length
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < len ? bytes[i + 1] : 0
    const b2 = i + 2 < len ? bytes[i + 2] : 0
    result += chars[b0 >> 2]
    result += chars[((b0 & 3) << 4) | (b1 >> 4)]
    result += i + 1 < len ? chars[((b1 & 15) << 2) | (b2 >> 6)] : '='
    result += i + 2 < len ? chars[b2 & 63] : '='
  }
  return result
}

async function collectAndFetchImages(root: SceneNode): Promise<void> {
  _imageMap = {}
  _imageCounter = 0
  _svgNodeMap = {}
  _svgB64Map = {}
  _svgUsageCounts = {}
  _svgCounter = 0
  _componentRegistry = new Map()
  _componentSetRegistry = new Map()
  _instanceOverrideAccum = new Map()
  _generatingComponentBody = false
  _generatingComponentRoot = false
  _componentBodyUsedIds = null
  _invisibleNodeIds = new Set()
  _currentComponentDefs = null
  const hashes: string[] = []
  collectImageHashes(root, hashes)
  for (let i = 0; i < hashes.length; i++) {
    const hash = hashes[i]
    const image = figma.getImageByHash(hash)
    if (!image) continue
    try {
      const bytes = await image.getBytesAsync()
      _imageCounter++
      _imageMap[hash] = { id: 'img-' + _imageCounter, format: detectFormat(bytes), b64: bytesToBase64(bytes) }
    } catch (e) { /* skip failed images */ }
  }
}

function dataUrl(asset: ImageAsset): string {
  const mime = asset.format === 'svg' ? 'svg+xml' : asset.format
  return 'data:image/' + mime + ';base64,' + asset.b64
}

function xmlEscape(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '&#10;')
}

function attrs(obj: Record<string, AttrVal>): string {
  return Object.entries(obj)
    .filter(([, v]) => v !== null && v !== undefined && v !== false)
    .map(([k, v]) => v === true ? k : `${k}="${typeof v === 'string' ? xmlEscape(v) : v}"`)
    .join(' ')
}

function debugAttrs(node: SceneNode): Record<string, AttrVal> {
  if (!_debugExport) return {}
  const layout = node as LayoutMixin
  var propRefs = (node as any).componentPropertyReferences
  var visRef = propRefs && propRefs.visible ? String(propRefs.visible) : undefined
  return {
    'debug-id': node.id,
    'debug-type': node.type,
    'debug-raw-x': typeof layout.x === 'number' ? Math.round(layout.x) : undefined,
    'debug-raw-y': typeof layout.y === 'number' ? Math.round(layout.y) : undefined,
    'debug-node-visible': String(node.visible),
    'debug-vis-prop-ref': visRef,
  }
}

function logDebugTree(node: SceneNode): void {
  function serialize(current: SceneNode): Record<string, unknown> {
    const layout = current as LayoutMixin
    return {
      id: current.id,
      type: current.type,
      name: current.name,
      x: typeof layout.x === 'number' ? layout.x : undefined,
      y: typeof layout.y === 'number' ? layout.y : undefined,
      width: typeof layout.width === 'number' ? layout.width : undefined,
      height: typeof layout.height === 'number' ? layout.height : undefined,
      layoutMode: 'layoutMode' in current ? current.layoutMode : undefined,
      itemSpacing: 'itemSpacing' in current ? current.itemSpacing : undefined,
      layoutPositioning: 'layoutPositioning' in current ? current.layoutPositioning : undefined,
      children: 'children' in current
        ? current.children.filter(child => child.visible !== false).map(child => serialize(child as SceneNode))
        : undefined,
    }
  }

  console.log('dotgui figma debug', serialize(node))
}

function makeDisplayCode(code: string): string {
  let out = ''
  let at = 0

  while (at < code.length) {
    const start = code.indexOf('base64:', at)
    if (start === -1) {
      out += code.slice(at)
      break
    }

    let end = start + 7
    while (end < code.length && isBase64Char(code.charCodeAt(end))) end++

    const bytes = Math.round((end - start - 7) * 0.75)
    out += code.slice(at, start)
    out += bytes < 1024 ? 'base64:[' + bytes + ' B]' : 'base64:[' + (bytes / 1024).toFixed(1) + ' KB]'
    at = end
  }

  return out
}

function isBase64Char(code: number): boolean {
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) ||
    code === 43 ||
    code === 47 ||
    code === 61
  )
}

// --- component helpers ---

function sanitizeId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'node'
}

function componentBodyId(name: string): string | undefined {
  if (!_generatingComponentBody || !_componentBodyUsedIds) return undefined
  const base = sanitizeId(name)
  if (!base) return undefined
  let final = base
  let i = 1
  while (_componentBodyUsedIds.has(final)) final = base + '-' + (++i)
  _componentBodyUsedIds.add(final)
  return final
}

function sanitizePropName(name: string): string {
  const base = name.replace(/#[^#]*$/, '').trim()
  return sanitizeId(base) || 'prop'
}

function parseVariantAttrs(compName: string): Record<string, string> {
  const result: Record<string, string> = {}
  const parts = compName.split(',')
  for (var i = 0; i < parts.length; i++) {
    const eq = parts[i].indexOf('=')
    if (eq === -1) continue
    const key = sanitizeId(parts[i].slice(0, eq).trim())
    const value = sanitizeId(parts[i].slice(eq + 1).trim())
    if (key && value) result[key] = value
  }
  return result
}

function generateComponentGuiId(component: ComponentNode): string {
  const parent = component.parent
  if (parent && parent.type === 'COMPONENT_SET') {
    return 'comp-' + sanitizeId((parent as any).name) + '-' + sanitizeId(component.name)
  }
  return 'comp-' + sanitizeId(component.name)
}

function findPropTargetNode(root: SceneNode, propRawName: string, refAttr: string): SceneNode | null {
  const refs = (root as any).componentPropertyReferences
  if (refs && refs[refAttr] === propRawName) return root
  if ('children' in root) {
    const ch = (root as ChildrenMixin).children
    for (var i = 0; i < ch.length; i++) {
      const found = findPropTargetNode(ch[i] as SceneNode, propRawName, refAttr)
      if (found) return found
    }
  }
  return null
}

// Walk the full component tree in DFS order and assign IDs exactly as componentBodyId would,
// returning a Map<figmaNodeId, guiBodyId>. This lets extractComponentProps find the correct
// target ID even when a container with the same name appears before the text node.
// simulateBodyIds walks the component body and maps each node's ID to its
// generated kebab-case id (same deduplication used in frameToGui).
// Used when building the <props> block — we only have the component node.
function simulateBodyIds(root: SceneNode): Map<string, string> {
  var used = new Set<string>()
  var result = new Map<string, string>()
  function walk(n: SceneNode) {
    // instanceToGui does NOT call componentBodyId — instances don't consume an id slot.
    // Exclude them from the used-set so deduplication stays in sync with the real body.
    if (n.type !== 'INSTANCE') {
      var base = sanitizeId(n.name)
      if (base) {
        var final = base
        var i = 1
        while (used.has(final)) { i++; final = base + '-' + i }
        used.add(final)
        result.set(n.id, final)
      }
    }
    if ('children' in n) {
      var ch = (n as ChildrenMixin).children
      for (var j = 0; j < ch.length; j++) walk(ch[j] as SceneNode)
    }
  }
  walk(root)
  return result
}

// buildInstanceBodyIdMap walks an instance and its main component in parallel,
// mapping BOTH instance-scoped node IDs AND component body node IDs to the same
// generated kebab-case name. This is necessary because Figma instance child IDs
// use the format "<instanceId>;<componentNodeId>" — they are NOT the same as the
// component body node IDs. InstanceNode.overrides uses instance-scoped IDs, so
// bodyIds.get(ov.id) always returns undefined when keyed only by component IDs.
function buildInstanceBodyIdMap(instRoot: SceneNode, compRoot: SceneNode): Map<string, string> {
  var used = new Set<string>()
  var result = new Map<string, string>()
  function walk(instNode: SceneNode, compNode: SceneNode) {
    if (instNode.type !== 'INSTANCE') {
      var base = sanitizeId(instNode.name)
      if (base) {
        var final = base
        var i = 1
        while (used.has(final)) { i++; final = base + '-' + i }
        used.add(final)
        result.set(instNode.id, final)  // instance-scoped id → kebab name
        result.set(compNode.id, final)  // component body id → same kebab name
      }
    }
    if ('children' in instNode && 'children' in compNode) {
      var instCh = (instNode as ChildrenMixin).children
      var compCh = (compNode as ChildrenMixin).children
      var len = instCh.length < compCh.length ? instCh.length : compCh.length
      for (var j = 0; j < len; j++) {
        walk(instCh[j] as SceneNode, compCh[j] as SceneNode)
      }
    }
  }
  walk(instRoot, compRoot)
  return result
}

function countComponentBodyLayers(component: ComponentNode): number {
  var count = 0
  function walkCount(n: SceneNode) {
    count++
    if ('children' in n) {
      var ch = (n as ChildrenMixin).children
      for (var i = 0; i < ch.length; i++) walkCount(ch[i] as SceneNode)
    }
  }
  if ('children' in component) {
    var ch = (component as ChildrenMixin).children
    for (var i = 0; i < ch.length; i++) walkCount(ch[i] as SceneNode)
  }
  return count
}

function collectInstanceOverrideTypes(node: InstanceNode): void {
  var comp = node.mainComponent
  if (!comp) return
  // Use buildInstanceBodyIdMap so instance-scoped node IDs in overrides resolve correctly
  var bodyIds = buildInstanceBodyIdMap(node as SceneNode, comp as SceneNode)
  var accum = _instanceOverrideAccum.get(comp.id)
  if (!accum) {
    accum = []
    _instanceOverrideAccum.set(comp.id, accum)
  }
  var overrides = (node as any).overrides as ReadonlyArray<{ id: string; overriddenFields: string[] }> | null
  if (overrides) {
    for (var i = 0; i < overrides.length; i++) {
      var ov = overrides[i]
      if (!ov.overriddenFields) continue
      var bodyId = bodyIds.get(ov.id)
      if (!bodyId) continue
      for (var j = 0; j < ov.overriddenFields.length; j++) {
        var field = ov.overriddenFields[j]
        if (field === 'characters') {
          accum.push({ bodyId: bodyId, type: 'string' })
        } else if (field === 'visible') {
          accum.push({ bodyId: bodyId, type: 'boolean' })
        } else if (field === 'fills') {
          var ovNode = findNodeInTree(node as SceneNode, ov.id)
          if (ovNode) {
            var imgFill = getImageFillFromNode(ovNode)
            if (imgFill) {
              accum.push({ bodyId: bodyId, type: 'image' })
            } else {
              var sf = ('fills' in ovNode) ? solidFill((ovNode as GeometryMixin).fills) : null
              if (sf) accum.push({ bodyId: bodyId, type: 'color' })
            }
          }
        } else if (field === 'strokes') {
          var sov = findNodeInTree(node as SceneNode, ov.id)
          if (sov && 'strokes' in sov) {
            var strk = (sov as GeometryMixin).strokes
            if (strk && strk.length > 0 && strk[0].type === 'SOLID') {
              accum.push({ bodyId: bodyId, type: 'color', bind: 'stroke' })
            }
          }
        } else if (field === 'textStyleId') {
          accum.push({ bodyId: bodyId, type: 'style', bind: 'text-style' })
        } else if (field === 'fillStyleId') {
          accum.push({ bodyId: bodyId, type: 'style', bind: 'fill-style' })
        } else if (field === 'effectStyleId') {
          accum.push({ bodyId: bodyId, type: 'style', bind: 'effect-style' })
        } else if (field === 'strokeStyleId') {
          accum.push({ bodyId: bodyId, type: 'style', bind: 'stroke-style' })
        }
      }
    }
  }
  // INSTANCE_SWAP via componentProperties
  var compProps = (node as any).componentProperties as Record<string, { type: string; value: unknown }> | null
  if (compProps) {
    var propKeys = Object.keys(compProps)
    for (var pi = 0; pi < propKeys.length; pi++) {
      var propDef = compProps[propKeys[pi]]
      if (propDef.type !== 'INSTANCE_SWAP') continue
      var swapTarget = findPropTargetNode(comp as SceneNode, propKeys[pi], 'mainComponent')
      if (swapTarget) {
        var swapBodyId = bodyIds.get(swapTarget.id)
        if (swapBodyId) accum.push({ bodyId: swapBodyId, type: 'component' })
      }
    }
  }
}

async function prewalkAllInstances(node: SceneNode): Promise<void> {
  if (node.type === 'INSTANCE') {
    var inst = node as InstanceNode
    if (inst.mainComponent) {
      await registerComponent(inst.mainComponent)
      collectInstanceOverrideTypes(inst)
    }
  }
  if ('children' in node) {
    var ch = (node as ChildrenMixin).children
    for (var i = 0; i < ch.length; i++) {
      await prewalkAllInstances(ch[i] as SceneNode)
    }
  }
}

function extractComponentProps(component: ComponentNode): PropEntry[] {
  const isVariant = component.parent && component.parent.type === 'COMPONENT_SET'
  const defSource = isVariant ? component.parent : component
  var defs: Record<string, { type: string }> | null = null
  try {
    defs = (defSource as any).componentPropertyDefinitions || null
  } catch (_e) { /* not available */ }

  const props: PropEntry[] = []
  const usedTargets: Set<string> = new Set()
  const bodyIds = simulateBodyIds(component as SceneNode)

  // 1. Formal declared props from componentPropertyDefinitions
  if (defs) {
    var entries = Object.keys(defs)
    for (var i = 0; i < entries.length; i++) {
      var rawName = entries[i]
      var figmaType = defs[rawName].type
      var guiType: PropEntry['type'] | null = null
      var refAttr = ''
      if (figmaType === 'TEXT') { guiType = 'string'; refAttr = 'characters' }
      else if (figmaType === 'BOOLEAN') { guiType = 'boolean'; refAttr = 'visible' }
      else if (figmaType === 'INSTANCE_SWAP') { guiType = 'component'; refAttr = 'mainComponent' }
      if (!guiType) continue
      var targetNode = findPropTargetNode(component as SceneNode, rawName, refAttr)
      if (!targetNode) continue
      var target = bodyIds.get(targetNode.id) || sanitizeId(targetNode.name)
      props.push({ name: sanitizePropName(rawName), type: guiType, target: target })
      usedTargets.add(target)
    }
  }

  // 2. Inferred props from actual instance overrides collected during prewalkAllInstances
  var inferred = _instanceOverrideAccum.get(component.id)
  if (inferred) {
    var seen: Set<string> = new Set()
    for (var ii = 0; ii < inferred.length; ii++) {
      var inf = inferred[ii]
      // key includes bind so color+fill and color+stroke are separate props
      var key = inf.bodyId + ':' + inf.type + (inf.bind ? ':' + inf.bind : '')
      if (seen.has(key)) continue
      seen.add(key)
      // For typed overrides with bind, allow same target to have multiple props
      // (e.g. fill color + stroke color on the same layer are distinct props)
      if (!inf.bind && usedTargets.has(inf.bodyId)) continue
      // Generate a unique prop name when bind is present to avoid collisions
      var propName = inf.bind ? inf.bodyId + '-' + inf.bind.replace(/-style$/, '') : inf.bodyId
      var entry: PropEntry = { name: propName, type: inf.type, target: inf.bodyId }
      if (inf.bind) entry.bind = inf.bind
      props.push(entry)
      if (!inf.bind) usedTargets.add(inf.bodyId)
    }
  }

  return props
}

async function registerComponent(component: ComponentNode | null): Promise<void> {
  if (!component || _componentRegistry.has(component.id)) return

  // Temporary entry to break potential cycles
  _componentRegistry.set(component.id, { guiId: '', figmaNode: component, props: [] })

  await prewalkNode(component as SceneNode, 2)

  const props = extractComponentProps(component)

  var setGuiId: string | undefined
  var variantAttrs: Record<string, string> | undefined
  const parent = component.parent
  if (parent && parent.type === 'COMPONENT_SET') {
    const set = parent as any
    if (!_componentSetRegistry.has(set.id)) {
      _componentSetRegistry.set(set.id, {
        guiId: 'compset-' + sanitizeId(set.name),
        name: set.name,
        figmaNode: set,
        componentIds: [],
      })
    }
    const setEntry = _componentSetRegistry.get(set.id)!
    setGuiId = setEntry.guiId
    if (setEntry.componentIds.indexOf(component.id) === -1) setEntry.componentIds.push(component.id)
    variantAttrs = parseVariantAttrs(component.name)
  }

  const guiId = generateComponentGuiId(component)
  _componentRegistry.set(component.id, { guiId, figmaNode: component, props, setGuiId, variantAttrs })

  // Recurse into component children to find nested instances
  if ('children' in component) {
    const ch = (component as ChildrenMixin).children
    for (var i = 0; i < ch.length; i++) {
      await prewalkComponents(ch[i] as SceneNode)
    }
  }
}

async function prewalkComponents(node: SceneNode): Promise<void> {
  if (node.type === 'INSTANCE') {
    await registerComponent((node as InstanceNode).mainComponent)
  }
  if ('children' in node) {
    const ch = (node as ChildrenMixin).children
    for (var i = 0; i < ch.length; i++) {
      if ((ch[i] as SceneNode).visible !== false) await prewalkComponents(ch[i] as SceneNode)
    }
  }
}

// --- node converters ---

function visibleChildren(node: SceneNode): SceneNode[] {
  if (!('children' in node)) return []
  return (node as ChildrenMixin).children.filter(c => c.visible !== false)
}

function visibleLeaves(node: SceneNode): SceneNode[] {
  const ch = visibleChildren(node)
  if (!ch.length) return [node]
  let out: SceneNode[] = []
  for (let i = 0; i < ch.length; i++) out = out.concat(visibleLeaves(ch[i]))
  return out
}

function isGraphicLeaf(node: SceneNode): boolean {
  if (getImageFillFromNode(node)) return false
  return node.type === 'RECTANGLE'
    || node.type === 'ELLIPSE'
    || node.type === 'LINE'
    || node.type === 'VECTOR'
    || node.type === 'STAR'
    || node.type === 'POLYGON'
    || node.type === 'BOOLEAN_OPERATION'
  }

function getImageFillFromNode(node: SceneNode): ImagePaint | null {
  if (!('fills' in node)) return null
  return getImageFill((node as GeometryMixin).fills)
}

function hasVisibleEffects(node: SceneNode): boolean {
  if (!('effects' in node) || !Array.isArray((node as BlendMixin).effects)) return false
  return visibleEffects((node as BlendMixin).effects).length > 0
}

function hasHardEffects(_node: SceneNode): boolean {
  return false
}

function hasNonCenterStroke(node: SceneNode): boolean {
  if (!('strokeAlign' in node)) return false
  const align = (node as unknown as { strokeAlign?: string }).strokeAlign
  return !!align && align !== 'CENTER'
}

function vectorPathCount(node: SceneNode): number {
  if (!('vectorPaths' in node)) return 0
  return ((node as unknown as { vectorPaths?: ReadonlyArray<unknown> }).vectorPaths || []).length
}

function isSvgClusterContainer(node: SceneNode): boolean {
  if (!('children' in node)) return false
  if (node.type === 'GROUP') return true

  if (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') {
    const layoutMode = (node as FrameNode).layoutMode
    return !layoutMode || layoutMode === 'NONE'
  }

  return false
}

function shouldExportAsSvg(node: SceneNode, depth: number): boolean {
  if (depth <= 1) return false
  if (hasHardEffects(node)) return true
  if (node.type === 'BOOLEAN_OPERATION') return true

  if (node.type === 'VECTOR' || node.type === 'STAR' || node.type === 'POLYGON') return true

  if (!isSvgClusterContainer(node)) return false

  const leaves = visibleLeaves(node).filter(n => n !== node)
  if (leaves.length < 2) return false
  if (!leaves.every(isGraphicLeaf)) return false

  return true
}

async function svgAsset(node: SceneNode): Promise<ImageAsset | null> {
  if (_svgNodeMap[node.id]) return _svgNodeMap[node.id]

  try {
    // The emitted <svg> already carries the node's own x/y/width/height in GUI.
    // Keep the asset itself local to that node box so flattened groups still lay
    // out like the original Figma child inside stacks.
    const bytes = await node.exportAsync({ format: 'SVG' })
    const b64 = bytesToBase64(bytes)
    if (_svgB64Map[b64]) {
      _svgNodeMap[node.id] = _svgB64Map[b64]
      return _svgB64Map[b64]
    }

    _svgCounter++
    const asset = { id: 'svg-' + _svgCounter, format: 'svg', b64 }
    _svgB64Map[b64] = asset
    _svgNodeMap[node.id] = asset
    return asset
  } catch (e) {
    return null
  }
}

async function prewalkNode(node: SceneNode, depth: number): Promise<void> {
  if (node.visible === false) return
  if (shouldExportAsSvg(node, depth)) {
    await svgAsset(node)
    return
  }
  if ('children' in node) {
    var ch = (node as ChildrenMixin).children
    for (var i = 0; i < ch.length; i++) {
      await prewalkNode(ch[i] as SceneNode, depth + 1)
    }
  }
}

async function svgToGui(node: SceneNode, depth: number): Promise<string> {
  const asset = await svgAsset(node)
  if (!asset) return ''

  const baseAttrs: Record<string, AttrVal> = {
    id: componentBodyId(node.name),
    name: node.name,
    src: 'assets/' + asset.id + '.svg',
    x: Math.round((node as LayoutMixin).x),
    y: Math.round((node as LayoutMixin).y),
    w: Math.round((node as LayoutMixin).width),
    h: Math.round((node as LayoutMixin).height),
    opacity: node.opacity < 1 ? node.opacity : undefined,
    blend: blendModeAttr(node),
    mask: maskAttr(node),
    rotation: rotationAttr(node),
    flip: flipAttr(node),
    visible: visibleAttr(node),
  }
  Object.assign(baseAttrs, constraintAttrs(node))
  Object.assign(baseAttrs, sizingAttrs(node))
  Object.assign(baseAttrs, layoutPositionAttrs(node))
  Object.assign(baseAttrs, debugAttrs(node))

  return `${ind(depth)}<img ${attrs(baseAttrs)} />`
}

async function nodeToGui(node: SceneNode, depth: number): Promise<string> {
  // Invisible nodes: preserve in output with visible="false" attribute
  // Pre-walk loops still filter them out; only this main dispatch preserves them
  if (node.visible === false) {
    _invisibleNodeIds.add(node.id)
  } else if (_generatingComponentBody && _currentComponentDefs) {
    // Figma keeps node.visible===true for layers whose visibility is driven by a
    // boolean component property with defaultValue:false. Detect that here so the
    // component body correctly emits visible="false".
    var propRefs = (node as any).componentPropertyReferences
    if (propRefs && propRefs.visible) {
      var propDef = _currentComponentDefs[propRefs.visible as string]
      if (propDef && propDef.type === 'BOOLEAN' && propDef.defaultValue === false) {
        _invisibleNodeIds.add(node.id)
      }
    }
  }

  if (shouldExportAsSvg(node, depth)) {
    return svgToGui(node, depth)
  }

  switch (node.type) {
    case 'FRAME':
    case 'COMPONENT':
      return frameToGui(node as FrameNode, depth)
    case 'INSTANCE':
      return instanceToGui(node as InstanceNode, depth)
    case 'GROUP':
      return groupToGui(node as GroupNode, depth)
    case 'TEXT':
      return textToGui(node as TextNode, depth)
    case 'RECTANGLE':
      return rectToGui(node as RectangleNode, depth)
    case 'ELLIPSE': {
      const arc = (node as EllipseNode).arcData
      const TWO_PI = Math.PI * 2
      const hasArc = arc && (
        Math.abs(arc.startingAngle) > 0.001 ||
        Math.abs(arc.endingAngle - TWO_PI) > 0.001 ||
        arc.innerRadius > 0
      )
      if (hasArc) return await svgToGui(node, depth)
      return ellipseToGui(node as EllipseNode, depth)
    }
    case 'LINE':
      return lineToGui(node as LineNode, depth)
    case 'VECTOR':
    case 'STAR':
    case 'POLYGON':
    case 'BOOLEAN_OPERATION':
      return await svgToGui(node, depth)
    default:
      if ('children' in node) {
        if ((node.type as string) === 'COMPONENT_SET') return frameToGui(node as any as FrameNode, depth)
        const lm = (node as FrameNode).layoutMode
        if (lm && lm !== 'NONE') return frameToGui(node as FrameNode, depth)
        return groupToGui(node as GroupNode, depth)
      }
      return ''
  }
}

async function children(node: ChildrenMixin, depth: number): Promise<string> {
  const parts = await Promise.all(node.children.map(c => nodeToGui(c, depth)))
  return parts.filter(Boolean).join('\n')
}

function maskNodeToAsset(node: SceneNode): ImageAsset | null {
  const w = Math.round((node as LayoutMixin).width)
  const h = Math.round((node as LayoutMixin).height)
  let pathsMarkup = ''

  if ('vectorPaths' in node) {
    const vp = (node as unknown as { vectorPaths?: ReadonlyArray<{ data: string; windingRule: string }> }).vectorPaths || []
    if (vp.length > 0) {
      pathsMarkup = vp.map(p =>
        `<path d="${p.data}" fill="white" fill-rule="${p.windingRule === 'EVENODD' ? 'evenodd' : 'nonzero'}"/>`
      ).join('')
    }
  } else if (node.type === 'RECTANGLE') {
    const r = 'cornerRadius' in node ? (node as RectangleNode).cornerRadius : 0
    const cr = typeof r === 'number' ? r : 0
    pathsMarkup = `<rect width="${w}" height="${h}" rx="${cr}" ry="${cr}" fill="white"/>`
  } else if (node.type === 'ELLIPSE') {
    const rx = w / 2, ry = h / 2
    pathsMarkup = `<ellipse cx="${rx}" cy="${ry}" rx="${rx}" ry="${ry}" fill="white"/>`
  }

  if (!pathsMarkup) return null

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${pathsMarkup}</svg>`
  const b64 = btoa(svg)
  if (_svgB64Map[b64]) {
    _svgNodeMap[node.id] = _svgB64Map[b64]
    return _svgB64Map[b64]
  }
  _svgCounter++
  const asset: ImageAsset = { id: 'svg-' + _svgCounter, format: 'svg', b64 }
  _svgB64Map[b64] = asset
  _svgNodeMap[node.id] = asset
  return asset
}

async function positionedChildren(
  node: ChildrenMixin,
  depth: number,
  offsetX: number,
  offsetY: number,
  exclude?: SceneNode,
): Promise<string> {
  const parts = await Promise.all(node.children.map(async c => {
    if (c === exclude) return ''
    const markup = await nodeToGui(c, depth)
    return markup ? shiftRootPosition(markup, offsetX, offsetY) : ''
  }))
  return parts.filter(Boolean).join('\n')
}

async function frameToGui(node: FrameNode, depth: number): Promise<string> {
  const lm = node.layoutMode as string
  const isStack = lm !== 'NONE'
  const isGrid = lm === 'GRID'
  const tag = !isStack ? 'frame' : isGrid ? 'grid' : lm === 'HORIZONTAL' ? 'row' : 'col'
  const isRoot = depth === 1

  const fillStyleIdRaw = (node as any).fillStyleId
  const fillStyleId = typeof fillStyleIdRaw === 'string' && fillStyleIdRaw ? fillStyleIdRaw : null
  const fillStyleName = fillStyleId ? resolveFillStyle(fillStyleId) : null

  const effectStyleIdRaw = (node as any).effectStyleId
  const effectStyleId = typeof effectStyleIdRaw === 'string' && effectStyleIdRaw ? effectStyleIdRaw : null
  const effectStyleName = effectStyleId ? resolveEffectStyle(effectStyleId) : null

  const isCompRoot = _generatingComponentRoot
  if (_generatingComponentRoot) _generatingComponentRoot = false

  // For root col/row/stack with auto primary-axis sizing, omit h — the canvas
  // grows with content. Fixed artboards (<frame>) and grid always emit explicit h.
  var rootAutoH = false
  if (isRoot && isStack && !isGrid) {
    var pas = (node as any).primaryAxisSizingMode
    rootAutoH = pas === 'AUTO'
  }

  const a: Record<string, AttrVal> = {
    id: componentBodyId(node.name),
    name: node.name,
    w: Math.round(node.width),
    h: rootAutoH ? undefined : Math.round(node.height),
    fill: fillStyleName ? undefined : fillValue(node.fills, node.width, node.height),
    'fill-style': fillStyleName || undefined,
    radius: cornerRadius(node),
    'corner-smoothing': node.cornerSmoothing > 0 ? node.cornerSmoothing : undefined,
    opacity: node.opacity < 1 ? node.opacity : undefined,
    blend: blendModeAttr(node),
    mask: maskAttr(node),
    rotation: !isRoot ? rotationAttr(node) : undefined,
    flip: !isRoot ? flipAttr(node) : undefined,
    visible: !isRoot ? visibleAttr(node) : undefined,
    clip: node.clipsContent || undefined,
    shadow: (effectStyleName || visibleEffects(node.effects).length) ? undefined : shadowAttr(node),
    'effect-style': effectStyleName || undefined,
  }
  if (!isRoot && !isCompRoot) {
    a.x = Math.round(node.x)
    a.y = Math.round(node.y)
  }
  Object.assign(a, strokeAttrs(node))
  if (!isRoot) {
    Object.assign(a, constraintAttrs(node))
    Object.assign(a, sizingAttrs(node))
    Object.assign(a, layoutPositionAttrs(node))
    Object.assign(a, minMaxAttrs(node))
  }
  Object.assign(a, debugAttrs(node))

  if (isStack) {
    if (isGrid) {
      const gn = node as any
      a['columns'] = gn.gridColumnCount > 0 ? gn.gridColumnCount : undefined
      a['rows'] = gn.gridRowCount > 0 ? gn.gridRowCount : undefined
      a['col-gap'] = gn.gridColumnGap > 0 ? gn.gridColumnGap : undefined
      a['row-gap'] = gn.gridRowGap > 0 ? gn.gridRowGap : undefined
    } else {
      a.gap = stackGap(node)
      a['reverse-z'] = node.itemReverseZIndex || undefined
      a.wrap = node.layoutWrap === 'WRAP' ? true : undefined
    }
    a.p = padding(node)
    a.align = ninePointAlign(node)
  }

  const emptyPaints: readonly Paint[] = []
  const emptyEffects: readonly Effect[] = []
  const fillsForAppearance = fillStyleName ? emptyPaints : node.fills
  const effectsForAppearance = effectStyleName ? emptyEffects : node.effects
  const appearance = appearanceBlock(fillsForAppearance, effectsForAppearance, node.width, node.height, depth + 1, node)
  const childInner = await children(node, depth + 1)
  const inner = [appearance, childInner].filter(Boolean).join('\n')
  if (!inner) return `${ind(depth)}<${tag} ${attrs(a)} />`
  return `${ind(depth)}<${tag} ${attrs(a)}>\n${inner}\n${ind(depth)}</${tag}>`
}

function findNodeInTree(root: SceneNode, id: string): SceneNode | null {
  if (root.id === id) return root
  if ('children' in root) {
    const ch = (root as ChildrenMixin).children
    for (var i = 0; i < ch.length; i++) {
      const found = findNodeInTree(ch[i] as SceneNode, id)
      if (found) return found
    }
  }
  return null
}

async function instanceToGui(node: InstanceNode, depth: number): Promise<string> {
  const comp = node.mainComponent
  if (!comp) return frameToGui(node as FrameNode, depth)

  if (!_componentRegistry.has(comp.id)) await registerComponent(comp)
  const entry = _componentRegistry.get(comp.id)
  if (!entry || !entry.guiId) return frameToGui(node as FrameNode, depth)

  // Detach threshold: >= 75% of layers overridden AND >= 4 layers total.
  // Heavily overridden instances lose component identity — emit as inline tree
  // with component attr as a metadata hint only.
  var allOverrides = (node as any).overrides as ReadonlyArray<{ id: string; overriddenFields: string[] }> | null
  var overrideCount = 0
  if (allOverrides) {
    for (var di = 0; di < allOverrides.length; di++) {
      if (allOverrides[di].overriddenFields && allOverrides[di].overriddenFields.length > 0) overrideCount++
    }
  }
  var totalLayers = countComponentBodyLayers(comp)
  if (totalLayers >= 4 && overrideCount / totalLayers >= 0.75) {
    var detached = await frameToGui(node as FrameNode, depth)
    return detached.replace(/^(\s*<\w+)/, '$1 component="' + entry.guiId + '"')
  }

  const isRoot = depth === 1
  const a: Record<string, AttrVal> = {
    component: entry.guiId,
    name: node.name !== comp.name ? node.name : undefined,
    x: isRoot ? undefined : Math.round(node.x),
    y: isRoot ? undefined : Math.round(node.y),
    w: Math.round(node.width),
    h: Math.round(node.height),
    radius: cornerRadius(node as any as FrameNode),
    opacity: node.opacity < 1 ? node.opacity : undefined,
    blend: blendModeAttr(node),
    rotation: rotationAttr(node),
    flip: flipAttr(node),
    visible: visibleAttr(node),
  }
  Object.assign(a, constraintAttrs(node))
  Object.assign(a, sizingAttrs(node))
  Object.assign(a, layoutPositionAttrs(node))
  Object.assign(a, minMaxAttrs(node))
  Object.assign(a, debugAttrs(node))

  // Use buildInstanceBodyIdMap so instance-scoped node IDs in overrides resolve correctly.
  // Figma instance child IDs use format "<instanceId>;<componentNodeId>" — they are NOT
  // the same as component body node IDs, so simulateBodyIds(comp) alone would miss them.
  var bodyIds = buildInstanceBodyIdMap(node as SceneNode, comp as SceneNode)
  var overrides = allOverrides

  // Build a lookup: target body-id -> declared prop name, for all prop types
  var bodyIdToPropName: Record<string, string> = {}
  for (var pi = 0; pi < entry.props.length; pi++) {
    var ep = entry.props[pi]
    // target may be space-separated list — register each id
    var targets = ep.target.split(' ')
    for (var ti = 0; ti < targets.length; ti++) {
      if (targets[ti]) bodyIdToPropName[targets[ti]] = ep.name
    }
  }

  // 1. Formal TEXT property overrides (declared via componentPropertyDefinitions).
  // NOTE: componentPropertyDefinitions crashes on variant ComponentNodes — always read
  // from the parent ComponentSet when comp is a variant.
  const compProps = (node as any).componentProperties as Record<string, { type: string; value: unknown }> | null
  if (compProps) {
    var compDefs: Record<string, { defaultValue: unknown }> | null = null
    try {
      var defSource = (comp as any).parent && (comp as any).parent.type === 'COMPONENT_SET'
        ? (comp as any).parent
        : comp
      compDefs = (defSource as any).componentPropertyDefinitions || null
    } catch (_e) { /* not available — variant or restricted node */ }

    var propKeys = Object.keys(compProps)
    for (var i = 0; i < propKeys.length; i++) {
      var rawName = propKeys[i]
      var propDef = compProps[rawName]
      if (propDef.type !== 'TEXT') continue  // visibility handled in Section 3
      var val = propDef.value
      if (typeof val !== 'string') continue
      var defaultVal = compDefs && compDefs[rawName] && compDefs[rawName].defaultValue
      if (!defaultVal || val !== defaultVal) a[sanitizePropName(rawName)] = val
    }
  }

  // 2. Ad-hoc TEXT overrides — text content changed directly on a layer without a
  // formal componentPropertyDefinition. Detected via InstanceNode.overrides.
  if (overrides) {
    for (var oi = 0; oi < overrides.length; oi++) {
      var ov = overrides[oi]
      if (!ov.overriddenFields || ov.overriddenFields.indexOf('characters') === -1) continue
      var ovNode = findNodeInTree(node as SceneNode, ov.id)
      if (!ovNode || ovNode.type !== 'TEXT') continue
      var bid = bodyIds.get(ov.id) || sanitizeId(ovNode.name)
      if (!bid) continue
      var textKey = bodyIdToPropName[bid] || bid
      if (a[textKey] !== undefined) continue
      var chars = (ovNode as TextNode).characters
      if (typeof chars === 'string') a[textKey] = chars
    }
  }

  // 3. Visibility overrides.
  // Primary: use InstanceNode.overrides — the only reliable source in Figma's plugin API.
  // Figma does NOT always set n.visible===false on instance children when the hide was
  // done via the eye-icon override; the override is only guaranteed to appear here.
  if (overrides) {
    for (var vi = 0; vi < overrides.length; vi++) {
      var vov = overrides[vi]
      if (!vov.overriddenFields || vov.overriddenFields.indexOf('visible') === -1) continue
      var vbid = bodyIds.get(vov.id)
      if (!vbid) continue
      var vkey = bodyIdToPropName[vbid] || vbid
      if (a[vkey] !== undefined) continue
      // Read current visibility from the live instance tree to get the actual value
      var vovNode = findNodeInTree(node as SceneNode, vov.id)
      if (vovNode) a[vkey] = vovNode.visible === false ? 'false' : 'true'
    }
  }
  // Secondary: walk instance children to catch boolean component properties whose
  // defaultValue is false — these don't appear in overrides but are hidden at render time.
  function walkVisibility(n: SceneNode) {
    if (n.visible === false) {
      var wbid = bodyIds.get(n.id)
      if (wbid) {
        var wkey = bodyIdToPropName[wbid] || wbid
        if (a[wkey] === undefined) a[wkey] = 'false'
      }
    }
    if ('children' in n) {
      var wch = (n as ChildrenMixin).children
      for (var wci = 0; wci < wch.length; wci++) walkVisibility(wch[wci] as SceneNode)
    }
  }
  if ('children' in node) {
    var instCh = (node as ChildrenMixin).children
    for (var ic = 0; ic < instCh.length; ic++) walkVisibility(instCh[ic] as SceneNode)
  }

  // 4. Color overrides — solid fill changed on a layer.
  if (overrides) {
    for (var fi = 0; fi < overrides.length; fi++) {
      var fov = overrides[fi]
      if (!fov.overriddenFields || fov.overriddenFields.indexOf('fills') === -1) continue
      var fovNode = findNodeInTree(node as SceneNode, fov.id)
      if (!fovNode) continue
      if (getImageFillFromNode(fovNode)) continue  // image — handled in section 5
      var fillColor = ('fills' in fovNode) ? solidFill((fovNode as GeometryMixin).fills) : null
      if (!fillColor) continue
      var fbid = bodyIds.get(fov.id)
      if (!fbid) continue
      var fkey = bodyIdToPropName[fbid] || fbid
      if (a[fkey] === undefined) a[fkey] = fillColor
    }
  }

  // 5. Image overrides — image fill changed on a layer.
  if (overrides) {
    for (var imi = 0; imi < overrides.length; imi++) {
      var imov = overrides[imi]
      if (!imov.overriddenFields || imov.overriddenFields.indexOf('fills') === -1) continue
      var imNode = findNodeInTree(node as SceneNode, imov.id)
      if (!imNode) continue
      var imFill = getImageFillFromNode(imNode)
      if (!imFill || !imFill.imageHash) continue
      var imAsset = _imageMap[imFill.imageHash]
      if (!imAsset) continue
      var imbid = bodyIds.get(imov.id)
      if (!imbid) continue
      var imkey = bodyIdToPropName[imbid] || imbid
      if (a[imkey] === undefined) a[imkey] = '$' + imAsset.id
    }
  }

  // 6b. Stroke color overrides — solid stroke changed on a layer.
  if (overrides) {
    for (var sti = 0; sti < overrides.length; sti++) {
      var stov = overrides[sti]
      if (!stov.overriddenFields || stov.overriddenFields.indexOf('strokes') === -1) continue
      var stNode = findNodeInTree(node as SceneNode, stov.id)
      if (!stNode || !('strokes' in stNode)) continue
      var strokes = (stNode as GeometryMixin).strokes
      if (!strokes || strokes.length === 0 || strokes[0].type !== 'SOLID') continue
      var stColor = solidFill(strokes as readonly Paint[])
      if (!stColor) continue
      var stbid = bodyIds.get(stov.id)
      if (!stbid) continue
      // stroke color prop name uses -stroke suffix to distinguish from fill prop
      var stPropName = stbid + '-stroke'
      var stDeclared = bodyIdToPropName[stPropName]
      var stkey = stDeclared || stPropName
      if (a[stkey] === undefined) a[stkey] = stColor
    }
  }

  // 7. Style overrides — text style, fill style, effect style, stroke style swapped.
  if (overrides) {
    var styleFields: Array<{ field: string; bind: string; suffix: string }> = [
      { field: 'textStyleId',   bind: 'text-style',   suffix: '-text'   },
      { field: 'fillStyleId',   bind: 'fill-style',   suffix: '-fill'   },
      { field: 'effectStyleId', bind: 'effect-style', suffix: '-effect' },
      { field: 'strokeStyleId', bind: 'stroke-style', suffix: '-stroke-style' },
    ]
    for (var sfi = 0; sfi < overrides.length; sfi++) {
      var sfov = overrides[sfi]
      if (!sfov.overriddenFields) continue
      var sfbid = bodyIds.get(sfov.id)
      if (!sfbid) continue
      var sfNode = findNodeInTree(node as SceneNode, sfov.id)
      if (!sfNode) continue
      for (var sff = 0; sff < styleFields.length; sff++) {
        var sf = styleFields[sff]
        if (sfov.overriddenFields.indexOf(sf.field) === -1) continue
        var rawStyleId = (sfNode as any)[sf.field]
        if (!rawStyleId || typeof rawStyleId !== 'string') continue
        var resolvedName: string | null = null
        if (sf.bind === 'text-style') resolvedName = resolveTextStyle(rawStyleId)
        else if (sf.bind === 'fill-style') resolvedName = resolveFillStyle(rawStyleId)
        else if (sf.bind === 'effect-style') resolvedName = resolveEffectStyle(rawStyleId)
        if (!resolvedName) continue
        // prop name uses layer id + bind suffix to distinguish from other props
        var sfPropName = sfbid + sf.suffix
        var sfDeclared = bodyIdToPropName[sfPropName]
        var sfkey = sfDeclared || sfPropName
        // Style names are plain strings (e.g. "Heading/Large"), NOT $token refs.
        // The renderer looks up activeStyles[name] directly — no $ prefix.
        if (a[sfkey] === undefined) a[sfkey] = resolvedName
      }
    }
  }

  // 8. Numeric property overrides — cornerRadius, opacity, etc. changed on a child layer.
  if (overrides) {
    var numericFields: Array<{ field: string; suffix: string }> = [
      { field: 'cornerRadius', suffix: '-radius' },
      { field: 'opacity',      suffix: '-opacity' },
    ]
    for (var nfi = 0; nfi < overrides.length; nfi++) {
      var nfov = overrides[nfi]
      if (!nfov.overriddenFields) continue
      var nfbid = bodyIds.get(nfov.id)
      if (!nfbid) continue
      var nfNode = findNodeInTree(node as SceneNode, nfov.id)
      if (!nfNode) continue
      for (var nff = 0; nff < numericFields.length; nff++) {
        var nf = numericFields[nff]
        if (nfov.overriddenFields.indexOf(nf.field) === -1) continue
        var nfVal = (nfNode as any)[nf.field]
        if (typeof nfVal !== 'number' || nfVal === figma.mixed) continue
        var nfPropName = nfbid + nf.suffix
        var nfDeclared = bodyIdToPropName[nfPropName]
        var nfkey = nfDeclared || nfPropName
        if (a[nfkey] === undefined) a[nfkey] = String(Math.round(nfVal * 100) / 100)
      }
    }
  }

  // 9. Component swap overrides — nested instance replaced with a different component.
  if (compProps) {
    var swapKeys = Object.keys(compProps)
    for (var swi = 0; swi < swapKeys.length; swi++) {
      var swapDef = compProps[swapKeys[swi]]
      if (swapDef.type !== 'INSTANCE_SWAP') continue
      var swapTargetInComp = findPropTargetNode(comp as SceneNode, swapKeys[swi], 'mainComponent')
      if (!swapTargetInComp) continue
      var swapBodyId = bodyIds.get(swapTargetInComp.id)
      if (!swapBodyId) continue
      var swapInstanceNode = findNodeInTree(node as SceneNode, swapTargetInComp.id)
      if (!swapInstanceNode || swapInstanceNode.type !== 'INSTANCE') continue
      var swappedComp = (swapInstanceNode as InstanceNode).mainComponent
      if (!swappedComp) continue
      var swappedEntry = _componentRegistry.get(swappedComp.id)
      if (!swappedEntry || !swappedEntry.guiId) continue
      var swkey = bodyIdToPropName[swapBodyId] || swapBodyId
      if (a[swkey] === undefined) a[swkey] = swappedEntry.guiId
    }
  }

  return `${ind(depth)}<instance ${attrs(a)} />`
}

async function componentsBlock(): Promise<string> {
  if (!_componentRegistry.size) return ''

  const lines: string[] = []
  const emittedSets = new Set<string>()

  const compIds = Array.from(_componentRegistry.keys())
  for (var ci = 0; ci < compIds.length; ci++) {
    const entry = _componentRegistry.get(compIds[ci])
    if (!entry || !entry.guiId) continue

    if (entry.setGuiId) {
      // Part of a component set — emit the whole set once
      if (emittedSets.has(entry.setGuiId)) continue
      emittedSets.add(entry.setGuiId)

      const setEntry = Array.from(_componentSetRegistry.values()).find(function(s) { return s.guiId === entry.setGuiId })
      if (!setEntry) continue

      const variantLines: string[] = []
      for (var vi = 0; vi < setEntry.componentIds.length; vi++) {
        const ce = _componentRegistry.get(setEntry.componentIds[vi])
        if (!ce || !ce.guiId) continue

        const propsLines = ce.props.map(function(p) {
          return `${ind(4)}<prop ${attrs({ name: p.name, type: p.type, target: p.target, bind: p.bind })} />`
        })
        const propsBlock = propsLines.length
          ? `${ind(3)}<props>\n${propsLines.join('\n')}\n${ind(3)}</props>\n`
          : ''

        if (_debugExport) {
          var dbgChildren = 'children' in ce.figmaNode ? (ce.figmaNode as any).children : []
          console.log('dotgui variant debug', {
            variant: ce.figmaNode.name,
            children: dbgChildren.map(function(c: any) {
              return {
                name: c.name,
                visible: c.visible,
                type: c.type,
                componentPropertyReferences: c.componentPropertyReferences,
              }
            }),
          })
        }
        _generatingComponentBody = true
        _generatingComponentRoot = true
        _componentBodyUsedIds = new Set()
        // NOTE: componentPropertyDefinitions is only valid on ComponentSet or standalone
        // component — NOT on a variant ComponentNode. Always read from the set.
        _currentComponentDefs = (setEntry.figmaNode as any).componentPropertyDefinitions || null
        const body = await frameToGui(ce.figmaNode as FrameNode, 3)
        _generatingComponentBody = false
        _componentBodyUsedIds = null
        _currentComponentDefs = null

        const vA: Record<string, AttrVal> = { id: ce.guiId }
        if (ce.variantAttrs) Object.assign(vA, ce.variantAttrs)
        variantLines.push(
          `${ind(2)}<variant ${attrs(vA)}>\n${propsBlock}${body}\n${ind(2)}</variant>`
        )
      }

      lines.push(
        `${ind(1)}<component-set ${attrs({ name: setEntry.name, id: setEntry.guiId })}>\n${variantLines.join('\n')}\n${ind(1)}</component-set>`
      )
    } else {
      // Standalone component
      const propsLines = entry.props.map(function(p) {
        return `${ind(3)}<prop ${attrs({ name: p.name, type: p.type, target: p.target, bind: p.bind })} />`
      })
      const propsBlock = propsLines.length
        ? `${ind(2)}<props>\n${propsLines.join('\n')}\n${ind(2)}</props>\n`
        : ''

      _generatingComponentBody = true
      _generatingComponentRoot = true
      _componentBodyUsedIds = new Set()
      _currentComponentDefs = (entry.figmaNode as any).componentPropertyDefinitions || null
      const body = await frameToGui(entry.figmaNode as FrameNode, 2)
      _generatingComponentBody = false
      _componentBodyUsedIds = null
      _currentComponentDefs = null

      lines.push(
        `${ind(1)}<component ${attrs({ name: entry.figmaNode.name, id: entry.guiId })}>\n${propsBlock}${body}\n${ind(1)}</component>`
      )
    }
  }

  if (!lines.length) return ''
  return `<components>\n${lines.join('\n')}\n</components>\n`
}

async function groupToGui(node: GroupNode, depth: number): Promise<string> {
  const visChildren = node.children.filter(c => c.visible !== false)
  const firstChild = visChildren[0]
  const maskChild = firstChild && 'isMask' in firstChild && (firstChild as BlendMixin).isMask
    ? firstChild as SceneNode : null

  const a: Record<string, AttrVal> = {
    id: componentBodyId(node.name),
    name: node.name,
    x: Math.round(node.x),
    y: Math.round(node.y),
    w: Math.round(node.width),
    h: Math.round(node.height),
    opacity: node.opacity < 1 ? node.opacity : undefined,
    blend: blendModeAttr(node),
    mask: maskAttr(node),
    rotation: rotationAttr(node),
    flip: flipAttr(node),
    visible: visibleAttr(node),
  }

  if (maskChild) {
    const maskAsset = maskNodeToAsset(maskChild)
    if (maskAsset) {
      a['mask-src'] = 'assets/' + maskAsset.id + '.svg'
      a['mask-x'] = Math.round((maskChild as LayoutMixin).x - node.x)
      a['mask-y'] = Math.round((maskChild as LayoutMixin).y - node.y)
      a['mask-width'] = Math.round((maskChild as LayoutMixin).width)
      a['mask-height'] = Math.round((maskChild as LayoutMixin).height)
    }
  }

  Object.assign(a, constraintAttrs(node))
  Object.assign(a, sizingAttrs(node))
  Object.assign(a, layoutPositionAttrs(node))
  Object.assign(a, minMaxAttrs(node))
  Object.assign(a, debugAttrs(node))
  const inner = await positionedChildren(node, depth + 1, node.x || 0, node.y || 0, maskChild || undefined)
  if (!inner) return `${ind(depth)}<group ${attrs(a)} />`
  return `${ind(depth)}<group ${attrs(a)}>\n${inner}\n${ind(depth)}</group>`
}

function fontWeight(style: string): number {
  const s = style.toLowerCase()
  if (s.indexOf('thin') !== -1) return 100
  if (s.indexOf('extralight') !== -1 || s.indexOf('extra light') !== -1 || s.indexOf('ultralight') !== -1) return 200
  if (s.indexOf('light') !== -1) return 300
  if (s.indexOf('semibold') !== -1 || s.indexOf('semi bold') !== -1 || s.indexOf('demibold') !== -1) return 600
  if (s.indexOf('extrabold') !== -1 || s.indexOf('extra bold') !== -1 || s.indexOf('ultrabold') !== -1) return 800
  if (s.indexOf('black') !== -1 || s.indexOf('heavy') !== -1) return 900
  if (s.indexOf('bold') !== -1) return 700
  if (s.indexOf('medium') !== -1) return 500
  return 400
}

function fontStyle(style: string): string {
  const s = style.toLowerCase()
  return s.indexOf('italic') !== -1 || s.indexOf('oblique') !== -1 ? 'italic' : 'normal'
}

function fontSource(family: string): string {
  if (SYSTEM_FONTS[family]) return 'system'
  if (GOOGLE_FONT_MAP[family]) return 'google'
  return 'unresolved'
}

function addFontUsage(usage: Record<string, FontUsage>, fontName: FontName): void {
  if (!usage[fontName.family]) {
    usage[fontName.family] = { family: fontName.family, weights: {}, styles: {} }
  }
  usage[fontName.family].weights[String(fontWeight(fontName.style))] = true
  usage[fontName.family].styles[fontStyle(fontName.style)] = true
}

function collectFontUsage(node: SceneNode, usage: Record<string, FontUsage>): void {
  if (node.visible === false) return

  if (node.type === 'TEXT') {
    const text = node as TextNode
    if (text.fontName !== figma.mixed) {
      addFontUsage(usage, text.fontName as FontName)
    } else {
      // Mixed fonts: collect from each segment
      const segments = getTextSegments(text)
      for (let i = 0; i < segments.length; i++) {
        if (segments[i].fontName) addFontUsage(usage, segments[i].fontName)
      }
    }
  }

  if ('children' in node) {
    const ch = (node as ChildrenMixin).children
    for (let i = 0; i < ch.length; i++) collectFontUsage(ch[i], usage)
  }
}

// --- token helpers ---

function sanitizeTokenName(raw: string): string {
  return raw.toLowerCase()
    .replace(/\//g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'token'
}

function tokenRef(id: string): string | null {
  const token = _tokenRegistry.get(id)
  if (!token) return null
  _usedTokenIds.add(id)
  return '$' + token.name
}

function collectVarIdsFromPaints(paints: readonly Paint[] | typeof figma.mixed, ids: Set<string>): void {
  if (paints === figma.mixed || !Array.isArray(paints)) return
  for (let i = 0; i < (paints as Paint[]).length; i++) {
    const p = (paints as Paint[])[i]
    if (p.type === 'SOLID') {
      const bv = (p as any).boundVariables
      if (bv && bv.color && bv.color.id) ids.add(bv.color.id)
    }
  }
}

function collectVarIdsFromNode(node: SceneNode, ids: Set<string>): void {
  if ('fills' in node) collectVarIdsFromPaints((node as GeometryMixin).fills, ids)
  if ('strokes' in node) collectVarIdsFromPaints((node as GeometryMixin).strokes, ids)
  const bv = (node as any).boundVariables
  if (bv) {
    const keys = ['cornerRadius', 'strokeWeight', 'itemSpacing', 'fontSize', 'lineHeight', 'letterSpacing']
    for (let i = 0; i < keys.length; i++) {
      if (bv[keys[i]] && bv[keys[i]].id) ids.add(bv[keys[i]].id)
    }
  }
  if ('children' in node) {
    const ch = (node as ChildrenMixin).children
    for (let i = 0; i < ch.length; i++) collectVarIdsFromNode(ch[i] as SceneNode, ids)
  }
}

async function resolveAllVariables(root: SceneNode): Promise<void> {
  _tokenRegistry = new Map()
  _usedTokenIds = new Set()
  _styleRegistry = new Map()
  _usedStyleIds = new Set()

  const vars = (figma as any).variables
  if (!vars) return

  const ids = new Set<string>()
  collectVarIdsFromNode(root, ids)
  if (!ids.size) return

  const nameCount: Record<string, number> = {}
  const idArr = Array.from(ids)

  for (let i = 0; i < idArr.length; i++) {
    const id = idArr[i]
    try {
      const variable = await vars.getVariableByIdAsync(id)
      if (!variable || variable.resolvedType === 'BOOLEAN') continue

      const collection = await vars.getVariableCollectionByIdAsync(variable.variableCollectionId)
      const modeId = (collection && collection.defaultModeId) || Object.keys(variable.valuesByMode)[0]
      if (!modeId) continue

      let rawValue = variable.valuesByMode[modeId]
      let resolvedType = variable.resolvedType

      // Follow one level of aliasing
      if (rawValue && typeof rawValue === 'object' && rawValue.type === 'VARIABLE_ALIAS') {
        const aliasVar = await vars.getVariableByIdAsync(rawValue.id)
        if (!aliasVar) continue
        const aliasCol = await vars.getVariableCollectionByIdAsync(aliasVar.variableCollectionId)
        const aliasModeId = (aliasCol && aliasCol.defaultModeId) || Object.keys(aliasVar.valuesByMode)[0]
        if (!aliasModeId) continue
        rawValue = aliasVar.valuesByMode[aliasModeId]
        resolvedType = aliasVar.resolvedType
      }

      let value: string
      let type: 'color' | 'number' | 'string'

      if (resolvedType === 'COLOR') {
        const c = rawValue as { r: number; g: number; b: number; a: number }
        value = rgbToHex(c.r, c.g, c.b, c.a !== undefined ? c.a : 1)
        type = 'color'
      } else if (resolvedType === 'FLOAT') {
        value = String(Math.round((rawValue as number) * 100) / 100)
        type = 'number'
      } else if (resolvedType === 'STRING') {
        value = String(rawValue)
        type = 'string'
      } else {
        continue
      }

      const baseName = sanitizeTokenName(variable.name)
      let finalName = baseName
      if (nameCount[baseName] !== undefined) {
        nameCount[baseName]++
        finalName = baseName + '-' + nameCount[baseName]
      } else {
        nameCount[baseName] = 0
      }

      _tokenRegistry.set(id, { name: finalName, value, type })
    } catch (_e) { /* skip unresolvable variables */ }
  }
}

function tokensBlock(): string {
  if (!_usedTokenIds.size) return ''

  const colorLines: string[] = []
  const numberLines: string[] = []
  const stringLines: string[] = []

  Array.from(_usedTokenIds)
    .map(id => _tokenRegistry.get(id))
    .filter(function(t): t is { name: string; value: string; type: 'color' | 'number' | 'string' } { return !!t })
    .sort(function(a, b) { return a.name.localeCompare(b.name) })
    .forEach(function(token) {
      const line = `${ind(1)}<${token.type} name="${token.name}" value="${xmlEscape(token.value)}" />`
      if (token.type === 'color') colorLines.push(line)
      else if (token.type === 'number') numberLines.push(line)
      else stringLines.push(line)
    })

  const lines = colorLines.concat(numberLines).concat(stringLines)
  if (!lines.length) return ''
  return `<tokens>\n${lines.join('\n')}\n</tokens>\n`
}

function resolveTextStyle(id: string): string | null {
  if (_styleRegistry.has(id)) {
    _usedStyleIds.add(id)
    return _styleRegistry.get(id)!.name
  }
  try {
    const style = figma.getStyleById(id) as any
    if (!style || style.type !== 'TEXT') return null
    const fn = style.fontName as FontName
    const lh = style.lineHeight as LineHeight
    const ls = style.letterSpacing as LetterSpacing
    const styleDecoRaw = (style.textDecoration as string)
    const styleDecoVal = styleDecoRaw !== 'NONE' ? styleDecoRaw.toLowerCase() : undefined
    const styleFeatures = style.openTypeFeatures
    const styleVariations = style.fontVariations

    const entryAttrs: Record<string, AttrVal> = {
      name: style.name,
      'font-family': fn.family,
      'font-postscript': fontPostscriptName(fn.family, fn.style),
      'font-style-name': fn.style !== 'Regular' ? fn.style : undefined,
      'font-size': style.fontSize,
      'font-weight': fontWeight(fn.style),
      'font-style': fontStyle(fn.style) === 'italic' ? 'italic' : undefined,
      'font-variation': styleVariations && typeof styleVariations === 'object'
        ? fontVariationVal(styleVariations) : undefined,
      'font-feature': styleFeatures && typeof styleFeatures === 'object'
        ? fontFeatureVal(styleFeatures) : undefined,
      'line-height': lineHeightVal(lh),
      'letter-spacing': letterSpacingVal(ls),
      'decoration': styleDecoVal,
      'decoration-color': styleDecoVal && style.textDecorationColor && typeof style.textDecorationColor === 'object'
        ? rgbaToHex(style.textDecorationColor, typeof style.textDecorationColor.a === 'number' ? style.textDecorationColor.a : 1)
        : undefined,
      'decoration-style': styleDecoVal && style.textDecorationStyle
        ? decoStyleVal(style.textDecorationStyle) : undefined,
      'decoration-thickness': styleDecoVal && typeof style.textDecorationThickness === 'number' && style.textDecorationThickness > 0
        ? style.textDecorationThickness : undefined,
      'text-case': (style.textCase as string) !== 'ORIGINAL' ? TEXT_CASE[style.textCase as string] : undefined,
    }
    _styleRegistry.set(id, { name: style.name, tag: 'text-style', entryAttrs })
    _usedStyleIds.add(id)
    return style.name
  } catch (_e) {
    return null
  }
}

function resolveFillStyle(id: string): string | null {
  if (!id) return null
  if (_styleRegistry.has(id)) {
    const entry = _styleRegistry.get(id)!
    if (entry.tag !== 'fill-style') return null
    _usedStyleIds.add(id)
    return entry.name
  }
  try {
    const style = figma.getStyleById(id) as any
    if (!style || style.type !== 'PAINT') return null
    const paints = (style.paints as Paint[]).filter(function(p: Paint) { return p.visible !== false })
    if (!paints.length || paints[0].type !== 'SOLID') return null
    const p = paints[0] as SolidPaint
    const value = rgbToHex(p.color.r, p.color.g, p.color.b, p.opacity !== undefined ? p.opacity : 1)
    const entry: StyleEntry = {
      name: style.name as string,
      tag: 'fill-style',
      entryAttrs: { name: style.name, value },
    }
    _styleRegistry.set(id, entry)
    _usedStyleIds.add(id)
    return style.name as string
  } catch (_e) {
    return null
  }
}

function resolveEffectStyle(id: string): string | null {
  if (!id) return null
  if (_styleRegistry.has(id)) {
    const entry = _styleRegistry.get(id)!
    if (entry.tag !== 'effect-style') return null
    _usedStyleIds.add(id)
    return entry.name
  }
  try {
    const style = figma.getStyleById(id) as any
    if (!style || style.type !== 'EFFECT') return null
    const children = appearanceEffectLines(style.effects as Effect[], 1)
    if (!children.length) return null
    const entry: StyleEntry = {
      name: style.name as string,
      tag: 'effect-style',
      entryAttrs: { name: style.name },
      children,
    }
    _styleRegistry.set(id, entry)
    _usedStyleIds.add(id)
    return style.name as string
  } catch (_e) {
    return null
  }
}

function stylesBlock(): string {
  if (!_usedStyleIds.size) return ''
  const textLines: string[] = []
  const fillLines: string[] = []
  const effectLines: string[] = []
  const sorted = Array.from(_usedStyleIds).sort(function(a, b) {
    const na = _styleRegistry.get(a)
    const nb = _styleRegistry.get(b)
    if (!na || !nb) return 0
    return na.name.localeCompare(nb.name)
  })
  for (let i = 0; i < sorted.length; i++) {
    const entry = _styleRegistry.get(sorted[i])
    if (!entry) continue
    var line: string
    if (entry.children && entry.children.length) {
      line = ind(1) + '<' + entry.tag + ' ' + attrs(entry.entryAttrs) + '>\n' +
        entry.children.join('\n') + '\n' + ind(1) + '</' + entry.tag + '>'
    } else {
      line = ind(1) + '<' + entry.tag + ' ' + attrs(entry.entryAttrs) + ' />'
    }
    if (entry.tag === 'fill-style') fillLines.push(line)
    else if (entry.tag === 'effect-style') effectLines.push(line)
    else textLines.push(line)
  }
  const lines = textLines.concat(fillLines).concat(effectLines)
  if (!lines.length) return ''
  return '<styles>\n' + lines.join('\n') + '\n</styles>\n'
}

function fontsBlock(node: SceneNode): string {
  const usage: Record<string, FontUsage> = {}
  collectFontUsage(node, usage)

  const families = Object.keys(usage).sort()
  if (!families.length) return ''

  const lines: string[] = []
  for (let i = 0; i < families.length; i++) {
    const item = usage[families[i]]
    const googleFont = GOOGLE_FONT_MAP[item.family]
    const weights = Object.keys(item.weights).sort(function(a, b) { return parseInt(a) - parseInt(b) })
    const styles = Object.keys(item.styles).sort()
    lines.push(`${ind(1)}<font ${attrs({
      family: item.family,
      source: fontSource(item.family),
      category: googleFont ? googleFont.category : undefined,
      weights: weights.join(' '),
      styles: styles.join(' '),
      variants: googleFont && googleFont.variants ? googleFont.variants.join(' ') : undefined,
    })} />`)
  }

  return `${ind(0)}<fonts>\n${lines.join('\n')}\n${ind(0)}</fonts>\n`
}

function lineHeightVal(lh: LineHeight): string | undefined {
  if (lh.unit === 'AUTO') return undefined
  if (lh.unit === 'PERCENT') return lh.value + '%'
  return String(Math.round(lh.value))
}

function letterSpacingVal(ls: LetterSpacing): string | undefined {
  if (ls.value === 0) return undefined
  if (ls.unit === 'PERCENT') return ls.value + '%'
  return String(ls.value)
}

// Derive a best-effort PostScript name from Figma's family + style.
// e.g. "Inter" + "Bold Italic" → "Inter-BoldItalic"
function fontPostscriptName(family: string, style: string): string {
  const s = style.replace(/\s+/g, '')
  if (!s || s.toLowerCase() === 'regular' || s.toLowerCase() === 'roman') {
    return family.replace(/\s+/g, '')
  }
  return family.replace(/\s+/g, '') + '-' + s
}

// Serialize Figma's openTypeFeatures object to CSS font-feature-settings syntax.
// e.g. {TNUM: true, LIGA: false} → "tnum" (only enabled features)
function fontFeatureVal(features: Record<string, boolean>): string | undefined {
  const enabled: string[] = []
  const keys = Object.keys(features)
  for (let i = 0; i < keys.length; i++) {
    if (features[keys[i]]) enabled.push('"' + keys[i].toLowerCase() + '"')
  }
  return enabled.length > 0 ? enabled.join(', ') : undefined
}

// Serialize Figma's fontVariations object to CSS font-variation-settings syntax.
// e.g. {wght: 600, wdth: 75} → '"wght" 600, "wdth" 75'
function fontVariationVal(variations: Record<string, number>): string | undefined {
  const axes = Object.keys(variations)
  if (!axes.length) return undefined
  return axes.map(function(ax) { return '"' + ax + '" ' + variations[ax] }).join(', ')
}

// Map Figma textAutoResize to dotgui text-resize value.
function textResizeVal(autoResize: string): string | undefined {
  if (autoResize === 'WIDTH_AND_HEIGHT') return 'hug'
  if (autoResize === 'HEIGHT') return 'hug-height'
  if (autoResize === 'FIXED') return 'fixed'
  if (autoResize === 'TRUNCATE') return 'truncate'
  return undefined
}

// Map Figma list type to dotgui list value.
function listTypeVal(type: string): string | undefined {
  if (type === 'ORDERED_LIST') return 'decimal'
  if (type === 'UNORDERED_LIST') return 'disc'
  return undefined
}

// Convert Figma RGBA color object to hex string (best-effort).
function rgbaToHex(color: RGB, opacity: number): string {
  function ch(n: number): string {
    const h = Math.round(n * 255).toString(16)
    return h.length === 1 ? '0' + h : h
  }
  const base = '#' + ch(color.r) + ch(color.g) + ch(color.b)
  if (opacity >= 1) return base
  return base + ch(opacity)
}

// Map Figma text decoration style string to dotgui value.
function decoStyleVal(style: string): string | undefined {
  if (style === 'SOLID') return 'solid'
  if (style === 'WAVY') return 'wavy'
  if (style === 'DASHED') return 'dashed'
  if (style === 'DOTTED') return 'dotted'
  if (style === 'DOUBLE') return 'double'
  return undefined
}

// --- flip helper ---

function visibleAttr(node: SceneNode): string | undefined {
  return _invisibleNodeIds.has(node.id) ? 'false' : undefined
}

function flipAttr(node: SceneNode): string | undefined {
  var flipH = (node as any).flippedHorizontally
  var flipV = (node as any).flippedVertically
  if (flipH && flipV) return 'both'
  if (flipH) return 'h'
  if (flipV) return 'v'
  return undefined
}

// --- stroke cap / join helpers ---

function strokeCapVal(cap: string): string | undefined {
  if (cap === 'ROUND') return 'round'
  if (cap === 'SQUARE') return 'square'
  if (cap === 'ARROW_LINES') return 'arrow-lines'
  if (cap === 'ARROW_EQUILATERAL') return 'arrow-equilateral'
  return undefined
}

function strokeJoinVal(join: string): string | undefined {
  if (join === 'MITER') return 'miter'
  if (join === 'ROUND') return 'round'
  if (join === 'BEVEL') return 'bevel'
  return undefined
}

// --- font stretch helper ---

function fontStretchVal(style: string): string | undefined {
  var s = style.toLowerCase()
  if (s.indexOf('ultra condensed') !== -1 || s.indexOf('ultracondensed') !== -1) return 'ultra-condensed'
  if (s.indexOf('extra condensed') !== -1 || s.indexOf('extracondensed') !== -1) return 'extra-condensed'
  if (s.indexOf('semi condensed') !== -1 || s.indexOf('semicondensed') !== -1) return 'semi-condensed'
  if (s.indexOf('condensed') !== -1) return 'condensed'
  if (s.indexOf('semi expanded') !== -1 || s.indexOf('semiexpanded') !== -1) return 'semi-expanded'
  if (s.indexOf('extra expanded') !== -1 || s.indexOf('extraexpanded') !== -1) return 'extra-expanded'
  if (s.indexOf('ultra expanded') !== -1 || s.indexOf('ultraexpanded') !== -1) return 'ultra-expanded'
  if (s.indexOf('expanded') !== -1) return 'expanded'
  return undefined
}

interface TextSegment {
  characters: string
  fontName: FontName
  fontSize: number
  fills: ReadonlyArray<Paint>
  textDecoration: TextDecoration
  textCase: TextCase
  letterSpacing: LetterSpacing
  lineHeight: LineHeight
  hyperlink: HyperlinkTarget | null
  openTypeFeatures?: Record<string, boolean>
  listOptions?: { type: string }
  indentation?: number
  baselineOffset?: number
}

function getTextSegments(node: TextNode): TextSegment[] {
  var fn = (node as any).getStyledTextSegments
  if (typeof fn !== 'function') return []
  // Try full field set first; fall back to core fields if the call throws
  // (some fields like 'indentation'/'baselineOffset' may not exist in all Figma versions)
  var fullFields = [
    'fontName', 'fontSize', 'fills', 'textDecoration', 'textCase',
    'letterSpacing', 'lineHeight', 'hyperlink',
    'openTypeFeatures', 'listOptions', 'indentation', 'baselineOffset',
  ]
  var coreFields = ['fontName', 'fontSize', 'fills', 'textDecoration', 'textCase', 'letterSpacing', 'lineHeight', 'hyperlink']
  try {
    var result = fn.call(node, fullFields)
    if (result && result.length) return result
  } catch (e) {}
  try {
    return fn.call(node, coreFields)
  } catch (e) {
    return []
  }
}

function isMixedText(node: TextNode): boolean {
  return node.fontName === figma.mixed
    || node.fontSize === figma.mixed
    || node.fills === figma.mixed
    || node.textDecoration === figma.mixed
    || node.textCase === figma.mixed
    || node.letterSpacing === figma.mixed
    || node.lineHeight === figma.mixed
    || (node as any).openTypeFeatures === figma.mixed
    || (node as any).listOptions === figma.mixed
}

function textToGui(node: TextNode, depth: number): string {
  const vAlign: Record<string, string> = { TOP: 'top', CENTER: 'center', BOTTOM: 'bottom' }
  const autoResize = node.textAutoResize
  const hugW = autoResize === 'WIDTH_AND_HEIGHT'
  const hugH = autoResize === 'WIDTH_AND_HEIGHT' || autoResize === 'HEIGHT'
  const isTruncated = autoResize === 'TRUNCATE'

  const mixed = isMixedText(node)

  var textDir = (node as any).textDirection || (node as any).direction
  var textDirVal: string | undefined
  if (textDir && textDir !== 'LTR' && textDir !== figma.mixed) {
    textDirVal = 'rtl'
  }
  var wm = (node as any).writingMode
  var wmVal: string | undefined
  if (wm && typeof wm === 'string') {
    wmVal = wm.toLowerCase().replace(/_/g, '-')
  }

  const a: Record<string, AttrVal> = {
    id: componentBodyId(node.name),
    name: node.name,
    x: Math.round(node.x),
    y: Math.round(node.y),
    w: hugW ? undefined : Math.round(node.width),
    h: hugH ? undefined : Math.round(node.height),
    align: node.textAlignHorizontal !== 'LEFT' ? node.textAlignHorizontal.toLowerCase() : undefined,
    'vertical-align': node.textAlignVertical !== 'TOP' ? vAlign[node.textAlignVertical] : undefined,
    'paragraph-spacing': (node.paragraphSpacing !== figma.mixed && (node.paragraphSpacing as number) > 0)
      ? node.paragraphSpacing as number : undefined,
    'paragraph-indent': (node.paragraphIndent !== figma.mixed && (node.paragraphIndent as number) > 0)
      ? node.paragraphIndent as number : undefined,
    truncate: isTruncated || undefined,
    'max-lines': node.maxLines != null ? node.maxLines : undefined,
    'leading-trim': (node.leadingTrim && (node.leadingTrim as string) !== 'NONE')
      ? (node.leadingTrim as string).toLowerCase().replace(/_/g, '-') : undefined,
    opacity: node.opacity < 1 ? node.opacity : undefined,
    blend: blendModeAttr(node),
    mask: maskAttr(node),
    rotation: rotationAttr(node),
    flip: flipAttr(node),
    visible: visibleAttr(node),
    direction: textDirVal,
    'writing-mode': wmVal,
  }
  Object.assign(a, constraintAttrs(node))
  Object.assign(a, sizingAttrs(node))
  Object.assign(a, layoutPositionAttrs(node))
  Object.assign(a, minMaxAttrs(node))
  Object.assign(a, strokeAttrs(node))
  Object.assign(a, debugAttrs(node))

  // Single-style flat text
  if (!mixed) {
    const fontName = node.fontName as FontName
    const lh = node.lineHeight as LineHeight
    const ls = node.letterSpacing as LetterSpacing
    const textBv = (node as any).boundVariables
    a.value = node.characters
    if (node.hyperlink !== figma.mixed && node.hyperlink !== null) {
      const hl = node.hyperlink as HyperlinkTarget
      if (hl.type === 'URL') a.href = hl.value
    }

    // Fill style (text color via Figma color style)
    const textFillStyleIdRaw = (node as any).fillStyleId
    const textFillStyleId = typeof textFillStyleIdRaw === 'string' && textFillStyleIdRaw ? textFillStyleIdRaw : null
    const textFillStyleName = textFillStyleId ? resolveFillStyle(textFillStyleId) : null
    a.fill = textFillStyleName ? undefined : solidFill(node.fills)
    a['fill-style'] = textFillStyleName || undefined

    // Use named text style if applied — but always emit per-node typography attrs
    // on top of it. Figma allows applying a text style and then overriding individual
    // properties (font-size, line-height, etc.) per node. If we only emit text-style
    // and skip the individual attrs, the renderer uses the style defaults and misses
    // the override — causing wrong font size, different line wrapping, wrong height.
    const styleId = typeof node.textStyleId === 'string' ? node.textStyleId : null
    const styleName = styleId ? resolveTextStyle(styleId) : null
    if (styleName) {
      a['text-style'] = styleName
      // Fall through — emit all typography attrs below so per-node overrides are captured
    }
    // Always emit all typography attrs — if a text-style is applied this captures
    // any per-node overrides; if no style, this is the only source of truth.
    {
      a['font-family'] = fontName.family
      a['font-postscript'] = fontPostscriptName(fontName.family, fontName.style)
      a['font-style-name'] = fontName.style !== 'Regular' ? fontName.style : undefined
      a['font-size'] = (textBv && textBv.fontSize && textBv.fontSize.id && tokenRef(textBv.fontSize.id)) || node.fontSize as number
      a['font-weight'] = fontWeight(fontName.style)
      a['font-style'] = fontStyle(fontName.style) === 'italic' ? 'italic' : undefined

      // Variable font axes
      const nodeVariations = (node as any).fontVariations
      if (nodeVariations && typeof nodeVariations === 'object') {
        a['font-variation'] = fontVariationVal(nodeVariations)
      }

      // OpenType features
      const nodeFeatures = (node as any).openTypeFeatures
      if (nodeFeatures && typeof nodeFeatures === 'object' && nodeFeatures !== figma.mixed) {
        a['font-feature'] = fontFeatureVal(nodeFeatures)
      }

      a['line-height'] = lineHeightVal(lh)
      a['letter-spacing'] = letterSpacingVal(ls)
      a['font-stretch'] = fontStretchVal(fontName.style)

      // Decoration attrs
      const decoRaw = (node.textDecoration as string)
      a.decoration = decoRaw !== 'NONE' ? decoRaw.toLowerCase() : undefined
      if (a.decoration) {
        const decoColor = (node as any).textDecorationColor
        if (decoColor && typeof decoColor === 'object' && decoColor !== figma.mixed
            && Number.isFinite(decoColor.r) && Number.isFinite(decoColor.g) && Number.isFinite(decoColor.b)) {
          const opacity = typeof decoColor.a === 'number' && Number.isFinite(decoColor.a) ? decoColor.a : 1
          a['decoration-color'] = rgbaToHex(decoColor, opacity)
        }
        const decoStyle = (node as any).textDecorationStyle
        if (decoStyle && typeof decoStyle === 'string' && decoStyle !== figma.mixed) {
          a['decoration-style'] = decoStyleVal(decoStyle)
        }
        const decoThick = (node as any).textDecorationThickness
        if (typeof decoThick === 'number' && decoThick !== figma.mixed) {
          a['decoration-thickness'] = decoThick > 0 ? decoThick : undefined
        }
      }

      a['text-case'] = (node.textCase as string) !== 'ORIGINAL' ? TEXT_CASE[node.textCase as string] : undefined
    }

    // text-resize: normalize the sizing mode for tooling
    a['text-resize'] = textResizeVal(node.textAutoResize)

    // List marker
    const nodeListOpts = (node as any).listOptions
    if (nodeListOpts && nodeListOpts !== figma.mixed && typeof nodeListOpts === 'object') {
      const lv = listTypeVal(nodeListOpts.type)
      if (lv) {
        a['list'] = lv
        if (typeof nodeListOpts.indentation === 'number' && nodeListOpts.indentation > 0) {
          a['list-level'] = nodeListOpts.indentation
        }
      }
    }

    const emptyPaints: readonly Paint[] = []
    const fillsForAppearance = textFillStyleName ? emptyPaints : node.fills
    const appearance = appearanceBlock(fillsForAppearance, node.effects, node.width, node.height, depth + 1, node)
    if (!appearance) return `${ind(depth)}<text ${attrs(a)} />`
    return `${ind(depth)}<text ${attrs(a)}>\n${appearance}\n${ind(depth)}</text>`
  }

  // Mixed-style text: output segments as children
  const segments = getTextSegments(node)

  // If segment extraction failed (plugin sandbox error), fall back to flat output
  // using node.characters and whatever non-mixed attrs are available.
  if (!segments.length) {
    a.value = node.characters
    if (node.fontName !== figma.mixed) {
      var fbFont = node.fontName as FontName
      a['font-family'] = fbFont.family
      a['font-postscript'] = fontPostscriptName(fbFont.family, fbFont.style)
      a['font-style-name'] = fbFont.style !== 'Regular' ? fbFont.style : undefined
      a['font-weight'] = fontWeight(fbFont.style)
      a['font-style'] = fontStyle(fbFont.style) === 'italic' ? 'italic' : undefined
      a['font-stretch'] = fontStretchVal(fbFont.style)
    }
    if (node.fontSize !== figma.mixed) a['font-size'] = node.fontSize as number
    if (node.lineHeight !== figma.mixed) a['line-height'] = lineHeightVal(node.lineHeight as LineHeight)
    if (node.letterSpacing !== figma.mixed) a['letter-spacing'] = letterSpacingVal(node.letterSpacing as LetterSpacing)
    if (node.fills !== figma.mixed) a.fill = solidFill(node.fills)
    a['text-resize'] = textResizeVal(node.textAutoResize)
    const appearance = appearanceBlock(node.fills !== figma.mixed ? node.fills : [], node.effects, node.width, node.height, depth + 1, node)
    if (!appearance) return ind(depth) + '<text ' + attrs(a) + ' />'
    return ind(depth) + '<text ' + attrs(a) + '>\n' + appearance + '\n' + ind(depth) + '</text>'
  }

  const segLines = segments.map(seg => {
    const segColor = solidFill(seg.fills)
    const segDecoRaw = seg.textDecoration ? (seg.textDecoration as string) : 'NONE'
    const segDeco = segDecoRaw !== 'NONE' ? segDecoRaw.toLowerCase() : undefined

    const sa: Record<string, AttrVal> = {
      value: seg.characters,
      'font-family': seg.fontName ? seg.fontName.family : undefined,
      'font-postscript': seg.fontName ? fontPostscriptName(seg.fontName.family, seg.fontName.style) : undefined,
      'font-style-name': (seg.fontName && seg.fontName.style !== 'Regular') ? seg.fontName.style : undefined,
      'font-size': seg.fontSize,
      'font-weight': seg.fontName ? fontWeight(seg.fontName.style) : undefined,
      'font-style': seg.fontName && fontStyle(seg.fontName.style) === 'italic' ? 'italic' : undefined,
      'font-stretch': seg.fontName ? fontStretchVal(seg.fontName.style) : undefined,
      'font-variation': (seg as any).fontVariations && typeof (seg as any).fontVariations === 'object'
        ? fontVariationVal((seg as any).fontVariations) : undefined,
      'font-feature': seg.openTypeFeatures && typeof seg.openTypeFeatures === 'object'
        ? fontFeatureVal(seg.openTypeFeatures) : undefined,
      'line-height': seg.lineHeight ? lineHeightVal(seg.lineHeight) : undefined,
      'letter-spacing': seg.letterSpacing ? letterSpacingVal(seg.letterSpacing) : undefined,
      'baseline-shift': typeof seg.baselineOffset === 'number' && seg.baselineOffset !== 0
        ? seg.baselineOffset : undefined,
      fill: segColor,
      decoration: segDeco,
      'decoration-color': (function() {
        var dc = (seg as any).textDecorationColor
        if (!segDeco || !dc || typeof dc !== 'object') return undefined
        if (!Number.isFinite(dc.r) || !Number.isFinite(dc.g) || !Number.isFinite(dc.b)) return undefined
        var opa = typeof dc.a === 'number' && Number.isFinite(dc.a) ? dc.a : 1
        return rgbaToHex(dc, opa)
      })(),
      'decoration-style': segDeco && (seg as any).textDecorationStyle
        ? decoStyleVal((seg as any).textDecorationStyle) : undefined,
      'decoration-thickness': segDeco && typeof (seg as any).textDecorationThickness === 'number' && (seg as any).textDecorationThickness > 0
        ? (seg as any).textDecorationThickness : undefined,
      'text-case': seg.textCase && (seg.textCase as string) !== 'ORIGINAL'
        ? TEXT_CASE[seg.textCase as string] : undefined,
      'list': seg.listOptions && seg.listOptions.type ? listTypeVal(seg.listOptions.type) : undefined,
      'list-level': seg.listOptions && typeof seg.indentation === 'number' && seg.indentation > 0
        ? seg.indentation : undefined,
      href: seg.hyperlink && seg.hyperlink.type === 'URL' ? seg.hyperlink.value : undefined,
    }
    return `${ind(depth + 1)}<segment ${attrs(sa)} />`
  })

  // text-resize at the <text> level (applies to whole node, not per-segment)
  a['text-resize'] = textResizeVal(node.textAutoResize)

  const appearance = appearanceBlock(node.fills, node.effects, node.width, node.height, depth + 1, node)
  const innerParts = [appearance, ...segLines].filter(Boolean)
  if (!innerParts.length) return `${ind(depth)}<text ${attrs(a)} />`
  return `${ind(depth)}<text ${attrs(a)}>\n${innerParts.join('\n')}\n${ind(depth)}</text>`
}

function imgToGui(node: RectangleNode, fill: ImagePaint, depth: number): string {
  const asset = _imageMap[fill.imageHash as string]
  const a: Record<string, AttrVal> = {
    id: componentBodyId(node.name),
    name: node.name,
    src: 'assets/' + asset.id + '.' + asset.format,
    x: Math.round(node.x),
    y: Math.round(node.y),
    w: Math.round(node.width),
    h: Math.round(node.height),
    fit: FIT_MODE[fill.scaleMode] || 'cover',
    radius: cornerRadius(node),
    'corner-smoothing': node.cornerSmoothing > 0 ? node.cornerSmoothing : undefined,
    opacity: node.opacity < 1 ? node.opacity : undefined,
    blend: blendModeAttr(node),
    mask: maskAttr(node),
    rotation: rotationAttr(node),
    flip: flipAttr(node),
    visible: visibleAttr(node),
  }
  Object.assign(a, strokeAttrs(node))
  Object.assign(a, constraintAttrs(node))
  Object.assign(a, sizingAttrs(node))
  Object.assign(a, layoutPositionAttrs(node))
  Object.assign(a, minMaxAttrs(node))
  Object.assign(a, debugAttrs(node))
  return `${ind(depth)}<img ${attrs(a)} />`
}

function rectToGui(node: RectangleNode, depth: number): string {
  const fillStyleIdRaw = (node as any).fillStyleId
  const fillStyleId = typeof fillStyleIdRaw === 'string' && fillStyleIdRaw ? fillStyleIdRaw : null
  const fillStyleName = fillStyleId ? resolveFillStyle(fillStyleId) : null
  const effectStyleIdRaw = (node as any).effectStyleId
  const effectStyleId = typeof effectStyleIdRaw === 'string' && effectStyleIdRaw ? effectStyleIdRaw : null
  const effectStyleName = effectStyleId ? resolveEffectStyle(effectStyleId) : null

  var rectVp = (node as any).vectorPaths
  var rectFillRule: string | undefined
  if (rectVp && rectVp.length > 0 && rectVp[0].windingRule) {
    rectFillRule = rectVp[0].windingRule === 'EVENODD' ? 'evenodd' : 'nonzero'
  }

  const a: Record<string, AttrVal> = {
    id: componentBodyId(node.name),
    name: node.name,
    x: Math.round(node.x),
    y: Math.round(node.y),
    w: Math.round(node.width),
    h: Math.round(node.height),
    fill: fillStyleName ? undefined : fillValue(node.fills, node.width, node.height),
    'fill-style': fillStyleName || undefined,
    radius: cornerRadius(node),
    'corner-smoothing': node.cornerSmoothing > 0 ? node.cornerSmoothing : undefined,
    opacity: node.opacity < 1 ? node.opacity : undefined,
    blend: blendModeAttr(node),
    mask: maskAttr(node),
    rotation: rotationAttr(node),
    flip: flipAttr(node),
    visible: visibleAttr(node),
    'fill-rule': rectFillRule,
    'effect-style': effectStyleName || undefined,
  }
  Object.assign(a, strokeAttrs(node))
  Object.assign(a, constraintAttrs(node))
  Object.assign(a, sizingAttrs(node))
  Object.assign(a, layoutPositionAttrs(node))
  Object.assign(a, minMaxAttrs(node))
  Object.assign(a, debugAttrs(node))
  const emptyPaints: readonly Paint[] = []
  const emptyEffects: readonly Effect[] = []
  const fillsForAppearance = fillStyleName ? emptyPaints : node.fills
  const effectsForAppearance = effectStyleName ? emptyEffects : node.effects
  const appearance = appearanceBlock(fillsForAppearance, effectsForAppearance, node.width, node.height, depth + 1, node)
  if (!appearance) return `${ind(depth)}<rect ${attrs(a)} />`
  return `${ind(depth)}<rect ${attrs(a)}>\n${appearance}\n${ind(depth)}</rect>`
}

function ellipseToGui(node: EllipseNode, depth: number): string {
  // Only called for full ellipses — arc/donut ellipses are routed to svgToGui()
  const fillStyleIdRaw = (node as any).fillStyleId
  const fillStyleId = typeof fillStyleIdRaw === 'string' && fillStyleIdRaw ? fillStyleIdRaw : null
  const fillStyleName = fillStyleId ? resolveFillStyle(fillStyleId) : null
  const effectStyleIdRaw = (node as any).effectStyleId
  const effectStyleId = typeof effectStyleIdRaw === 'string' && effectStyleIdRaw ? effectStyleIdRaw : null
  const effectStyleName = effectStyleId ? resolveEffectStyle(effectStyleId) : null

  var ellipseVp = (node as any).vectorPaths
  var ellipseFillRule: string | undefined
  if (ellipseVp && ellipseVp.length > 0 && ellipseVp[0].windingRule) {
    ellipseFillRule = ellipseVp[0].windingRule === 'EVENODD' ? 'evenodd' : 'nonzero'
  }

  const a: Record<string, AttrVal> = {
    id: componentBodyId(node.name),
    name: node.name,
    x: Math.round(node.x),
    y: Math.round(node.y),
    w: Math.round(node.width),
    h: Math.round(node.height),
    fill: fillStyleName ? undefined : fillValue(node.fills, node.width, node.height),
    'fill-style': fillStyleName || undefined,
    opacity: node.opacity < 1 ? node.opacity : undefined,
    blend: blendModeAttr(node),
    mask: maskAttr(node),
    rotation: rotationAttr(node),
    flip: flipAttr(node),
    visible: visibleAttr(node),
    'fill-rule': ellipseFillRule,
    'effect-style': effectStyleName || undefined,
  }
  Object.assign(a, strokeAttrs(node))
  Object.assign(a, constraintAttrs(node))
  Object.assign(a, sizingAttrs(node))
  Object.assign(a, layoutPositionAttrs(node))
  Object.assign(a, debugAttrs(node))
  const emptyPaints: readonly Paint[] = []
  const emptyEffects: readonly Effect[] = []
  const fillsForAppearance = fillStyleName ? emptyPaints : node.fills
  const effectsForAppearance = effectStyleName ? emptyEffects : node.effects
  const appearance = appearanceBlock(fillsForAppearance, effectsForAppearance, node.width, node.height, depth + 1, node)
  if (!appearance) return `${ind(depth)}<ellipse ${attrs(a)} />`
  return `${ind(depth)}<ellipse ${attrs(a)}>\n${appearance}\n${ind(depth)}</ellipse>`
}

function lineToGui(node: LineNode, depth: number): string {
  // Extract fill color and thickness directly — stroke IS the line
  let lineFill: string | undefined
  let thickness: number | undefined
  if (Array.isArray(node.strokes) && node.strokes.length > 0) {
    const f = (node.strokes as Paint[]).find(function(p) { return p.type === 'SOLID' && p.visible !== false }) as SolidPaint | undefined
    if (f) {
      const bv = (f as any).boundVariables
      lineFill = (bv && bv.color && bv.color.id && tokenRef(bv.color.id))
        || rgbToHex(f.color.r, f.color.g, f.color.b, f.opacity !== undefined ? f.opacity : 1)
    }
  }
  if (typeof node.strokeWeight === 'number' && node.strokeWeight !== 1) {
    thickness = node.strokeWeight
  }
  var lineCap = (node as any).strokeCap
  var lineCapVal = (lineCap && lineCap !== 'NONE' && lineCap !== figma.mixed) ? strokeCapVal(lineCap as string) : undefined
  var lineSj = (node as any).strokeJoin
  var lineSjVal = (lineSj && lineSj !== figma.mixed) ? strokeJoinVal(lineSj as string) : undefined
  var lineDash = (node as any).strokeDashPattern
  var lineDashArray = (lineDash && Array.isArray(lineDash) && lineDash.length > 0) ? lineDash.join(' ') : undefined
  var lineDashOffset = (node as any).strokeDashOffset
  var lineDashOffsetVal = (typeof lineDashOffset === 'number' && lineDashOffset !== 0) ? lineDashOffset : undefined
  const a: Record<string, AttrVal> = {
    id: componentBodyId(node.name),
    name: node.name,
    x: Math.round(node.x),
    y: Math.round(node.y),
    w: Math.round(node.width),
    fill: lineFill,
    thickness,
    'stroke-cap': lineCapVal,
    'stroke-join': lineSjVal,
    'dash-array': lineDashArray,
    'dash-offset': lineDashOffsetVal,
    opacity: node.opacity < 1 ? node.opacity : undefined,
    blend: blendModeAttr(node),
    mask: maskAttr(node),
    rotation: rotationAttr(node),
    flip: flipAttr(node),
    visible: visibleAttr(node),
  }
  Object.assign(a, constraintAttrs(node))
  Object.assign(a, sizingAttrs(node))
  Object.assign(a, layoutPositionAttrs(node))
  Object.assign(a, debugAttrs(node))
  return `${ind(depth)}<line ${attrs(a)} />`
}

function shiftRootPosition(markup: string, offsetX: number, offsetY: number): string {
  let shifted = false
  return markup.replace(/^(\s*<(?:frame|stack|row|col|grid|group|text|img|rect|ellipse|line|svg|shape)\b)([^>]*?)(\/?>)/m, function(
    _,
    start: string,
    attrText: string,
    end: string,
  ) {
    if (shifted) return start + attrText + end
    shifted = true
    const shiftedAttrs = shiftAttr(shiftAttr(attrText, 'x', offsetX), 'y', offsetY)
    const debug = _debugExport ? ' debug-rebased="true"' : ''
    return start + shiftedAttrs + debug + end
  })
}

function shiftAttr(attrText: string, attr: 'x' | 'y', delta: number): string {
  const pattern = new RegExp(`\\s${attr}="([^"]*)"`)
  const match = attrText.match(pattern)
  if (!match) return attrText

  const value = parseFloat(match[1])
  if (!Number.isFinite(value)) return attrText

  return attrText.replace(pattern, ` ${attr}="${Math.round(value - delta)}"`)
}

function normalizeWrappedRootPosition(markup: string): string {
  let isRoot = true
  return markup.replace(/^(\s*<(?:frame|stack|row|col|grid|group|text|img|rect|ellipse|line|svg|shape)\b)([^>]*?)(\/?>)/gm, function(
    _,
    start: string,
    attrText: string,
    end: string,
  ) {
    if (isRoot) {
      isRoot = false
      const withX = /\sx="[^"]*"/.test(attrText)
        ? attrText.replace(/\sx="[^"]*"/, ' x="0"')
        : attrText + ' x="0"'
      const withY = /\sy="[^"]*"/.test(withX)
        ? withX.replace(/\sy="[^"]*"/, ' y="0"')
        : withX + ' y="0"'
      return start + withY + end
    }

    return start + attrText + end
  })
}

async function generateGui(node: SceneNode): Promise<string> {
  const w = Math.round((node as FrameNode).width)
  const h = Math.round((node as FrameNode).height)

  // Collect component registrations before tree walk
  await prewalkComponents(node)

  var inner: string
  if (node.type === 'FRAME' || node.type === 'COMPONENT' || (node.type as string) === 'COMPONENT_SET') {
    inner = await frameToGui(node as FrameNode, 1)
  } else if (node.type === 'INSTANCE') {
    inner = await instanceToGui(node as InstanceNode, 1)
  } else {
    const wrapA = attrs({ w, h })
    const wrappedNode = normalizeWrappedRootPosition(await nodeToGui(node, 2))
    inner = `${ind(1)}<frame ${wrapA}>\n${wrappedNode}\n${ind(1)}</frame>`
  }

  const compBlock = await componentsBlock()

  return `<gui version="1.0" name="${xmlEscape(node.name)}">\n${tokensBlock()}${stylesBlock()}${fontsBlock(node)}${compBlock}${inner}\n</gui>`
}
