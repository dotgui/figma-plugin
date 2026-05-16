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
var _svgCounter = 0
var _debugExport = false

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
    expNode.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 1 } }),
    expNode.exportAsync({ format: 'SVG' }),
  ])

  const pngBytes = results[1] as Uint8Array
  const svgBytes = results[2] as Uint8Array
  const guiCode = await generateGui(node as SceneNode)

  const assetMap: Record<string, string> = {}
  const hks = Object.keys(_imageMap)
  for (let i = 0; i < hks.length; i++) {
    const a = _imageMap[hks[i]]
    assetMap['$' + a.id] = dataUrl(a)
  }
  const sks = Object.keys(_svgNodeMap)
  const seenSvgIds: Record<string, boolean> = {}
  for (let i = 0; i < sks.length; i++) {
    const a = _svgNodeMap[sks[i]]
    if (seenSvgIds[a.id]) continue
    seenSvgIds[a.id] = true
    assetMap['$' + a.id] = dataUrl(a)
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
  return rgbToHex(f.color.r, f.color.g, f.color.b, f.opacity !== undefined ? f.opacity : 1)
}

function visiblePaints(fills: readonly Paint[] | typeof figma.mixed): Paint[] {
  if (fills === figma.mixed || !Array.isArray(fills)) return []
  return (fills as Paint[]).filter(p => p.visible !== false)
}

function paintValue(p: Paint, nodeW: number, nodeH: number): string | null {
  if (p.type === 'SOLID') {
    const s = p as SolidPaint
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
      const angle = Math.round(Math.atan2(dx, -dy) * 180 / Math.PI)
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

  const width = nodeW / sx
  const height = nodeH / sy
  return {
    x: rounded(-width * t[0][2]),
    y: rounded(-height * t[1][2]),
    width: rounded(width),
    height: rounded(height),
  }
}

function appearanceFillLines(fills: readonly Paint[] | typeof figma.mixed, nodeW: number, nodeH: number, depth: number): string[] {
  const paints = visiblePaints(fills)
  if (paints.length <= 1 && (!paints[0] || paints[0].type !== 'IMAGE')) return []

  const fillLines: string[] = []
  for (let i = 0; i < paints.length; i++) {
    const p = paints[i]
    if (p.type === 'IMAGE') {
      const img = p as ImagePaint
      if (!img.imageHash || !_imageMap[img.imageHash]) continue
      const fillAttrs: Record<string, AttrVal> = {
        type: 'image',
        src: '$' + _imageMap[img.imageHash].id,
        fit: FIT_MODE[img.scaleMode] || 'cover',
        opacity: img.opacity !== undefined && img.opacity < 1 ? img.opacity : undefined,
      }
      Object.assign(fillAttrs, cropBoxAttrs(img, nodeW, nodeH))
      fillLines.push(`${ind(depth + 1)}<fill ${attrs({
        type: fillAttrs.type,
        src: fillAttrs.src,
        fit: fillAttrs.fit,
        opacity: fillAttrs.opacity,
        x: fillAttrs.x,
        y: fillAttrs.y,
        width: fillAttrs.width,
        height: fillAttrs.height,
      })} />`)
      continue
    }

    const value = paintValue(p, nodeW, nodeH)
    if (!value) continue
    fillLines.push(`${ind(depth + 1)}<fill ${attrs({
      type: p.type === 'SOLID' ? 'color' : (p.type === 'GRADIENT_LINEAR' ? 'linear-gradient' : p.type === 'GRADIENT_ANGULAR' ? 'angular-gradient' : 'radial-gradient'),
      value,
      opacity: p.opacity !== undefined && p.opacity < 1 ? p.opacity : undefined,
    })} />`)
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
      out.push(`${ind(depth + 1)}<effect ${attrs({
        type: effectType(e),
        x: e.offset.x,
        y: e.offset.y,
        radius: e.radius,
        spread: e.spread !== undefined ? e.spread : 0,
        color: rgbToHex(e.color.r, e.color.g, e.color.b, e.color.a),
        blend: e.blendMode && e.blendMode !== 'NORMAL' ? e.blendMode.toLowerCase() : undefined,
      })} />`)
    } else if ((e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR') && e.blurType === 'NORMAL') {
      out.push(`${ind(depth + 1)}<effect ${attrs({
        type: effectType(e),
        radius: e.radius,
      })} />`)
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
): string {
  const lines = appearanceFillLines(fills, nodeW, nodeH, depth)
    .concat(appearanceEffectLines(effects, depth))
  if (!lines.length) return ''
  return `${ind(depth)}<appearance>\n${lines.join('\n')}\n${ind(depth)}</appearance>`
}

function strokeAttrs(node: GeometryMixin): Record<string, string | number | null> {
  if (!Array.isArray(node.strokes) || node.strokes.length === 0) return {}
  const f = (node.strokes as Paint[]).find(p => p.type === 'SOLID' && p.visible !== false) as SolidPaint | undefined
  if (!f) return {}
  return {
    stroke: rgbToHex(f.color.r, f.color.g, f.color.b, f.opacity !== undefined ? f.opacity : 1),
    'stroke-width': typeof node.strokeWeight === 'number' ? node.strokeWeight : null,
    'stroke-position': node.strokeAlign ? node.strokeAlign.toLowerCase() : null,
  }
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

function constraintAttrs(node: SceneNode): Record<string, AttrVal> {
  if (!('constraints' in node)) return {}
  const c = (node as any).constraints as Constraints
  if (!c) return {}
  const h = c.horizontal !== 'LEFT' ? c.horizontal.toLowerCase() : undefined
  const v = c.vertical !== 'TOP' ? c.vertical.toLowerCase() : undefined
  return { 'constraint-h': h, 'constraint-v': v }
}

function sizingAttrs(node: SceneNode): Record<string, AttrVal> {
  const result: Record<string, AttrVal> = {}
  if ('layoutSizingHorizontal' in node) {
    const h = (node as FrameNode).layoutSizingHorizontal
    if (h === 'HUG' || h === 'FILL') result['sizing-h'] = h.toLowerCase()
  }
  if ('layoutSizingVertical' in node) {
    const v = (node as FrameNode).layoutSizingVertical
    if (v === 'HUG' || v === 'FILL') result['sizing-v'] = v.toLowerCase()
  }
  return result
}

function layoutPositionAttrs(node: SceneNode): Record<string, AttrVal> {
  if (!('layoutPositioning' in node)) return {}
  return (node as unknown as { layoutPositioning?: string }).layoutPositioning === 'ABSOLUTE'
    ? { 'layout-position': 'absolute' }
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
  return node.cornerRadius > 0 ? String(node.cornerRadius) : null
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
  _svgCounter = 0
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
    .map(([k, v]) => `${k}="${typeof v === 'string' ? xmlEscape(v) : v}"`)
    .join(' ')
}

function debugAttrs(node: SceneNode): Record<string, AttrVal> {
  if (!_debugExport) return {}
  const layout = node as LayoutMixin
  return {
    'debug-id': node.id,
    'debug-type': node.type,
    'debug-raw-x': typeof layout.x === 'number' ? Math.round(layout.x) : undefined,
    'debug-raw-y': typeof layout.y === 'number' ? Math.round(layout.y) : undefined,
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

function hasHardEffects(node: SceneNode): boolean {
  if (!('effects' in node) || !Array.isArray((node as BlendMixin).effects)) return false
  return visibleEffects((node as BlendMixin).effects).some(e =>
    e.type === 'NOISE'
    || e.type === 'TEXTURE'
    || e.type === 'GLASS'
    || ((e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR') && e.blurType === 'PROGRESSIVE')
  )
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

async function svgToGui(node: SceneNode, depth: number): Promise<string> {
  const asset = await svgAsset(node)
  if (!asset) return ''

  const baseAttrs: Record<string, AttrVal> = {
    name: node.name,
    src: '$' + asset.id,
    x: Math.round((node as LayoutMixin).x),
    y: Math.round((node as LayoutMixin).y),
    width: Math.round((node as LayoutMixin).width),
    height: Math.round((node as LayoutMixin).height),
    opacity: node.opacity < 1 ? node.opacity : undefined,
    blend: blendModeAttr(node),
    mask: maskAttr(node),
    rotation: rotationAttr(node),
  }
  Object.assign(baseAttrs, constraintAttrs(node))
  Object.assign(baseAttrs, sizingAttrs(node))
  Object.assign(baseAttrs, layoutPositionAttrs(node))
  Object.assign(baseAttrs, debugAttrs(node))
  return `${ind(depth)}<svg ${attrs(baseAttrs)} />`
}

async function nodeToGui(node: SceneNode, depth: number): Promise<string> {
  if (node.visible === false) return ''

  if (shouldExportAsSvg(node, depth)) {
    return svgToGui(node, depth)
  }

  switch (node.type) {
    case 'FRAME':
    case 'COMPONENT':
    case 'INSTANCE':
      return frameToGui(node as FrameNode, depth)
    case 'GROUP':
      return groupToGui(node as GroupNode, depth)
    case 'TEXT':
      return textToGui(node as TextNode, depth)
    case 'RECTANGLE':
      return rectToGui(node as RectangleNode, depth)
    case 'ELLIPSE':
      return ellipseToGui(node as EllipseNode, depth)
    case 'LINE':
      return lineToGui(node as LineNode, depth)
    case 'VECTOR':
    case 'STAR':
    case 'POLYGON':
    case 'BOOLEAN_OPERATION':
      return pathToGui(node as VectorNode, depth)
    default:
      if ('children' in node) {
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

async function positionedChildren(
  node: ChildrenMixin,
  depth: number,
  offsetX: number,
  offsetY: number,
): Promise<string> {
  const parts = await Promise.all(node.children.map(async c => {
    const markup = await nodeToGui(c, depth)
    return markup ? shiftRootPosition(markup, offsetX, offsetY) : ''
  }))
  return parts.filter(Boolean).join('\n')
}

async function frameToGui(node: FrameNode, depth: number): Promise<string> {
  const lm = node.layoutMode as string
  const isStack = lm !== 'NONE'
  const isGrid = lm === 'GRID'
  const tag = isStack ? 'stack' : 'frame'
  const isRoot = depth === 1

  const a: Record<string, AttrVal> = {
    name: node.name,
    width: Math.round(node.width),
    height: Math.round(node.height),
    fill: fillValue(node.fills, node.width, node.height),
    radius: cornerRadius(node),
    'corner-smoothing': node.cornerSmoothing > 0 ? node.cornerSmoothing : undefined,
    opacity: node.opacity < 1 ? node.opacity : undefined,
    blend: blendModeAttr(node),
    mask: maskAttr(node),
    rotation: !isRoot ? rotationAttr(node) : undefined,
    clip: node.clipsContent || undefined,
    shadow: visibleEffects(node.effects).length ? undefined : shadowAttr(node),
  }
  if (!isRoot) {
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
      a.direction = 'grid'
      const gn = node as any
      a['grid-columns'] = gn.gridColumnCount > 0 ? gn.gridColumnCount : undefined
      a['grid-rows'] = gn.gridRowCount > 0 ? gn.gridRowCount : undefined
      a['grid-col-gap'] = gn.gridColumnGap > 0 ? gn.gridColumnGap : undefined
      a['grid-row-gap'] = gn.gridRowGap > 0 ? gn.gridRowGap : undefined
    } else {
      a.direction = lm === 'HORIZONTAL' ? 'horizontal' : 'vertical'
      a.gap = node.itemSpacing !== 0 ? node.itemSpacing : undefined
      a['reverse-z'] = node.itemReverseZIndex || undefined
    }
    a.padding = padding(node)
    a.align = ALIGN[node.counterAxisAlignItems]
    a.justify = ALIGN[node.primaryAxisAlignItems]
    if (node.layoutWrap === 'WRAP') {
      a.wrap = true
      if (node.counterAxisAlignContent === 'SPACE_BETWEEN') a['wrap-align'] = 'space-between'
      if (node.counterAxisSpacing != null && node.counterAxisSpacing > 0) a['wrap-gap'] = node.counterAxisSpacing
    }
  }

  const appearance = appearanceBlock(node.fills, node.effects, node.width, node.height, depth + 1)
  const childInner = await children(node, depth + 1)
  const inner = [appearance, childInner].filter(Boolean).join('\n')
  if (!inner) return `${ind(depth)}<${tag} ${attrs(a)} />`
  return `${ind(depth)}<${tag} ${attrs(a)}>\n${inner}\n${ind(depth)}</${tag}>`
}

async function groupToGui(node: GroupNode, depth: number): Promise<string> {
  const a: Record<string, AttrVal> = {
    name: node.name,
    x: Math.round(node.x),
    y: Math.round(node.y),
    width: Math.round(node.width),
    height: Math.round(node.height),
    opacity: node.opacity < 1 ? node.opacity : undefined,
    blend: blendModeAttr(node),
    mask: maskAttr(node),
    rotation: rotationAttr(node),
  }
  Object.assign(a, constraintAttrs(node))
  Object.assign(a, sizingAttrs(node))
  Object.assign(a, layoutPositionAttrs(node))
  Object.assign(a, minMaxAttrs(node))
  Object.assign(a, debugAttrs(node))
  const inner = await positionedChildren(node, depth + 1, node.x || 0, node.y || 0)
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
}

function getTextSegments(node: TextNode): TextSegment[] {
  try {
    const fn = (node as any).getStyledTextSegments
    if (typeof fn !== 'function') return []
    return fn.call(node, ['fontName', 'fontSize', 'fills', 'textDecoration', 'textCase', 'letterSpacing', 'lineHeight', 'hyperlink'])
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
}

function textToGui(node: TextNode, depth: number): string {
  const vAlign: Record<string, string> = { TOP: 'top', CENTER: 'center', BOTTOM: 'bottom' }
  const autoResize = node.textAutoResize
  const hugW = autoResize === 'WIDTH_AND_HEIGHT'
  const hugH = autoResize === 'WIDTH_AND_HEIGHT' || autoResize === 'HEIGHT'
  const isTruncated = autoResize === 'TRUNCATE'

  const mixed = isMixedText(node)

  const a: Record<string, AttrVal> = {
    name: node.name,
    x: Math.round(node.x),
    y: Math.round(node.y),
    width: hugW ? 'hug' : Math.round(node.width),
    height: hugH ? 'hug' : Math.round(node.height),
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
    a.value = node.characters
    a['font-family'] = fontName.family
    a['font-size'] = node.fontSize as number
    a['font-weight'] = fontWeight(fontName.style)
    a['font-style'] = fontStyle(fontName.style) === 'italic' ? 'italic' : undefined
    a['line-height'] = lineHeightVal(lh)
    a['letter-spacing'] = letterSpacingVal(ls)
    a.color = solidFill(node.fills)
    a.decoration = (node.textDecoration as string) !== 'NONE' ? (node.textDecoration as string).toLowerCase() : undefined
    a['text-case'] = (node.textCase as string) !== 'ORIGINAL' ? TEXT_CASE[node.textCase as string] : undefined
    if (node.hyperlink !== figma.mixed && node.hyperlink !== null) {
      const hl = node.hyperlink as HyperlinkTarget
      if (hl.type === 'URL') a.href = hl.value
    }
    const appearance = appearanceBlock(node.fills, node.effects, node.width, node.height, depth + 1)
    if (!appearance) return `${ind(depth)}<text ${attrs(a)} />`
    return `${ind(depth)}<text ${attrs(a)}>\n${appearance}\n${ind(depth)}</text>`
  }

  // Mixed-style text: output segments as children
  const segments = getTextSegments(node)
  const segLines = segments.map(seg => {
    const segColor = solidFill(seg.fills)
    const sa: Record<string, AttrVal> = {
      value: seg.characters,
      'font-family': seg.fontName ? seg.fontName.family : undefined,
      'font-size': seg.fontSize,
      'font-weight': seg.fontName ? fontWeight(seg.fontName.style) : undefined,
      'font-style': seg.fontName && fontStyle(seg.fontName.style) === 'italic' ? 'italic' : undefined,
      'line-height': seg.lineHeight ? lineHeightVal(seg.lineHeight) : undefined,
      'letter-spacing': seg.letterSpacing ? letterSpacingVal(seg.letterSpacing) : undefined,
      color: segColor,
      decoration: seg.textDecoration && (seg.textDecoration as string) !== 'NONE'
        ? (seg.textDecoration as string).toLowerCase() : undefined,
      'text-case': seg.textCase && (seg.textCase as string) !== 'ORIGINAL'
        ? TEXT_CASE[seg.textCase as string] : undefined,
      href: seg.hyperlink && seg.hyperlink.type === 'URL' ? seg.hyperlink.value : undefined,
    }
    return `${ind(depth + 1)}<segment ${attrs(sa)} />`
  })

  const appearance = appearanceBlock(node.fills, node.effects, node.width, node.height, depth + 1)
  const innerParts = [appearance, ...segLines].filter(Boolean)
  if (!innerParts.length) return `${ind(depth)}<text ${attrs(a)} />`
  return `${ind(depth)}<text ${attrs(a)}>\n${innerParts.join('\n')}\n${ind(depth)}</text>`
}

function imgToGui(node: RectangleNode, fill: ImagePaint, depth: number): string {
  const asset = _imageMap[fill.imageHash as string]
  const a: Record<string, AttrVal> = {
    name: node.name,
    src: '$' + asset.id,
    x: Math.round(node.x),
    y: Math.round(node.y),
    width: Math.round(node.width),
    height: Math.round(node.height),
    fit: FIT_MODE[fill.scaleMode] || 'cover',
    radius: cornerRadius(node),
    'corner-smoothing': node.cornerSmoothing > 0 ? node.cornerSmoothing : undefined,
    opacity: node.opacity < 1 ? node.opacity : undefined,
    blend: blendModeAttr(node),
    mask: maskAttr(node),
    rotation: rotationAttr(node),
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
  const a: Record<string, AttrVal> = {
    type: 'rect',
    name: node.name,
    x: Math.round(node.x),
    y: Math.round(node.y),
    width: Math.round(node.width),
    height: Math.round(node.height),
    fill: fillValue(node.fills, node.width, node.height),
    radius: cornerRadius(node),
    'corner-smoothing': node.cornerSmoothing > 0 ? node.cornerSmoothing : undefined,
    opacity: node.opacity < 1 ? node.opacity : undefined,
    blend: blendModeAttr(node),
    mask: maskAttr(node),
    rotation: rotationAttr(node),
  }
  Object.assign(a, strokeAttrs(node))
  Object.assign(a, constraintAttrs(node))
  Object.assign(a, sizingAttrs(node))
  Object.assign(a, layoutPositionAttrs(node))
  Object.assign(a, minMaxAttrs(node))
  Object.assign(a, debugAttrs(node))
  const appearance = appearanceBlock(node.fills, node.effects, node.width, node.height, depth + 1)
  if (!appearance) return `${ind(depth)}<shape ${attrs(a)} />`
  return `${ind(depth)}<shape ${attrs(a)}>\n${appearance}\n${ind(depth)}</shape>`
}

function ellipseToGui(node: EllipseNode, depth: number): string {
  const arc = node.arcData
  const TWO_PI = Math.PI * 2
  const a: Record<string, AttrVal> = {
    type: 'ellipse',
    name: node.name,
    x: Math.round(node.x),
    y: Math.round(node.y),
    width: Math.round(node.width),
    height: Math.round(node.height),
    fill: fillValue(node.fills, node.width, node.height),
    'arc-start': arc && Math.abs(arc.startingAngle) > 0.001
      ? Math.round(arc.startingAngle * 180 / Math.PI * 100) / 100 : undefined,
    'arc-end': arc && Math.abs(arc.endingAngle - TWO_PI) > 0.001
      ? Math.round(arc.endingAngle * 180 / Math.PI * 100) / 100 : undefined,
    'arc-inner': arc && arc.innerRadius > 0 ? arc.innerRadius : undefined,
    opacity: node.opacity < 1 ? node.opacity : undefined,
    blend: blendModeAttr(node),
    mask: maskAttr(node),
    rotation: rotationAttr(node),
  }
  Object.assign(a, strokeAttrs(node))
  Object.assign(a, constraintAttrs(node))
  Object.assign(a, sizingAttrs(node))
  Object.assign(a, layoutPositionAttrs(node))
  Object.assign(a, debugAttrs(node))
  const appearance = appearanceBlock(node.fills, node.effects, node.width, node.height, depth + 1)
  if (!appearance) return `${ind(depth)}<shape ${attrs(a)} />`
  return `${ind(depth)}<shape ${attrs(a)}>\n${appearance}\n${ind(depth)}</shape>`
}

function lineToGui(node: LineNode, depth: number): string {
  const cap = node.strokeCap !== figma.mixed && (node.strokeCap as string) !== 'NONE'
    ? (node.strokeCap as string).toLowerCase().replace(/_/g, '-') : undefined
  const a: Record<string, AttrVal> = {
    type: 'line',
    name: node.name,
    x: Math.round(node.x),
    y: Math.round(node.y),
    width: Math.round(node.width),
    'stroke-cap': cap,
    opacity: node.opacity < 1 ? node.opacity : undefined,
    blend: blendModeAttr(node),
    mask: maskAttr(node),
    rotation: rotationAttr(node),
  }
  Object.assign(a, strokeAttrs(node))
  Object.assign(a, constraintAttrs(node))
  Object.assign(a, sizingAttrs(node))
  Object.assign(a, layoutPositionAttrs(node))
  Object.assign(a, debugAttrs(node))
  return `${ind(depth)}<shape ${attrs(a)} />`
}

function pathToGui(node: VectorNode, depth: number): string {
  const geom = node as unknown as { fillGeometry?: ReadonlyArray<{ data: string }> }
  // BOOLEAN_OPERATION nodes don't have vectorPaths — fall back to fillGeometry
  const paths = (node.vectorPaths && node.vectorPaths.length > 0)
    ? node.vectorPaths
    : (geom.fillGeometry || [])
  const d = paths.map(function(p) { return p.data }).join(' ').trim()
  const a: Record<string, AttrVal> = {
    type: 'path',
    name: node.name,
    x: Math.round(node.x),
    y: Math.round(node.y),
    width: Math.round(node.width),
    height: Math.round(node.height),
    fill: fillValue(node.fills, node.width, node.height),
    opacity: node.opacity < 1 ? node.opacity : undefined,
    blend: blendModeAttr(node),
    mask: maskAttr(node),
    rotation: rotationAttr(node),
  }
  Object.assign(a, strokeAttrs(node))
  Object.assign(a, constraintAttrs(node))
  Object.assign(a, sizingAttrs(node))
  Object.assign(a, layoutPositionAttrs(node))
  Object.assign(a, debugAttrs(node))
  if (!d) return `${ind(depth)}<shape ${attrs(a)} />`
  return `${ind(depth)}<shape ${attrs(a)}>\n${ind(depth + 1)}<path d="${d}" />\n${ind(depth)}</shape>`
}

function shiftRootPosition(markup: string, offsetX: number, offsetY: number): string {
  let shifted = false
  return markup.replace(/^(\s*<(?:frame|stack|group|text|img|svg|shape)\b)([^>]*?)(\/?>)/m, function(
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
  return markup.replace(/^(\s*<(?:frame|stack|group|text|img|svg|shape)\b)([^>]*?)(\/?>)/gm, function(
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
  const viewport = `${w}x${h}`

  var inner: string
  if (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') {
    inner = await frameToGui(node as FrameNode, 1)
  } else {
    const wrapA = attrs({ width: w, height: h })
    const wrappedNode = normalizeWrappedRootPosition(await nodeToGui(node, 2))
    inner = `${ind(1)}<frame ${wrapA}>\n${wrappedNode}\n${ind(1)}</frame>`
  }

  const assetKeys = Object.keys(_imageMap)
  const lines = assetKeys.map(function(hash) {
    const a = _imageMap[hash]
    return `${ind(1)}<image id="${a.id}" format="${a.format}" src="base64:${a.b64}" />`
  })

  const svgKeys = Object.keys(_svgNodeMap)
  const seenSvgIds: Record<string, boolean> = {}
  for (let i = 0; i < svgKeys.length; i++) {
    const a = _svgNodeMap[svgKeys[i]]
    if (seenSvgIds[a.id]) continue
    seenSvgIds[a.id] = true
    lines.push(`${ind(1)}<image id="${a.id}" format="svg" src="base64:${a.b64}" />`)
  }

  const assetsBlock = lines.length > 0
    ? `${ind(0)}<assets>\n${lines.join('\n')}\n${ind(0)}</assets>\n`
    : ''

  return `<gui version="1.0" name="${xmlEscape(node.name)}" viewport="${viewport}">\n${fontsBlock(node)}${assetsBlock}${inner}\n</gui>`
}
