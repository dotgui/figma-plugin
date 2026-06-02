// .gui -> Figma import
// No ?. or ?? — Figma plugin sandbox restriction

interface ImportNode {
  type: string
  children?: ImportNode[]
  svgContent?: string
  appearance?: { fills: ImportFill[]; effects: ImportEffect[]; borders: ImportBorder[] }
  [key: string]: unknown
}
interface ImportFill  { type: string; value?: string; src?: string; fit?: string; opacity?: number; visible?: boolean }
interface ImportEffect { type: string; x?: number; y?: number; radius?: number; spread?: number; color?: string; opacity?: number; visible?: boolean }
interface ImportBorder { color?: string; w?: number; align?: string; style?: string; visible?: boolean }
interface ImportParsedGUI {
  root: ImportNode | null
  assets: Record<string, string>
  fonts: Record<string, { source?: string; weights?: string; styles?: string }>
  name?: string | null
  components?: Record<string, { id: string; props: unknown[]; body: ImportNode | null; variants?: Array<{ attrs: Record<string, string>; body: ImportNode | null }> }>
}

// Module-level component registry populated before the node walk
var _compRegistry: Record<string, { body: ImportNode | null }> = {}

// ---------------------------------------------------------------------------
// Attribute helpers
// ---------------------------------------------------------------------------

function numAttr(node: ImportNode, key: string, fallback: number): number {
  var v = node[key]
  if (typeof v === 'number') return v
  if (typeof v === 'string') { var p = parseFloat(v); if (!isNaN(p)) return p }
  return fallback
}

function strAttr(node: ImportNode, key: string, fallback: string): string {
  var v = node[key]; return typeof v === 'string' ? v : fallback
}

function boolAttr(node: ImportNode, key: string): boolean {
  return node[key] === true || node[key] === 'true'
}

function zIndexOf(node: ImportNode): number {
  var v = node['z-index']
  if (typeof v === 'number') return v
  if (typeof v === 'string') { var p = parseFloat(v); if (!isNaN(p)) return p }
  return 0
}

// Resolve w/h: returns pixel value, or null if 'fill'/'hug'/absent
function resolveSize(node: ImportNode, key: string, parentSize: number): number {
  var v = node[key]
  if (v === 'fill') return parentSize
  if (v === 'hug' || v === undefined || v === null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'string') { var p = parseFloat(v); if (!isNaN(p)) return p }
  return 0
}

function isKeyword(node: ImportNode, key: string): boolean {
  var v = node[key]
  return v === 'fill' || v === 'hug' || v === undefined || v === null
}

function isHugSize(node: ImportNode, key: string): boolean {
  var v = node[key]
  return v === 'hug' || v === undefined || v === null
}

// ---------------------------------------------------------------------------
// Padding — export writes `p` shorthand or pt/pr/pb/pl
// ---------------------------------------------------------------------------

function parsePadding(node: ImportNode): { top: number; right: number; bottom: number; left: number } {
  var pt = node['pt'], pr = node['pr'], pb = node['pb'], pl = node['pl']
  if (pt !== undefined || pr !== undefined || pb !== undefined || pl !== undefined) {
    return {
      top:    typeof pt === 'number' ? pt : 0,
      right:  typeof pr === 'number' ? pr : 0,
      bottom: typeof pb === 'number' ? pb : 0,
      left:   typeof pl === 'number' ? pl : 0,
    }
  }
  var p = node['p']
  if (typeof p === 'string' && p.trim()) {
    var parts = p.trim().split(/\s+/).map(Number).filter(function(x) { return !isNaN(x) })
    if (parts.length === 1) return { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] }
    if (parts.length === 2) return { top: parts[0], right: parts[1], bottom: parts[0], left: parts[1] }
    if (parts.length === 3) return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[1] }
    if (parts.length >= 4) return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] }
  }
  if (typeof p === 'number') return { top: p, right: p, bottom: p, left: p }
  return { top: 0, right: 0, bottom: 0, left: 0 }
}

// ---------------------------------------------------------------------------
// Nine-point alignment — reverse of ninePointAlign() from code.ts
// Format: "{vert}-{horiz}"  vert ∈ {top,middle,bottom}  horiz ∈ {left,center,right}
// ---------------------------------------------------------------------------

function decodeAlign(
  alignStr: string,
  layoutMode: 'HORIZONTAL' | 'VERTICAL',
  gapIsAuto: boolean,
): { primary: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN'; counter: 'MIN' | 'CENTER' | 'MAX' | 'BASELINE' } {
  if (alignStr === 'baseline') return { primary: 'MIN', counter: 'BASELINE' }
  var parts = alignStr.split('-')
  var vert  = parts[0] || 'top'
  var horiz = parts[1] || 'left'
  var vertMap:  Record<string, 'MIN' | 'CENTER' | 'MAX'> = { top: 'MIN', middle: 'CENTER', bottom: 'MAX' }
  var horizMap: Record<string, 'MIN' | 'CENTER' | 'MAX'> = { left: 'MIN', center: 'CENTER', right: 'MAX' }
  var vf = vertMap[vert]   || 'MIN'
  var hf = horizMap[horiz] || 'MIN'
  if (layoutMode === 'HORIZONTAL') {
    return { primary: gapIsAuto ? 'SPACE_BETWEEN' : hf, counter: vf }
  } else {
    return { primary: gapIsAuto ? 'SPACE_BETWEEN' : vf, counter: hf }
  }
}

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------

function hexToRGB(hex: string): { r: number; g: number; b: number; a: number } {
  var clean = hex.replace('#', '')
  if (clean.length === 3) clean = clean[0]+clean[0]+clean[1]+clean[1]+clean[2]+clean[2]
  var r = parseInt(clean.slice(0,2),16)/255, g = parseInt(clean.slice(2,4),16)/255
  var b = parseInt(clean.slice(4,6),16)/255, a = clean.length>=8 ? parseInt(clean.slice(6,8),16)/255 : 1
  if (isNaN(r)) r=0; if (isNaN(g)) g=0; if (isNaN(b)) b=0; if (isNaN(a)) a=1
  return { r: r, g: g, b: b, a: a }
}

// Accepts "#rgb"/"#rrggbb"/"#rrggbbaa", "rgb(r,g,b)" and "rgba(r,g,b,a)".
function parseColor(str: string): { r: number; g: number; b: number; a: number } {
  if (!str) return { r: 0, g: 0, b: 0, a: 1 }
  var s = str.trim()
  if (s.charAt(0) === '#') return hexToRGB(s)
  if (s.indexOf('rgb') === 0) {
    var m = s.match(/rgba?\(([^)]+)\)/)
    if (m) {
      var p = m[1].split(/[,\/\s]+/).filter(function(x){ return x !== '' }).map(function(x){ return parseFloat(x) })
      var r = (isNaN(p[0]) ? 0 : p[0]) / 255
      var g = (isNaN(p[1]) ? 0 : p[1]) / 255
      var b = (isNaN(p[2]) ? 0 : p[2]) / 255
      var a = p.length >= 4 && !isNaN(p[3]) ? p[3] : 1
      return { r: r, g: g, b: b, a: a }
    }
  }
  return { r: 0, g: 0, b: 0, a: 1 }
}

// True for any color literal we can parse (hex or rgb/rgba).
function isColorStr(s: string): boolean {
  if (!s) return false
  return s.charAt(0) === '#' || s.indexOf('rgb') === 0
}

function solidPaint(hex: string, alpha?: number): SolidPaint {
  var c = parseColor(hex)
  return { type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: alpha !== undefined ? alpha : c.a }
}

// ---------------------------------------------------------------------------
// Base64
// ---------------------------------------------------------------------------

function base64ToBytes(b64: string): Uint8Array {
  var bin = atob(b64), out = new Uint8Array(bin.length)
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// .gui `fit` (object-fit) → Figma image scaleMode
function imageScaleMode(fit: string): 'FILL' | 'FIT' | 'CROP' | 'TILE' {
  if (fit === 'contain') return 'FIT'
  if (fit === 'tile' || fit === 'repeat') return 'TILE'
  if (fit === 'crop') return 'CROP'
  return 'FILL'
}

function clampUnit(n: number): number { return n < -1 ? -1 : n > 1 ? 1 : n }

// Build Figma ImageFilters from explicit filter-* attrs and/or CSS filter() funcs.
// CSS brightness/contrast/saturate use 1 as neutral; Figma uses 0 (range -1..1).
function imageFiltersFrom(src: any): any {
  var out: any = {}
  var has = false
  function setF(k: string, v: any) { if (typeof v === 'number') { out[k] = v; has = true } }
  setF('exposure', src['filter-exposure'])
  setF('contrast', src['filter-contrast'])
  setF('saturation', src['filter-saturation'])
  setF('temperature', src['filter-temperature'])
  setF('tint', src['filter-tint'])
  setF('highlights', src['filter-highlights'])
  setF('shadows', src['filter-shadows'])
  var fstr = typeof src['filter'] === 'string' ? src['filter'] as string : ''
  if (fstr) {
    var bM = fstr.match(/brightness\(\s*([\d.]+)\s*\)/)
    if (bM) { out.exposure = clampUnit(parseFloat(bM[1]) - 1); has = true }
    var cM = fstr.match(/contrast\(\s*([\d.]+)\s*\)/)
    if (cM) { out.contrast = clampUnit(parseFloat(cM[1]) - 1); has = true }
    var sM = fstr.match(/saturate\(\s*([\d.]+)\s*\)/)
    if (sM) { out.saturation = clampUnit(parseFloat(sM[1]) - 1); has = true }
  }
  return has ? out : null
}

function dataUriToImage(uri: string): Image | null {
  var comma = uri.indexOf(',')
  if (comma === -1) return null
  try { return figma.createImage(base64ToBytes(uri.slice(comma + 1))) } catch (e) { return null }
}

// For SVG data URIs — returns SVG string
function svgDataUriToString(uri: string): string {
  if (uri.indexOf('image/svg') === -1) return ''
  var comma = uri.indexOf(',')
  if (comma === -1) return ''
  try {
    return uri.indexOf('base64') !== -1 ? atob(uri.slice(comma+1)) : decodeURIComponent(uri.slice(comma+1))
  } catch (e) { return '' }
}

// ---------------------------------------------------------------------------
// Font loading
// ---------------------------------------------------------------------------

function weightToStyle(w: number, italic: boolean): string {
  var name = w<=100?'Thin':w<=200?'ExtraLight':w<=300?'Light':w<=400?'Regular':w<=500?'Medium':w<=600?'SemiBold':w<=700?'Bold':w<=800?'ExtraBold':'Black'
  if (italic && name==='Regular') return 'Italic'
  if (italic) return name+' Italic'
  return name
}

async function tryLoad(family: string, style: string): Promise<boolean> {
  try { await figma.loadFontAsync({ family: family, style: style }); return true } catch(e){ return false }
}

async function preloadFonts(fonts: Record<string, { source?: string; weights?: string; styles?: string }>): Promise<void> {
  await tryLoad('Inter', 'Regular')
  var fams = Object.keys(fonts)
  for (var i = 0; i < fams.length; i++) {
    var fam = fams[i], info = fonts[fam]
    // weights are SPACE-separated (e.g. "400 500 600 700")
    var ws = ((info && info.weights) || '400').trim().split(/[\s,]+/)
    var ss = ((info && info.styles)  || 'normal').trim().split(/[\s,]+/)
    for (var j = 0; j < ws.length; j++) {
      var w = parseInt(ws[j], 10) || 400
      for (var k = 0; k < ss.length; k++) {
        var style = weightToStyle(w, ss[k]==='italic')
        await tryLoad(fam, style)
        if (style==='SemiBold')   await tryLoad(fam,'Semi Bold')
        if (style==='ExtraLight') await tryLoad(fam,'Extra Light')
        if (style==='ExtraBold')  await tryLoad(fam,'Extra Bold')
      }
    }
  }
}

async function resolveFont(family: string, weight: number, italic: boolean): Promise<FontName> {
  var style = weightToStyle(weight, italic)
  var alts = [style]
  if (style==='SemiBold')   alts.push('Semi Bold')
  if (style==='ExtraLight') alts.push('Extra Light')
  if (style==='ExtraBold')  alts.push('Extra Bold')
  for (var i = 0; i < alts.length; i++) {
    if (await tryLoad(family, alts[i])) return { family: family, style: alts[i] }
  }
  return { family: 'Inter', style: 'Regular' }
}

// ---------------------------------------------------------------------------
// Fills / effects / strokes
// ---------------------------------------------------------------------------

// Parse a CSS gradient string into a Figma GradientPaint, or null if unsupported.
// Handles linear / radial / angular(conic) gradients with explicit "color pos%" stops.
function parseGradientPaint(css: string, nodeW: number, nodeH: number): GradientPaint | null {
  var lower = css.toLowerCase()
  var isRadial = lower.indexOf('radial-gradient') !== -1
  var isConic = lower.indexOf('conic-gradient') !== -1 || lower.indexOf('angular') !== -1
  var stops: ColorStop[] = []
  // Extract stops from "color pos%" pairs inside the gradient
  var inner = css.replace(/^[^(]+\(/, '').replace(/\)\s*$/, '')
  // For linear/conic: first token may be "Ndeg" / "from Ndeg" / "to ..."
  var parts = inner.split(',')
  var first = parts[0] ? parts[0].trim() : ''
  var angleMatch = first.match(/(-?[\d.]+)deg/)
  var hasDirective = angleMatch || first.indexOf('to ') === 0 || first.indexOf('at ') === 0 || first.indexOf('circle') !== -1 || first.indexOf('ellipse') !== -1 || first.indexOf('from ') === 0
  var angleDeg = angleMatch ? parseFloat(angleMatch[1]) : 180
  var stopParts = hasDirective ? parts.slice(1) : parts
  for (var i = 0; i < stopParts.length; i++) {
    var sp = stopParts[i].trim()
    var colorMatch = sp.match(/(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))\s+([\d.]+)%/)
    if (!colorMatch) {
      // stop without explicit position — distribute evenly
      var colorOnly = sp.match(/^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))$/)
      if (!colorOnly) continue
      var co = parseColor(colorOnly[1])
      stops.push({ color: { r: co.r, g: co.g, b: co.b, a: co.a }, position: -1 })
      continue
    }
    var c = parseColor(colorMatch[1])
    stops.push({ color: { r: c.r, g: c.g, b: c.b, a: c.a }, position: parseFloat(colorMatch[2]) / 100 })
  }
  if (stops.length < 2) return null
  // Fill in any unpositioned stops evenly across [0,1]
  for (var k = 0; k < stops.length; k++) {
    if (stops[k].position < 0) stops[k] = { color: stops[k].color, position: k / (stops.length - 1) }
  }
  if (isRadial) {
    return {
      type: 'GRADIENT_RADIAL',
      gradientStops: stops,
      gradientTransform: [[0.5, 0, 0.25], [0, 0.5, 0.25]],
    } as GradientPaint
  }
  if (isConic) {
    var crad = (angleDeg - 90) * Math.PI / 180
    var ccos = Math.cos(crad), csin = Math.sin(crad)
    return {
      type: 'GRADIENT_ANGULAR',
      gradientStops: stops,
      gradientTransform: [
        [ccos, -csin, 0.5 - ccos * 0.5 + csin * 0.5],
        [csin,  ccos, 0.5 - csin * 0.5 - ccos * 0.5],
      ],
    } as GradientPaint
  }
  var rad = angleDeg * Math.PI / 180
  var cos = Math.cos(rad), sin = Math.sin(rad)
  var hw = nodeW > 0 ? 1 / nodeW : 1, hh = nodeH > 0 ? 1 / nodeH : 1
  return {
    type: 'GRADIENT_LINEAR',
    gradientStops: stops,
    gradientTransform: [
      [cos * hw, -sin * hh, 0.5 - cos * hw * 0.5 + sin * hh * 0.5],
      [sin * hw,  cos * hh, 0.5 - sin * hw * 0.5 - cos * hh * 0.5],
    ],
  } as GradientPaint
}

function applyFills(target: GeometryMixin, node: ImportNode, nodeW?: number, nodeH?: number): void {
  var w = nodeW || 0, h = nodeH || 0
  // Appearance block first
  var app = node.appearance
  if (app && app.fills && app.fills.length > 0) {
    var paints: Paint[] = []
    for (var i = 0; i < app.fills.length; i++) {
      var f = app.fills[i]
      if (f.visible === false) continue
      if (f.type === 'color' && f.value && isColorStr(f.value)) {
        paints.push(solidPaint(f.value, f.opacity))
      } else if ((f.type === 'linear-gradient' || f.type === 'radial-gradient' || f.type === 'angular-gradient') && f.value) {
        var gp = parseGradientPaint(f.value, w, h)
        if (gp) paints.push(gp)
      } else if (f.type === 'image' && f.src && f.src.startsWith('data:')) {
        var img = dataUriToImage(f.src)
        if (img) {
          var imgPaint: any = { type: 'IMAGE', imageHash: img.hash, scaleMode: imageScaleMode(f.fit || 'cover') }
          var ff = imageFiltersFrom(f)
          if (ff) imgPaint.filters = ff
          paints.push(imgPaint)
        }
      }
    }
    if (paints.length) { target.fills = paints; return }
  }
  // Top-level fill attr
  var fill = strAttr(node, 'fill', '')
  if (!fill || fill === 'none') { target.fills = []; return }
  if (isColorStr(fill)) { target.fills = [solidPaint(fill)]; return }
  if (fill.indexOf('gradient') !== -1) {
    var gp2 = parseGradientPaint(fill, w, h)
    if (gp2) { target.fills = [gp2]; return }
  }
  // Data URI fill
  if (fill.startsWith('data:')) {
    var img2 = dataUriToImage(fill)
    if (img2) { target.fills = [{ type: 'IMAGE', imageHash: img2.hash, scaleMode: 'FILL' }]; return }
  }
  target.fills = []
}

function applyEffects(target: BlendMixin, node: ImportNode): void {
  var effects: Effect[] = []

  // shadow shorthand: "x y radius spread color"  (exported by code.ts as shadowAttr)
  var shadowStr = strAttr(node, 'shadow', '')
  if (shadowStr) {
    var sp = shadowStr.trim().split(/\s+/)
    if (sp.length >= 5) {
      var sx = parseFloat(sp[0]) || 0
      var sy = parseFloat(sp[1]) || 0
      var sRad = parseFloat(sp[2]) || 0
      var sSpread = parseFloat(sp[3]) || 0
      var sc = parseColor(sp[4])
      effects.push({
        type: 'DROP_SHADOW',
        color: { r: sc.r, g: sc.g, b: sc.b, a: sc.a },
        offset: { x: sx, y: sy },
        radius: sRad,
        spread: sSpread,
        visible: true,
        blendMode: 'NORMAL',
      } as DropShadowEffect)
    }
  }

  // appearance effects block
  var app = node.appearance
  if (app && app.effects && app.effects.length) {
    for (var i = 0; i < app.effects.length; i++) {
      var ef = app.effects[i]
      if (ef.visible === false) continue
      var c = parseColor(ef.color || '#000000')
      if (ef.type === 'drop-shadow' || ef.type === 'inner-shadow') {
        effects.push({ type: ef.type==='drop-shadow'?'DROP_SHADOW':'INNER_SHADOW',
          color: { r:c.r, g:c.g, b:c.b, a: ef.opacity!==undefined ? ef.opacity : c.a },
          offset: { x: ef.x||0, y: ef.y||0 }, radius: ef.radius||0, spread: ef.spread||0,
          visible: true, blendMode: 'NORMAL' } as DropShadowEffect)
      } else if (ef.type === 'layer-blur') {
        effects.push({ type: 'LAYER_BLUR', radius: ef.radius||0, visible: true } as BlurEffect)
      } else if (ef.type === 'background-blur') {
        effects.push({ type: 'BACKGROUND_BLUR', radius: ef.radius||0, visible: true } as BlurEffect)
      }
    }
  }

  // CSS filter: blur() and drop-shadow() map to Figma effects on any node.
  var filterStr = strAttr(node, 'filter', '')
  if (filterStr) {
    var blurM = filterStr.match(/blur\(\s*([\d.]+)px\s*\)/)
    if (blurM) effects.push({ type: 'LAYER_BLUR', radius: parseFloat(blurM[1]), visible: true } as BlurEffect)
    var dsM = filterStr.match(/drop-shadow\(([^)]+)\)/)
    if (dsM) {
      var dsp = dsM[1].trim().split(/\s+/)
      var ddx = parseFloat(dsp[0]) || 0, ddy = parseFloat(dsp[1]) || 0
      var dblur = 0, dcol = '#000000'
      if (dsp.length >= 4) { dblur = parseFloat(dsp[2]) || 0; dcol = dsp[3] }
      else if (dsp.length === 3) { if (isColorStr(dsp[2])) dcol = dsp[2]; else dblur = parseFloat(dsp[2]) || 0 }
      var dc = parseColor(dcol)
      effects.push({ type: 'DROP_SHADOW', color: { r: dc.r, g: dc.g, b: dc.b, a: dc.a },
        offset: { x: ddx, y: ddy }, radius: dblur, spread: 0, visible: true, blendMode: 'NORMAL' } as DropShadowEffect)
    }
  }

  if (effects.length) target.effects = effects
}

// Translate a CSS border-style into a Figma dash pattern (empty = solid line).
function dashPatternFor(style: string, weight: number): number[] {
  var wt = weight > 0 ? weight : 1
  if (style === 'dashed') return [wt * 3, wt * 2]
  if (style === 'dotted') return [wt, wt]
  return []
}

function applyStrokes(target: GeometryMixin, node: ImportNode): void {
  // appearance borders block (complex/multi-stroke)
  var app = node.appearance
  if (app && app.borders && app.borders.length > 0) {
    var paints: Paint[] = []
    for (var i = 0; i < app.borders.length; i++) {
      var b = app.borders[i]
      if (b.visible===false || !b.color) continue
      paints.push(solidPaint(b.color))
      if (i===0) {
        target.strokeWeight = b.w || 1
        target.strokeAlign = b.align==='outside'?'OUTSIDE':b.align==='center'?'CENTER':'INSIDE'
        if (b.style && 'dashPattern' in target) (target as any).dashPattern = dashPatternFor(b.style, b.w || 1)
      }
    }
    if (paints.length) { target.strokes = paints; return }
  }

  // border shorthand: "[width] #color [inside|outside|center] [solid|dashed|dotted]"
  var borderAttr = strAttr(node, 'border', '')
  if (borderAttr) {
    var bParts = borderAttr.trim().split(/\s+/)
    var bColor = '', bWidth = 1, bAlign: 'INSIDE'|'OUTSIDE'|'CENTER' = 'CENTER', bStyle = ''
    for (var bi = 0; bi < bParts.length; bi++) {
      var bp = bParts[bi]
      if (isColorStr(bp)) {
        bColor = bp
      } else if (bp === 'inside') {
        bAlign = 'INSIDE'
      } else if (bp === 'outside') {
        bAlign = 'OUTSIDE'
      } else if (bp === 'center') {
        bAlign = 'CENTER'
      } else if (bp === 'solid' || bp === 'dashed' || bp === 'dotted') {
        bStyle = bp
      } else {
        var bw = parseFloat(bp)
        if (!isNaN(bw)) bWidth = bw
      }
    }
    if (!bStyle) bStyle = strAttr(node, 'border-style', '')
    if (bColor) {
      target.strokes = [solidPaint(bColor)]
      target.strokeWeight = bWidth
      target.strokeAlign = bAlign
      if (bStyle && 'dashPattern' in target) (target as any).dashPattern = dashPatternFor(bStyle, bWidth)
      return
    }
  }

  // border-color / border-width / border-style attrs (no shorthand)
  var bcAttr = strAttr(node, 'border-color', '')
  if (bcAttr && isColorStr(bcAttr)) {
    var bcWidth = numAttr(node, 'border-width', 1)
    target.strokes = [solidPaint(bcAttr)]
    target.strokeWeight = bcWidth
    var bcAlign = strAttr(node, 'border-align', '')
    target.strokeAlign = bcAlign === 'outside' ? 'OUTSIDE' : bcAlign === 'center' ? 'CENTER' : 'INSIDE'
    var bcStyle = strAttr(node, 'border-style', '')
    if (bcStyle && 'dashPattern' in target) (target as any).dashPattern = dashPatternFor(bcStyle, bcWidth)
    return
  }

  // legacy stroke attribute
  var sc = strAttr(node, 'stroke', '')
  if (sc && isColorStr(sc)) {
    target.strokes = [solidPaint(sc)]
    target.strokeWeight = numAttr(node, 'stroke-width', 1)
    target.strokeAlign = strAttr(node, 'stroke-position', '') === 'outside' ? 'OUTSIDE' : 'INSIDE'
  }
}

// ---------------------------------------------------------------------------
// Sizing helpers for auto-layout children
// ---------------------------------------------------------------------------

function applyChildSizing(child: SceneNode, childNode: ImportNode, parentMode: 'HORIZONTAL' | 'VERTICAL'): void {
  if (!('layoutSizingHorizontal' in child)) return
  var n = child as FrameNode
  // Only auto-layout frames and text can HUG. Figma throws if HUG is set on a
  // rectangle/ellipse/line/image/svg, so those fall back to FIXED.
  var canHug = n.type === 'TEXT' || (n.type === 'FRAME' && !!n.layoutMode && n.layoutMode !== 'NONE')
  var wv = childNode['w'], hv = childNode['h']
  var wHug = (wv === undefined || wv === null || wv === 'hug')
  var hHug = (hv === undefined || hv === null || hv === 'hug')
  n.layoutSizingHorizontal = wv==='fill' ? 'FILL' : (wHug && canHug) ? 'HUG' : 'FIXED'
  n.layoutSizingVertical   = hv==='fill' ? 'FILL' : (hHug && canHug) ? 'HUG' : 'FIXED'
}

// ---------------------------------------------------------------------------
// Radius (single or per-corner) + corner smoothing
// ---------------------------------------------------------------------------

function applyRadius(target: SceneNode, parsed: ImportNode): void {
  var t = target as any
  var rv = parsed['radius']
  if (typeof rv === 'number') {
    if (rv >= 0 && 'cornerRadius' in target) t.cornerRadius = rv
  } else if (typeof rv === 'string' && rv.trim()) {
    var nums = rv.trim().split(/\s+/).map(Number).filter(function(x){ return !isNaN(x) })
    if (nums.length === 1) {
      if ('cornerRadius' in target) t.cornerRadius = nums[0]
    } else if ('topLeftRadius' in target) {
      if (nums.length === 2) {
        t.topLeftRadius = nums[0]; t.topRightRadius = nums[1]
        t.bottomRightRadius = nums[0]; t.bottomLeftRadius = nums[1]
      } else if (nums.length >= 4) {
        t.topLeftRadius = nums[0]; t.topRightRadius = nums[1]
        t.bottomRightRadius = nums[2]; t.bottomLeftRadius = nums[3]
      }
    }
  }
  var cs = parsed['corner-smoothing']
  if (typeof cs === 'number' && cs >= 0 && 'cornerSmoothing' in target) t.cornerSmoothing = cs
}

// ---------------------------------------------------------------------------
// blend / constraints maps, transform composition, min/max, rotation, visibility
// ---------------------------------------------------------------------------

var BLEND_MAP: Record<string, BlendMode> = {
  'normal': 'NORMAL', 'multiply': 'MULTIPLY', 'screen': 'SCREEN', 'overlay': 'OVERLAY',
  'darken': 'DARKEN', 'lighten': 'LIGHTEN', 'color-dodge': 'COLOR_DODGE', 'color-burn': 'COLOR_BURN',
  'hard-light': 'HARD_LIGHT', 'soft-light': 'SOFT_LIGHT', 'difference': 'DIFFERENCE', 'exclusion': 'EXCLUSION',
  'hue': 'HUE', 'saturation': 'SATURATION', 'color': 'COLOR', 'luminosity': 'LUMINOSITY',
  'linear-burn': 'LINEAR_BURN', 'linear-dodge': 'LINEAR_DODGE',
}
// Shared for both axes — H uses left/right, V uses top/bottom.
var CONSTRAINT_MAP: Record<string, 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE'> = {
  'left': 'MIN', 'right': 'MAX', 'top': 'MIN', 'bottom': 'MAX',
  'center': 'CENTER', 'stretch': 'STRETCH', 'scale': 'SCALE',
}

// Compose flip/scale/skew/rotation into a relativeTransform matrix. Returns true
// if a transform was applied (only meaningful for absolutely-placed nodes).
function applyTransform2D(node: SceneNode, parsed: ImportNode, rotDeg: number): boolean {
  var flip = strAttr(parsed, 'flip', '')
  var sx = numAttr(parsed, 'scale-x', 1), sy = numAttr(parsed, 'scale-y', 1)
  var skx = numAttr(parsed, 'skew-x', 0), sky = numAttr(parsed, 'skew-y', 0)
  if (flip === '' && sx === 1 && sy === 1 && skx === 0 && sky === 0) return false
  if (!('relativeTransform' in node)) return false
  if (flip === 'h' || flip === 'both') sx = -sx
  if (flip === 'v' || flip === 'both') sy = -sy
  var th = rotDeg * Math.PI / 180
  var cos = Math.cos(th), sin = Math.sin(th)
  var tkx = Math.tan(skx * Math.PI / 180), tky = Math.tan(sky * Math.PI / 180)
  // K*S where K=[[1,tkx],[tky,1]], S=[[sx,0],[0,sy]]
  var ksa = sx, ksc = tkx * sy, ksb = tky * sx, ksd = sy
  // R*(K*S)
  var a = cos * ksa - sin * ksb
  var c = cos * ksc - sin * ksd
  var b = sin * ksa + cos * ksb
  var d = sin * ksc + cos * ksd
  var tt = node as any
  var e = typeof tt.x === 'number' ? tt.x : 0
  var f = typeof tt.y === 'number' ? tt.y : 0
  try { tt.relativeTransform = [[a, c, e], [b, d, f]]; return true } catch (err) { return false }
}

function applyVisualMisc(node: SceneNode, parsed: ImportNode): void {
  var t = node as any
  if (parsed['visible'] === false || parsed['visible'] === 'false') node.visible = false

  var bl = strAttr(parsed, 'blend', '')
  if (bl && bl !== 'normal' && bl !== 'pass-through' && 'blendMode' in node) {
    var bm = BLEND_MAP[bl]; if (bm) { try { t.blendMode = bm } catch (e) {} }
  }

  if ((parsed['mask'] === true || parsed['mask'] === 'true') && 'isMask' in node) {
    try { t.isMask = true } catch (e) {}
  }

  var ch = strAttr(parsed, 'constraint-h', ''), cv = strAttr(parsed, 'constraint-v', '')
  if ((ch || cv) && 'constraints' in node) {
    try {
      var cur = t.constraints || { horizontal: 'MIN', vertical: 'MIN' }
      t.constraints = {
        horizontal: ch && CONSTRAINT_MAP[ch] ? CONSTRAINT_MAP[ch] : cur.horizontal,
        vertical:   cv && CONSTRAINT_MAP[cv] ? CONSTRAINT_MAP[cv] : cur.vertical,
      }
    } catch (e) {}
  }

  var rot = numAttr(parsed, 'rotation', 0)
  var transformed = applyTransform2D(node, parsed, rot)
  if (!transformed && rot !== 0 && 'rotation' in node) { try { t.rotation = rot } catch (e) {} }

  var minW = parsed['min-width'], maxW = parsed['max-width']
  var minH = parsed['min-height'], maxH = parsed['max-height']
  try { if (typeof minW === 'number' && 'minWidth' in node)  t.minWidth = minW } catch (e) {}
  try { if (typeof maxW === 'number' && 'maxWidth' in node)  t.maxWidth = maxW } catch (e) {}
  try { if (typeof minH === 'number' && 'minHeight' in node) t.minHeight = minH } catch (e) {}
  try { if (typeof maxH === 'number' && 'maxHeight' in node) t.maxHeight = maxH } catch (e) {}
}

// ---------------------------------------------------------------------------
// Main node creation — parentW/parentH for resolving "fill" in abs context
// ---------------------------------------------------------------------------

async function createNode(
  parsed: ImportNode,
  parentMode: 'HORIZONTAL' | 'VERTICAL' | 'NONE',
  parentW: number,
  parentH: number,
): Promise<SceneNode | null> {
  var node = await createNodeImpl(parsed, parentMode, parentW, parentH)
  if (node) applyVisualMisc(node, parsed)
  return node
}

async function createNodeImpl(
  parsed: ImportNode,
  parentMode: 'HORIZONTAL' | 'VERTICAL' | 'NONE',
  parentW: number,
  parentH: number,
): Promise<SceneNode | null> {
  var type = strAttr(parsed, 'type', '')
  var w = resolveSize(parsed, 'w', parentW)
  var h = resolveSize(parsed, 'h', parentH)
  if (w <= 0 && !isKeyword(parsed, 'w')) w = 10
  if (h <= 0 && !isKeyword(parsed, 'h')) h = 10
  var x = numAttr(parsed, 'x', 0)
  var y = numAttr(parsed, 'y', 0)
  var opacity = numAttr(parsed, 'opacity', -1)
  var isAbs = boolAttr(parsed, 'abs')

  // Place in absolute position when parent is abs-layout OR this node has abs=true
  var placeAbsolute = parentMode === 'NONE' || isAbs

  // ── TEXT ──────────────────────────────────────────────────────────────────
  if (type === 'text') {
    var tn = figma.createText()
    var fam = strAttr(parsed, 'font-family', 'Inter')
    var wt  = numAttr(parsed, 'font-weight', 400)
    var itl = strAttr(parsed, 'font-style', 'normal') === 'italic'
    tn.fontName = await resolveFont(fam, wt, itl)
    tn.fontSize = numAttr(parsed, 'font-size', 14)

    // Mixed-style text (<segment> children) → per-run styling via setRange*;
    // single-style text uses node-level properties.
    var segsArr = Array.isArray(parsed['segments']) ? parsed['segments'] as ImportNode[] : []
    if (segsArr.length > 0) {
      var segFonts: FontName[] = []
      for (var sfi = 0; sfi < segsArr.length; sfi++) {
        var sFam = strAttr(segsArr[sfi], 'font-family', fam)
        var sWt  = numAttr(segsArr[sfi], 'font-weight', wt)
        var sIt  = strAttr(segsArr[sfi], 'font-style', itl ? 'italic' : 'normal') === 'italic'
        segFonts.push(await resolveFont(sFam, sWt, sIt))
      }
      if (segFonts.length) tn.fontName = segFonts[0]
      var full = ''
      var ranges: Array<{ start: number; end: number }> = []
      for (var sri = 0; sri < segsArr.length; sri++) {
        var sval = strAttr(segsArr[sri], 'value', '')
        ranges.push({ start: full.length, end: full.length + sval.length })
        full += sval
      }
      tn.characters = full
      for (var sgi = 0; sgi < segsArr.length; sgi++) {
        var seg = segsArr[sgi], rg = ranges[sgi]
        if (rg.end <= rg.start) continue
        tn.setRangeFontName(rg.start, rg.end, segFonts[sgi])
        var segFs = numAttr(seg, 'font-size', 0)
        if (segFs > 0) tn.setRangeFontSize(rg.start, rg.end, segFs)
        var segFill = strAttr(seg, 'fill', '') || strAttr(seg, 'color', '')
        if (segFill && isColorStr(segFill)) {
          var sgc = parseColor(segFill)
          tn.setRangeFills(rg.start, rg.end, [{ type:'SOLID', color:{r:sgc.r,g:sgc.g,b:sgc.b}, opacity:sgc.a }])
        }
        var segDec = strAttr(seg, 'decoration', '')
        if (segDec) tn.setRangeTextDecoration(rg.start, rg.end, segDec==='underline' ? 'UNDERLINE' : segDec==='strikethrough' ? 'STRIKETHROUGH' : 'NONE')
        var segCase = strAttr(seg, 'text-case', '')
        if (segCase) tn.setRangeTextCase(rg.start, rg.end, segCase==='uppercase' ? 'UPPER' : segCase==='lowercase' ? 'LOWER' : segCase==='capitalize' ? 'TITLE' : segCase==='small-caps-forced' ? 'SMALL_CAPS_FORCED' : segCase==='small-caps' ? 'SMALL_CAPS' : 'ORIGINAL')
        var segLs = numAttr(seg, 'letter-spacing', 0)
        if (segLs !== 0) tn.setRangeLetterSpacing(rg.start, rg.end, { unit:'PIXELS', value:segLs })
        var segLhRaw = seg['line-height']
        if (typeof segLhRaw === 'number' && segLhRaw > 0) tn.setRangeLineHeight(rg.start, rg.end, segLhRaw<=4 ? {unit:'PERCENT',value:segLhRaw*100} : {unit:'PIXELS',value:segLhRaw})
        var segHref = strAttr(seg, 'href', '')
        if (segHref) tn.setRangeHyperlink(rg.start, rg.end, { type:'URL', value:segHref })
      }
    } else {
      tn.characters = strAttr(parsed, 'value', '')

      var clr = strAttr(parsed,'color','') || strAttr(parsed,'fill','')
      if (clr && isColorStr(clr)) {
        var cc = parseColor(clr)
        tn.fills = [{ type:'SOLID', color:{r:cc.r,g:cc.g,b:cc.b}, opacity:cc.a }]
      } else { applyFills(tn, parsed) }

      var lhRaw = parsed['line-height']
      if (lhRaw !== undefined && lhRaw !== null) {
        var lh = typeof lhRaw==='number' ? lhRaw : parseFloat(String(lhRaw))
        if (!isNaN(lh) && lh > 0) tn.lineHeight = lh<=4 ? {unit:'PERCENT',value:lh*100} : {unit:'PIXELS',value:lh}
      }
      var ls = numAttr(parsed, 'letter-spacing', 0)
      if (ls !== 0) tn.letterSpacing = { unit:'PIXELS', value:ls }

      var tcase = strAttr(parsed, 'text-case', '')
      if (tcase) tn.textCase = tcase==='uppercase' ? 'UPPER' : tcase==='lowercase' ? 'LOWER' : tcase==='capitalize' ? 'TITLE' : tcase==='small-caps-forced' ? 'SMALL_CAPS_FORCED' : tcase==='small-caps' ? 'SMALL_CAPS' : 'ORIGINAL'
      var deco = strAttr(parsed, 'decoration', '')
      if (deco) tn.textDecoration = deco==='underline' ? 'UNDERLINE' : deco==='strikethrough' ? 'STRIKETHROUGH' : 'NONE'

      var hrefAttr = strAttr(parsed, 'href', '')
      if (hrefAttr && tn.characters.length > 0) tn.setRangeHyperlink(0, tn.characters.length, { type:'URL', value:hrefAttr })
    }

    // Paragraph-level properties apply to the whole node in both modes.
    var alignH = strAttr(parsed, 'align', '')
    if (alignH) tn.textAlignHorizontal = alignH==='center' ? 'CENTER' : alignH==='right' ? 'RIGHT' : (alignH==='justified' || alignH==='justify') ? 'JUSTIFIED' : 'LEFT'
    var alignV = strAttr(parsed, 'vertical-align', '')
    if (alignV) tn.textAlignVertical = alignV==='center' ? 'CENTER' : alignV==='bottom' ? 'BOTTOM' : 'TOP'
    var paraSp = parsed['paragraph-spacing']
    if (typeof paraSp === 'number') tn.paragraphSpacing = paraSp
    var paraInd = parsed['paragraph-indent']
    if (typeof paraInd === 'number') tn.paragraphIndent = paraInd

    if (w > 0 && h > 0) { tn.textAutoResize='NONE'; tn.resize(w,h) }
    else if (w > 0) { tn.textAutoResize='HEIGHT'; tn.resize(w, tn.height) }
    else { tn.textAutoResize='WIDTH_AND_HEIGHT' }

    // Truncation / ellipsis. Needs a bounded width, so auto-width text switches
    // to HEIGHT resize; an auto-layout parent with w="fill" then bounds it.
    var wantsTruncate = boolAttr(parsed, 'truncate')
    var maxLinesRaw = parsed['max-lines']
    var maxLinesN = typeof maxLinesRaw === 'number' ? maxLinesRaw : 0
    if (wantsTruncate || maxLinesN > 0) {
      if (tn.textAutoResize === 'WIDTH_AND_HEIGHT') tn.textAutoResize = 'HEIGHT'
      if ('textTruncation' in tn) tn.textTruncation = 'ENDING'
      if (maxLinesN > 0 && 'maxLines' in tn) tn.maxLines = maxLinesN
    }

    var tnName = strAttr(parsed, 'name', '')
    if (tnName) tn.name = tnName
    if (opacity >= 0) tn.opacity = opacity
    if (placeAbsolute) { tn.x = x; tn.y = y }
    return tn
  }

  // ── SVG ───────────────────────────────────────────────────────────────────
  if (type === 'svg') {
    var srcUri = strAttr(parsed, 'src', '')
    var svgStr = ''
    if (srcUri.startsWith('data:')) svgStr = svgDataUriToString(srcUri)
    if (!svgStr && parsed['svgContent']) {
      svgStr = '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">' + strAttr(parsed,'svgContent','') + '</svg>'
    }
    if (svgStr) {
      try {
        var svgN = figma.createNodeFromSvg(svgStr)
        if (w>0 && h>0) svgN.resize(w,h)
        if (opacity>=0) svgN.opacity=opacity
        if (placeAbsolute) { svgN.x=x; svgN.y=y }
        return svgN
      } catch(e) {}
    }
    var svgRect = figma.createRectangle()
    svgRect.resize(w||24, h||24)
    svgRect.fills=[{type:'SOLID',color:{r:0.8,g:0.8,b:0.8}}]
    if (placeAbsolute) { svgRect.x=x; svgRect.y=y }
    return svgRect
  }

  // ── IMAGE ─────────────────────────────────────────────────────────────────
  if (type === 'img') {
    var imgSrc = strAttr(parsed, 'src', '')
    // SVG can't be a raster image fill — render it as a vector node instead.
    if (imgSrc.indexOf('image/svg') !== -1) {
      var svgFromImg = svgDataUriToString(imgSrc)
      if (svgFromImg) {
        try {
          var imgSvgN = figma.createNodeFromSvg(svgFromImg)
          if (w>0 && h>0) imgSvgN.resize(w, h)
          if (opacity>=0) imgSvgN.opacity=opacity
          if (placeAbsolute) { imgSvgN.x=x; imgSvgN.y=y }
          return imgSvgN
        } catch(e) {}
      }
    }
    var imgR = figma.createRectangle()
    imgR.resize(w||100, h||100)
    if (imgSrc && imgSrc.startsWith('data:')) {
      // src is already a resolved data URI from the parser
      var imgObj = dataUriToImage(imgSrc)
      if (imgObj) {
        var fitMode = strAttr(parsed,'fit','cover')
        var imgFill: any = { type:'IMAGE', imageHash:imgObj.hash, scaleMode: imageScaleMode(fitMode) }
        var imgF = imageFiltersFrom(parsed)
        if (imgF) imgFill.filters = imgF
        imgR.fills = [imgFill]
      } else { imgR.fills=[{type:'SOLID',color:{r:0.9,g:0.9,b:0.9}}] }
    } else { imgR.fills=[{type:'SOLID',color:{r:0.9,g:0.9,b:0.9}}] }
    applyRadius(imgR, parsed)
    applyEffects(imgR, parsed)
    applyStrokes(imgR, parsed)
    if (opacity>=0) imgR.opacity=opacity
    if (placeAbsolute) { imgR.x=x; imgR.y=y }
    return imgR
  }

  // ── SHAPE / RECT / ELLIPSE ────────────────────────────────────────────────
  if (type === 'shape' || type === 'rect') {
    var rectN = figma.createRectangle()
    rectN.resize(w||10, h||10)
    applyFills(rectN, parsed, w||10, h||10); applyStrokes(rectN, parsed); applyEffects(rectN, parsed)
    applyRadius(rectN, parsed)
    if (opacity>=0) rectN.opacity=opacity
    if (placeAbsolute) { rectN.x=x; rectN.y=y }
    return rectN
  }
  if (type === 'ellipse') {
    var ellN = figma.createEllipse()
    ellN.resize(w||10, h||10)
    applyFills(ellN, parsed, w||10, h||10); applyStrokes(ellN, parsed); applyEffects(ellN, parsed)
    if (opacity>=0) ellN.opacity=opacity
    if (placeAbsolute) { ellN.x=x; ellN.y=y }
    return ellN
  }

  // ── LINE (divider) ────────────────────────────────────────────────────────
  if (type === 'line') {
    var lineRect = figma.createRectangle()
    var thick = numAttr(parsed, 'thickness', 0) || numAttr(parsed, 'stroke-width', 0) || 1
    // Vertical when declared, else inferred from a horizontal parent (a divider
    // in a row runs vertically; in a col it runs horizontally).
    var vertLine = strAttr(parsed, 'direction', '') === 'vertical' || (strAttr(parsed,'direction','')==='' && parentMode === 'HORIZONTAL')
    var lineFill = strAttr(parsed, 'fill', '') || strAttr(parsed, 'stroke', '')
    if (lineFill && isColorStr(lineFill)) lineRect.fills = [solidPaint(lineFill)]
    else applyFills(lineRect, parsed, 0, 0)
    if (vertLine) {
      var lh0 = h > 0 ? h : (parentH > 0 ? parentH : 1)
      lineRect.resize(thick, lh0 < 0.01 ? 1 : lh0)
      if (parsed['h'] === undefined || parsed['h'] === null) parsed['h'] = 'fill'
    } else {
      var lw0 = w > 0 ? w : (parentW > 0 ? parentW : 1)
      lineRect.resize(lw0 < 0.01 ? 1 : lw0, thick)
      if (parsed['w'] === undefined || parsed['w'] === null) parsed['w'] = 'fill'
    }
    if (opacity >= 0) lineRect.opacity = opacity
    if (placeAbsolute) { lineRect.x = x; lineRect.y = y }
    return lineRect
  }

  // ── INSTANCE ──────────────────────────────────────────────────────────────
  if (type === 'instance') {
    var compId = strAttr(parsed, 'component', '')
    var compEntry = compId ? _compRegistry[compId] : null
    if (compEntry && compEntry.body) {
      // Render the component body inline at the instance's position/size
      var instBody = compEntry.body
      // Merge instance-level overrides: copy instance's x/y/w/h onto a shallow copy of the body
      var bodyClone: ImportNode = {}
      var bodyKeys = Object.keys(instBody)
      for (var bk = 0; bk < bodyKeys.length; bk++) bodyClone[bodyKeys[bk]] = instBody[bodyKeys[bk]]
      // Instance w/h/x/y override the component body defaults
      if (parsed['w'] !== undefined) bodyClone['w'] = parsed['w']
      if (parsed['h'] !== undefined) bodyClone['h'] = parsed['h']
      if (parsed['x'] !== undefined) bodyClone['x'] = parsed['x']
      if (parsed['y'] !== undefined) bodyClone['y'] = parsed['y']
      if (parsed['opacity'] !== undefined) bodyClone['opacity'] = parsed['opacity']
      if (parsed['visible'] !== undefined) bodyClone['visible'] = parsed['visible']
      var instNode = await createNode(bodyClone, parentMode, parentW, parentH)
      return instNode
    }
    // No component body found — fall through to blank frame
  }

  // ── FRAME / ROW / COL / STACK / GROUP ────────────────────────────────────
  var frame = figma.createFrame()
  frame.name = strAttr(parsed, 'id', type) || strAttr(parsed, 'name', type)

  var dirAttr = strAttr(parsed, 'direction', '')
  var isGrid  = type === 'grid' || (type === 'stack' && dirAttr === 'grid')
  var isRow   = type === 'row'
  var isCol   = type === 'col'
  var isStack = type === 'stack' && !isGrid
  var isAuto  = isRow || isCol || isStack || isGrid
  var layoutMode: 'HORIZONTAL' | 'VERTICAL' | 'NONE' = 'NONE'

  if (isAuto) {
    // Padding (common)
    var pad = parsePadding(parsed)

    if (isGrid) {
      // Figma has no CSS grid — approximate as a wrapping horizontal auto-layout.
      layoutMode = 'HORIZONTAL'
      frame.layoutMode = 'HORIZONTAL'
      frame.layoutWrap = 'WRAP'
      var colGapRaw = parsed['grid-col-gap']; if (colGapRaw === undefined) colGapRaw = parsed['col-gap']
      var rowGapRaw = parsed['grid-row-gap']; if (rowGapRaw === undefined) rowGapRaw = parsed['row-gap']
      var cg = typeof colGapRaw==='number' ? colGapRaw : (typeof colGapRaw==='string' ? parseFloat(colGapRaw) : 0)
      var rg = typeof rowGapRaw==='number' ? rowGapRaw : (typeof rowGapRaw==='string' ? parseFloat(rowGapRaw) : 0)
      frame.itemSpacing = isNaN(cg) ? 0 : cg
      if ('counterAxisSpacing' in frame) (frame as any).counterAxisSpacing = isNaN(rg) ? 0 : rg
      frame.paddingTop=pad.top; frame.paddingRight=pad.right
      frame.paddingBottom=pad.bottom; frame.paddingLeft=pad.left
      frame.clipsContent = boolAttr(parsed,'clip')
    } else {
      var dir = strAttr(parsed,'direction', type==='row' ? 'horizontal' : 'vertical')
      layoutMode = dir==='horizontal' ? 'HORIZONTAL' : 'VERTICAL'
      frame.layoutMode = layoutMode

      // Gap
      var gapRaw = parsed['gap']
      var gapIsAuto = gapRaw==='auto' || gapRaw===true
      if (!gapIsAuto) {
        var gapN = typeof gapRaw==='number' ? gapRaw : (typeof gapRaw==='string' ? parseFloat(gapRaw) : 0)
        frame.itemSpacing = isNaN(gapN) ? 0 : gapN
      }

      // Padding
      frame.paddingTop=pad.top; frame.paddingRight=pad.right
      frame.paddingBottom=pad.bottom; frame.paddingLeft=pad.left

      // Alignment
      var alignStr = strAttr(parsed,'align','top-left')
      var al = decodeAlign(alignStr, layoutMode, gapIsAuto)
      frame.primaryAxisAlignItems  = al.primary
      frame.counterAxisAlignItems  = al.counter

      if (boolAttr(parsed,'wrap')) frame.layoutWrap='WRAP'
      frame.clipsContent = boolAttr(parsed,'clip')
    }

    // Axis sizing set directly on the frame so it hugs correctly even when the
    // parent is NOT auto-layout (root / absolute parent), where applyChildSizing
    // never runs and Figma would otherwise leave the counter axis FIXED at 100px.
    // 'fill' maps to FIXED here; an auto-layout parent upgrades it to FILL later.
    var wMode: 'FIXED' | 'AUTO' = (parsed['w'] === undefined || parsed['w'] === null || parsed['w'] === 'hug') ? 'AUTO' : 'FIXED'
    var hMode: 'FIXED' | 'AUTO' = (parsed['h'] === undefined || parsed['h'] === null || parsed['h'] === 'hug') ? 'AUTO' : 'FIXED'
    if (layoutMode === 'HORIZONTAL') {
      frame.primaryAxisSizingMode = wMode; frame.counterAxisSizingMode = hMode
    } else {
      frame.primaryAxisSizingMode = hMode; frame.counterAxisSizingMode = wMode
    }
    // Explicit pixel size for fixed numeric axes (skip fill/hug keywords).
    if (parsed['w'] !== 'fill' && parsed['w'] !== 'hug' && w > 0) frame.resize(w, frame.height)
    if (parsed['h'] !== 'fill' && parsed['h'] !== 'hug' && h > 0) frame.resize(frame.width, h)
  } else {
    // Absolute frame (or group — groups don't clip)
    frame.resize(w > 0 ? w : frame.width, h > 0 ? h : frame.height)
    frame.clipsContent = type !== 'group'
    layoutMode = 'NONE'
  }

  applyFills(frame, parsed, w, h)
  applyRadius(frame, parsed)
  if (opacity>=0) frame.opacity=opacity
  applyEffects(frame, parsed)
  applyStrokes(frame, parsed)

  if (placeAbsolute) { frame.x=x; frame.y=y }

  // Children
  var children = Array.isArray(parsed['children']) ? parsed['children'] as ImportNode[] : []
  // z-index and reverse-z affect paint order. In auto-layout, child order also
  // drives flow position, so we only reorder for absolute containers where order
  // is purely z-order.
  if (layoutMode === 'NONE') {
    var hasZ = false
    for (var zi = 0; zi < children.length; zi++) { if (children[zi]['z-index'] !== undefined) { hasZ = true; break } }
    if (hasZ) {
      var decorated = children.map(function(c, i) { return { c: c, i: i, z: zIndexOf(c) } })
      decorated.sort(function(a, b) { return a.z === b.z ? a.i - b.i : a.z - b.z })
      children = decorated.map(function(o) { return o.c })
    }
    if (boolAttr(parsed, 'reverse-z')) children = children.slice().reverse()
  }
  for (var ci = 0; ci < children.length; ci++) {
    var ch = children[ci]
    var chW = resolveSize(ch, 'w', w)
    var chH = resolveSize(ch, 'h', h)
    var child = await createNode(ch, layoutMode, chW > 0 ? chW : w, chH > 0 ? chH : h)
    if (!child) continue

    frame.appendChild(child)

    if (layoutMode !== 'NONE' && boolAttr(ch, 'abs')) {
      if ('layoutPositioning' in child) {
        (child as FrameNode).layoutPositioning = 'ABSOLUTE'
        child.x = numAttr(ch,'x',0)
        child.y = numAttr(ch,'y',0)
      }
    } else if (layoutMode !== 'NONE') {
      applyChildSizing(child, ch, layoutMode)
    }
  }

  if (isAuto && children.length === 0) {
    var emptyW = isHugSize(parsed, 'w')
    var emptyH = isHugSize(parsed, 'h')
    if (emptyW || emptyH) {
      if (layoutMode === 'HORIZONTAL') {
        if (emptyW) frame.primaryAxisSizingMode = 'FIXED'
        if (emptyH) frame.counterAxisSizingMode = 'FIXED'
      } else if (layoutMode === 'VERTICAL') {
        if (emptyW) frame.counterAxisSizingMode = 'FIXED'
        if (emptyH) frame.primaryAxisSizingMode = 'FIXED'
      }
      frame.resize(emptyW ? 1 : frame.width, emptyH ? 1 : frame.height)
    }
  }

  // Re-apply size for abs frames after children (Figma may resize)
  if (layoutMode === 'NONE' && w > 0 && h > 0) frame.resize(w, h)

  return frame
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export async function importGui(parsed: ImportParsedGUI): Promise<void> {
  if (!parsed || !parsed.root) {
    figma.notify('No root node in .gui file', { error: true })
    return
  }
  var notif = figma.notify('Importing…', { timeout: Infinity })
  try {
    await preloadFonts(parsed.fonts || {})

    // Build component registry so instances can look up their body
    _compRegistry = {}
    var comps = parsed.components || {}
    var compKeys = Object.keys(comps)
    for (var ci = 0; ci < compKeys.length; ci++) {
      var cid = compKeys[ci]
      var cdef = comps[cid]
      if (cdef && cdef.body) {
        _compRegistry[cid] = { body: cdef.body }
      }
      // Also register each variant body by its variant id
      if (cdef && cdef.variants) {
        for (var vi = 0; vi < cdef.variants.length; vi++) {
          var vr = cdef.variants[vi]
          var vrId = vr.attrs && vr.attrs['id']
          if (vrId && vr.body) _compRegistry[vrId] = { body: vr.body }
        }
      }
    }

    var root = parsed.root
    var rootW = typeof root['w']==='number' ? root['w'] : 0
    var rootH = typeof root['h']==='number' ? root['h'] : 0
    var node = await createNode(root, 'NONE', rootW, rootH)

    if (!node) { notif.cancel(); figma.notify('Import failed', { error: true }); return }

    if (parsed.name) { try { (node as FrameNode).name = parsed.name } catch(e){} }

    figma.currentPage.appendChild(node as SceneNode)
    figma.currentPage.selection = [node as SceneNode]
    figma.viewport.scrollAndZoomIntoView([node as SceneNode])
    notif.cancel()
    figma.notify('Imported ✓')
  } catch (err: any) {
    notif.cancel()
    figma.notify('Import error: ' + (err && err.message ? err.message : String(err)), { error: true })
  }
}
