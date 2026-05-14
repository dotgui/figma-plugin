// src/code.ts
figma.showUI(__html__, { width: 480, height: 600, title: "dotgui" });
var ind = function(depth) {
  return "  ".repeat(depth);
};
var ALIGN = {
  MIN: "start",
  CENTER: "center",
  MAX: "end",
  BASELINE: "baseline",
  SPACE_BETWEEN: "space-between"
};
var FIT_MODE = {
  FILL: "cover",
  FIT: "contain",
  CROP: "crop",
  TILE: "tile"
};
var TEXT_CASE = {
  UPPER: "uppercase",
  LOWER: "lowercase",
  TITLE: "capitalize",
  SMALL_CAPS: "small-caps",
  SMALL_CAPS_FORCED: "small-caps-forced"
};
var BLEND_MODE = {
  MULTIPLY: "multiply",
  SCREEN: "screen",
  OVERLAY: "overlay",
  DARKEN: "darken",
  LIGHTEN: "lighten",
  COLOR_DODGE: "color-dodge",
  COLOR_BURN: "color-burn",
  HARD_LIGHT: "hard-light",
  SOFT_LIGHT: "soft-light",
  DIFFERENCE: "difference",
  EXCLUSION: "exclusion",
  HUE: "hue",
  SATURATION: "saturation",
  COLOR: "color",
  LUMINOSITY: "luminosity",
  LINEAR_BURN: "linear-burn",
  LINEAR_DODGE: "linear-dodge"
};
var GOOGLE_FONTS = {
  Inter: true,
  Roboto: true,
  "Roboto Mono": true,
  "Open Sans": true,
  Lato: true,
  Montserrat: true,
  Poppins: true,
  "Source Sans 3": true,
  "Source Serif 4": true,
  "Source Code Pro": true,
  Nunito: true,
  Raleway: true,
  Merriweather: true,
  "Playfair Display": true,
  Oswald: true,
  "Work Sans": true,
  "DM Sans": true,
  "Plus Jakarta Sans": true,
  "IBM Plex Sans": true,
  "IBM Plex Mono": true,
  "Noto Sans": true,
  "Noto Serif": true
};
var SYSTEM_FONTS = {
  "SF Pro": true,
  "SF Pro Display": true,
  "SF Pro Text": true,
  "New York": true,
  Helvetica: true,
  "Helvetica Neue": true,
  Arial: true,
  Verdana: true,
  Tahoma: true,
  "Trebuchet MS": true,
  "Times New Roman": true,
  Georgia: true,
  "Courier New": true,
  Menlo: true,
  Monaco: true,
  Avenir: true,
  "Avenir Next": true
};
var _imageMap = {};
var _imageCounter = 0;
var _svgNodeMap = {};
var _svgB64Map = {};
var _svgCounter = 0;
async function sendSelection() {
  const sel = figma.currentPage.selection;
  if (sel.length === 0) {
    figma.ui.postMessage({ type: "no-selection" });
    return;
  }
  if (sel.length > 1) {
    figma.ui.postMessage({ type: "multi-selection" });
    return;
  }
  const node = sel[0];
  if (!("width" in node)) {
    figma.ui.postMessage({ type: "not-frame", nodeType: node.type });
    return;
  }
  figma.ui.postMessage({ type: "loading" });
  const expNode = node;
  const results = await Promise.all([
    collectAndFetchImages(node),
    expNode.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 1 } }),
    expNode.exportAsync({ format: "SVG" })
  ]);
  const pngBytes = results[1];
  const svgBytes = results[2];
  const guiCode = await generateGui(node);
  const assetMap = {};
  const hks = Object.keys(_imageMap);
  for (let i = 0;i < hks.length; i++) {
    const a = _imageMap[hks[i]];
    assetMap["$" + a.id] = dataUrl(a);
  }
  const sks = Object.keys(_svgNodeMap);
  const seenSvgIds = {};
  for (let i = 0;i < sks.length; i++) {
    const a = _svgNodeMap[sks[i]];
    if (seenSvgIds[a.id])
      continue;
    seenSvgIds[a.id] = true;
    assetMap["$" + a.id] = dataUrl(a);
  }
  figma.ui.postMessage({
    type: "gui",
    code: guiCode,
    displayCode: makeDisplayCode(guiCode),
    assetMap,
    preview: "data:image/png;base64," + bytesToBase64(pngBytes),
    name: node.name,
    sizes: { gui: guiCode.length, png: pngBytes.length, svg: svgBytes.length }
  });
}
sendSelection();
figma.on("selectionchange", sendSelection);
figma.ui.onmessage = (msg) => {
  if (msg.type === "close")
    figma.closePlugin();
};
function rgbToHex(r, g, b, a = 1) {
  const h = (n) => Math.round(n * 255).toString(16).padStart(2, "0");
  return a < 1 ? `#${h(r)}${h(g)}${h(b)}${h(a)}` : `#${h(r)}${h(g)}${h(b)}`;
}
function solidFill(fills) {
  if (fills === figma.mixed || !Array.isArray(fills))
    return null;
  const f = fills.find((p) => p.type === "SOLID" && p.visible !== false);
  if (!f)
    return null;
  return rgbToHex(f.color.r, f.color.g, f.color.b, f.opacity !== undefined ? f.opacity : 1);
}
function visiblePaints(fills) {
  if (fills === figma.mixed || !Array.isArray(fills))
    return [];
  return fills.filter((p) => p.visible !== false);
}
function paintValue(p, nodeW, nodeH) {
  if (p.type === "SOLID") {
    const s = p;
    return rgbToHex(s.color.r, s.color.g, s.color.b, s.opacity !== undefined ? s.opacity : 1);
  }
  if (p.type === "GRADIENT_LINEAR" || p.type === "GRADIENT_RADIAL" || p.type === "GRADIENT_ANGULAR") {
    const g = p;
    var stopParts = [];
    for (var j = 0;j < g.gradientStops.length; j++) {
      const st = g.gradientStops[j];
      const sr = Math.round(st.color.r * 255);
      const sg = Math.round(st.color.g * 255);
      const sb = Math.round(st.color.b * 255);
      const paintOpacity = g.opacity !== undefined ? g.opacity : 1;
      const sa = parseFloat((st.color.a * paintOpacity).toFixed(3));
      const sc = sa >= 1 ? "rgb(" + sr + "," + sg + "," + sb + ")" : "rgba(" + sr + "," + sg + "," + sb + "," + sa + ")";
      if (p.type === "GRADIENT_ANGULAR") {
        stopParts.push(sc + " " + Math.round(st.position * 360) + "deg");
      } else {
        stopParts.push(sc + " " + Math.round(st.position * 100) + "%");
      }
    }
    const stops = stopParts.join(", ");
    const t = g.gradientTransform;
    if (p.type === "GRADIENT_LINEAR") {
      const dx = t[0][0] * nodeW;
      const dy = t[1][0] * nodeH;
      const angle = Math.round(Math.atan2(dx, -dy) * 180 / Math.PI);
      return "linear-gradient(" + angle + "deg, " + stops + ")";
    }
    if (p.type === "GRADIENT_ANGULAR") {
      const cx2 = Math.round((t[0][0] * 0.5 + t[0][1] * 0.5 + t[0][2]) * 100);
      const cy2 = Math.round((t[1][0] * 0.5 + t[1][1] * 0.5 + t[1][2]) * 100);
      const startAngle = Math.round(Math.atan2(t[1][0], t[0][0]) * 180 / Math.PI);
      return "conic-gradient(from " + startAngle + "deg at " + cx2 + "% " + cy2 + "%, " + stops + ")";
    }
    const cx = Math.round((t[0][0] * 0.5 + t[0][1] * 0.5 + t[0][2]) * 100);
    const cy = Math.round((t[1][0] * 0.5 + t[1][1] * 0.5 + t[1][2]) * 100);
    return "radial-gradient(circle at " + cx + "% " + cy + "%, " + stops + ")";
  }
  return null;
}
function fillValue(fills, nodeW, nodeH) {
  const paints = visiblePaints(fills);
  if (paints.length !== 1 || paints[0].type === "IMAGE")
    return null;
  return paintValue(paints[0], nodeW, nodeH);
}
function rounded(n) {
  return Math.round(n * 100) / 100;
}
function cropBoxAttrs(img, nodeW, nodeH) {
  if (img.scaleMode !== "CROP" || !img.imageTransform)
    return {};
  const t = img.imageTransform;
  const sx = t[0][0];
  const sy = t[1][1];
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || Math.abs(sx) < 0.0001 || Math.abs(sy) < 0.0001)
    return {};
  const width = nodeW / sx;
  const height = nodeH / sy;
  return {
    x: rounded(-width * t[0][2]),
    y: rounded(-height * t[1][2]),
    width: rounded(width),
    height: rounded(height)
  };
}
function appearanceFillLines(fills, nodeW, nodeH, depth) {
  const paints = visiblePaints(fills);
  if (paints.length <= 1 && (!paints[0] || paints[0].type !== "IMAGE"))
    return [];
  const fillLines = [];
  for (let i = 0;i < paints.length; i++) {
    const p = paints[i];
    if (p.type === "IMAGE") {
      const img = p;
      if (!img.imageHash || !_imageMap[img.imageHash])
        continue;
      const fillAttrs = {
        type: "image",
        src: "$" + _imageMap[img.imageHash].id,
        fit: FIT_MODE[img.scaleMode] || "cover",
        opacity: img.opacity !== undefined && img.opacity < 1 ? img.opacity : undefined
      };
      Object.assign(fillAttrs, cropBoxAttrs(img, nodeW, nodeH));
      fillLines.push(`${ind(depth + 1)}<fill ${attrs({
        type: fillAttrs.type,
        src: fillAttrs.src,
        fit: fillAttrs.fit,
        opacity: fillAttrs.opacity,
        x: fillAttrs.x,
        y: fillAttrs.y,
        width: fillAttrs.width,
        height: fillAttrs.height
      })} />`);
      continue;
    }
    const value = paintValue(p, nodeW, nodeH);
    if (!value)
      continue;
    fillLines.push(`${ind(depth + 1)}<fill ${attrs({
      type: p.type === "SOLID" ? "color" : p.type === "GRADIENT_LINEAR" ? "linear-gradient" : p.type === "GRADIENT_ANGULAR" ? "angular-gradient" : "radial-gradient",
      value,
      opacity: p.opacity !== undefined && p.opacity < 1 ? p.opacity : undefined
    })} />`);
  }
  return fillLines;
}
function visibleEffects(effects) {
  if (effects === figma.mixed || !Array.isArray(effects))
    return [];
  return effects.filter((e) => e.visible !== false);
}
function effectType(e) {
  if (e.type === "DROP_SHADOW")
    return "drop-shadow";
  if (e.type === "INNER_SHADOW")
    return "inner-shadow";
  if (e.type === "LAYER_BLUR")
    return "layer-blur";
  if (e.type === "BACKGROUND_BLUR")
    return "background-blur";
  return e.type.toLowerCase();
}
function appearanceEffectLines(effects, depth) {
  const out = [];
  const items = visibleEffects(effects);
  for (let i = 0;i < items.length; i++) {
    const e = items[i];
    if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
      out.push(`${ind(depth + 1)}<effect ${attrs({
        type: effectType(e),
        x: e.offset.x,
        y: e.offset.y,
        radius: e.radius,
        spread: e.spread !== undefined ? e.spread : 0,
        color: rgbToHex(e.color.r, e.color.g, e.color.b, e.color.a),
        blend: e.blendMode && e.blendMode !== "NORMAL" ? e.blendMode.toLowerCase() : undefined
      })} />`);
    } else if ((e.type === "LAYER_BLUR" || e.type === "BACKGROUND_BLUR") && e.blurType === "NORMAL") {
      out.push(`${ind(depth + 1)}<effect ${attrs({
        type: effectType(e),
        radius: e.radius
      })} />`);
    }
  }
  return out;
}
function appearanceBlock(fills, effects, nodeW, nodeH, depth) {
  const lines = appearanceFillLines(fills, nodeW, nodeH, depth).concat(appearanceEffectLines(effects, depth));
  if (!lines.length)
    return "";
  return `${ind(depth)}<appearance>
${lines.join(`
`)}
${ind(depth)}</appearance>`;
}
function strokeAttrs(node) {
  if (!Array.isArray(node.strokes) || node.strokes.length === 0)
    return {};
  const f = node.strokes.find((p) => p.type === "SOLID" && p.visible !== false);
  if (!f)
    return {};
  return {
    stroke: rgbToHex(f.color.r, f.color.g, f.color.b, f.opacity !== undefined ? f.opacity : 1),
    "stroke-width": typeof node.strokeWeight === "number" ? node.strokeWeight : null,
    "stroke-position": node.strokeAlign ? node.strokeAlign.toLowerCase() : null
  };
}
function shadowAttr(node) {
  if (!Array.isArray(node.effects))
    return null;
  const s = node.effects.find((e) => e.type === "DROP_SHADOW" && e.visible !== false);
  if (!s)
    return null;
  return `${s.offset.x} ${s.offset.y} ${s.radius} ${s.spread !== undefined ? s.spread : 0} ${rgbToHex(s.color.r, s.color.g, s.color.b, s.color.a)}`;
}
function rotationAttr(node) {
  if (!("rotation" in node))
    return;
  const rotation = node.rotation;
  if (!rotation)
    return;
  return Math.round(rotation * 100) / 100;
}
function blendModeAttr(node) {
  if (!("blendMode" in node))
    return;
  const bm = node.blendMode;
  if (bm === "NORMAL" || bm === "PASS_THROUGH")
    return;
  return BLEND_MODE[bm] || bm.toLowerCase().replace(/_/g, "-");
}
function maskAttr(node) {
  if (!("isMask" in node))
    return;
  return node.isMask || undefined;
}
function constraintAttrs(node) {
  if (!("constraints" in node))
    return {};
  const c = node.constraints;
  if (!c)
    return {};
  const h = c.horizontal !== "LEFT" ? c.horizontal.toLowerCase() : undefined;
  const v = c.vertical !== "TOP" ? c.vertical.toLowerCase() : undefined;
  return { "constraint-h": h, "constraint-v": v };
}
function sizingAttrs(node) {
  const result = {};
  if ("layoutSizingHorizontal" in node) {
    const h = node.layoutSizingHorizontal;
    if (h === "HUG" || h === "FILL")
      result["sizing-h"] = h.toLowerCase();
  }
  if ("layoutSizingVertical" in node) {
    const v = node.layoutSizingVertical;
    if (v === "HUG" || v === "FILL")
      result["sizing-v"] = v.toLowerCase();
  }
  return result;
}
function minMaxAttrs(node) {
  if (!("minWidth" in node))
    return {};
  const n = node;
  return {
    "min-width": n.minWidth != null ? n.minWidth : undefined,
    "max-width": n.maxWidth != null ? n.maxWidth : undefined,
    "min-height": n.minHeight != null ? n.minHeight : undefined,
    "max-height": n.maxHeight != null ? n.maxHeight : undefined
  };
}
function cornerRadius(node) {
  if (node.cornerRadius === figma.mixed) {
    const n = node;
    return `${n.topLeftRadius} ${n.topRightRadius} ${n.bottomRightRadius} ${n.bottomLeftRadius}`;
  }
  return node.cornerRadius > 0 ? String(node.cornerRadius) : null;
}
function padding(node) {
  const { paddingTop: t, paddingRight: r, paddingBottom: b, paddingLeft: l } = node;
  if (!t && !r && !b && !l)
    return null;
  if (t === r && r === b && b === l)
    return String(t);
  if (t === b && r === l)
    return `${t} ${r}`;
  return `${t} ${r} ${b} ${l}`;
}
function getImageFill(fills) {
  if (fills === figma.mixed || !Array.isArray(fills))
    return null;
  for (let i = 0;i < fills.length; i++) {
    const f = fills[i];
    if (f.type === "IMAGE" && f.visible !== false)
      return f;
  }
  return null;
}
function collectImageHashes(node, hashes) {
  if ("fills" in node) {
    const fill = getImageFill(node.fills);
    if (fill && fill.imageHash && hashes.indexOf(fill.imageHash) === -1) {
      hashes.push(fill.imageHash);
    }
  }
  if ("children" in node) {
    const ch = node.children;
    for (let i = 0;i < ch.length; i++)
      collectImageHashes(ch[i], hashes);
  }
}
function detectFormat(bytes) {
  if (bytes[0] === 255 && bytes[1] === 216)
    return "jpg";
  if (bytes[0] === 71 && bytes[1] === 73)
    return "gif";
  return "png";
}
function bytesToBase64(bytes) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  const len = bytes.length;
  for (let i = 0;i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    result += chars[b0 >> 2];
    result += chars[(b0 & 3) << 4 | b1 >> 4];
    result += i + 1 < len ? chars[(b1 & 15) << 2 | b2 >> 6] : "=";
    result += i + 2 < len ? chars[b2 & 63] : "=";
  }
  return result;
}
async function collectAndFetchImages(root) {
  _imageMap = {};
  _imageCounter = 0;
  _svgNodeMap = {};
  _svgB64Map = {};
  _svgCounter = 0;
  const hashes = [];
  collectImageHashes(root, hashes);
  for (let i = 0;i < hashes.length; i++) {
    const hash = hashes[i];
    const image = figma.getImageByHash(hash);
    if (!image)
      continue;
    try {
      const bytes = await image.getBytesAsync();
      _imageCounter++;
      _imageMap[hash] = { id: "img-" + _imageCounter, format: detectFormat(bytes), b64: bytesToBase64(bytes) };
    } catch (e) {}
  }
}
function dataUrl(asset) {
  const mime = asset.format === "svg" ? "svg+xml" : asset.format;
  return "data:image/" + mime + ";base64," + asset.b64;
}
function xmlEscape(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function attrs(obj) {
  return Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== false).map(([k, v]) => `${k}="${typeof v === "string" ? xmlEscape(v) : v}"`).join(" ");
}
function makeDisplayCode(code) {
  return code.replace(/base64:[A-Za-z0-9+/=]+/g, function(match) {
    const bytes = Math.round((match.length - 7) * 0.75);
    if (bytes < 1024)
      return "base64:[" + bytes + " B]";
    return "base64:[" + (bytes / 1024).toFixed(1) + " KB]";
  });
}
function visibleChildren(node) {
  if (!("children" in node))
    return [];
  return node.children.filter((c) => c.visible !== false);
}
function visibleLeaves(node) {
  const ch = visibleChildren(node);
  if (!ch.length)
    return [node];
  let out = [];
  for (let i = 0;i < ch.length; i++)
    out = out.concat(visibleLeaves(ch[i]));
  return out;
}
function isGraphicLeaf(node) {
  if (getImageFillFromNode(node))
    return false;
  return node.type === "RECTANGLE" || node.type === "ELLIPSE" || node.type === "LINE" || node.type === "VECTOR" || node.type === "STAR" || node.type === "POLYGON" || node.type === "BOOLEAN_OPERATION";
}
function getImageFillFromNode(node) {
  if (!("fills" in node))
    return null;
  return getImageFill(node.fills);
}
function hasHardEffects(node) {
  if (!("effects" in node) || !Array.isArray(node.effects))
    return false;
  return visibleEffects(node.effects).some((e) => e.type === "NOISE" || e.type === "TEXTURE" || e.type === "GLASS" || (e.type === "LAYER_BLUR" || e.type === "BACKGROUND_BLUR") && e.blurType === "PROGRESSIVE");
}
function isSvgClusterContainer(node) {
  if (!("children" in node))
    return false;
  if (node.type === "GROUP")
    return true;
  if (node.type === "FRAME" || node.type === "COMPONENT" || node.type === "INSTANCE") {
    const layoutMode = node.layoutMode;
    return !layoutMode || layoutMode === "NONE";
  }
  return false;
}
function shouldExportAsSvg(node, depth) {
  if (depth <= 1)
    return false;
  if (hasHardEffects(node))
    return true;
  if (node.type === "BOOLEAN_OPERATION")
    return true;
  if (node.type === "VECTOR" || node.type === "STAR" || node.type === "POLYGON")
    return true;
  if (!isSvgClusterContainer(node))
    return false;
  const leaves = visibleLeaves(node).filter((n) => n !== node);
  if (leaves.length < 2)
    return false;
  if (!leaves.every(isGraphicLeaf))
    return false;
  return true;
}
async function svgAsset(node) {
  if (_svgNodeMap[node.id])
    return _svgNodeMap[node.id];
  try {
    const bytes = await node.exportAsync({ format: "SVG" });
    const b64 = bytesToBase64(bytes);
    if (_svgB64Map[b64]) {
      _svgNodeMap[node.id] = _svgB64Map[b64];
      return _svgB64Map[b64];
    }
    _svgCounter++;
    const asset = { id: "svg-" + _svgCounter, format: "svg", b64 };
    _svgB64Map[b64] = asset;
    _svgNodeMap[node.id] = asset;
    return asset;
  } catch (e) {
    return null;
  }
}
async function svgToGui(node, depth) {
  const asset = await svgAsset(node);
  if (!asset)
    return "";
  const baseAttrs = {
    name: node.name,
    src: "$" + asset.id,
    x: Math.round(node.x),
    y: Math.round(node.y),
    width: Math.round(node.width),
    height: Math.round(node.height),
    opacity: node.opacity < 1 ? node.opacity : undefined,
    blend: blendModeAttr(node),
    mask: maskAttr(node),
    rotation: rotationAttr(node)
  };
  Object.assign(baseAttrs, constraintAttrs(node));
  Object.assign(baseAttrs, sizingAttrs(node));
  return `${ind(depth)}<svg ${attrs(baseAttrs)} />`;
}
async function nodeToGui(node, depth) {
  if (node.visible === false)
    return "";
  if (shouldExportAsSvg(node, depth)) {
    return svgToGui(node, depth);
  }
  switch (node.type) {
    case "FRAME":
    case "COMPONENT":
    case "INSTANCE":
      return frameToGui(node, depth);
    case "GROUP":
      return groupToGui(node, depth);
    case "TEXT":
      return textToGui(node, depth);
    case "RECTANGLE":
      return rectToGui(node, depth);
    case "ELLIPSE":
      return ellipseToGui(node, depth);
    case "LINE":
      return lineToGui(node, depth);
    case "VECTOR":
    case "STAR":
    case "POLYGON":
    case "BOOLEAN_OPERATION":
      return pathToGui(node, depth);
    default:
      if ("children" in node) {
        const lm = node.layoutMode;
        if (lm && lm !== "NONE")
          return frameToGui(node, depth);
        return groupToGui(node, depth);
      }
      return "";
  }
}
async function children(node, depth) {
  const parts = await Promise.all(node.children.map((c) => nodeToGui(c, depth)));
  return parts.filter(Boolean).join(`
`);
}
async function frameToGui(node, depth) {
  const lm = node.layoutMode;
  const isStack = lm !== "NONE";
  const isGrid = lm === "GRID";
  const tag = isStack ? "stack" : "frame";
  const isRoot = depth === 1;
  const a = {
    name: node.name,
    width: Math.round(node.width),
    height: Math.round(node.height),
    fill: fillValue(node.fills, node.width, node.height),
    radius: cornerRadius(node),
    "corner-smoothing": node.cornerSmoothing > 0 ? node.cornerSmoothing : undefined,
    opacity: node.opacity < 1 ? node.opacity : undefined,
    blend: blendModeAttr(node),
    mask: maskAttr(node),
    rotation: !isRoot ? rotationAttr(node) : undefined,
    clip: node.clipsContent || undefined,
    shadow: visibleEffects(node.effects).length ? undefined : shadowAttr(node)
  };
  if (!isRoot) {
    a.x = Math.round(node.x);
    a.y = Math.round(node.y);
  }
  Object.assign(a, strokeAttrs(node));
  if (!isRoot) {
    Object.assign(a, constraintAttrs(node));
    Object.assign(a, sizingAttrs(node));
    Object.assign(a, minMaxAttrs(node));
  }
  if (isStack) {
    if (isGrid) {
      a.direction = "grid";
      const gn = node;
      a["grid-columns"] = gn.gridColumnCount > 0 ? gn.gridColumnCount : undefined;
      a["grid-rows"] = gn.gridRowCount > 0 ? gn.gridRowCount : undefined;
      a["grid-col-gap"] = gn.gridColumnGap > 0 ? gn.gridColumnGap : undefined;
      a["grid-row-gap"] = gn.gridRowGap > 0 ? gn.gridRowGap : undefined;
    } else {
      a.direction = lm === "HORIZONTAL" ? "horizontal" : "vertical";
      a.gap = node.itemSpacing > 0 ? node.itemSpacing : undefined;
    }
    a.padding = padding(node);
    a.align = ALIGN[node.counterAxisAlignItems];
    a.justify = ALIGN[node.primaryAxisAlignItems];
    if (node.layoutWrap === "WRAP") {
      a.wrap = true;
      if (node.counterAxisAlignContent === "SPACE_BETWEEN")
        a["wrap-align"] = "space-between";
      if (node.counterAxisSpacing != null && node.counterAxisSpacing > 0)
        a["wrap-gap"] = node.counterAxisSpacing;
    }
  }
  const appearance = appearanceBlock(node.fills, node.effects, node.width, node.height, depth + 1);
  const childInner = await children(node, depth + 1);
  const inner = [appearance, childInner].filter(Boolean).join(`
`);
  if (!inner)
    return `${ind(depth)}<${tag} ${attrs(a)} />`;
  return `${ind(depth)}<${tag} ${attrs(a)}>
${inner}
${ind(depth)}</${tag}>`;
}
async function groupToGui(node, depth) {
  const a = attrs({
    name: node.name,
    x: Math.round(node.x),
    y: Math.round(node.y),
    width: Math.round(node.width),
    height: Math.round(node.height),
    opacity: node.opacity < 1 ? node.opacity : undefined,
    blend: blendModeAttr(node),
    mask: maskAttr(node),
    rotation: rotationAttr(node)
  });
  const inner = await children(node, depth + 1);
  if (!inner)
    return `${ind(depth)}<group ${a} />`;
  return `${ind(depth)}<group ${a}>
${inner}
${ind(depth)}</group>`;
}
function fontWeight(style) {
  const s = style.toLowerCase();
  if (s.indexOf("thin") !== -1)
    return 100;
  if (s.indexOf("extralight") !== -1 || s.indexOf("extra light") !== -1 || s.indexOf("ultralight") !== -1)
    return 200;
  if (s.indexOf("light") !== -1)
    return 300;
  if (s.indexOf("semibold") !== -1 || s.indexOf("semi bold") !== -1 || s.indexOf("demibold") !== -1)
    return 600;
  if (s.indexOf("extrabold") !== -1 || s.indexOf("extra bold") !== -1 || s.indexOf("ultrabold") !== -1)
    return 800;
  if (s.indexOf("black") !== -1 || s.indexOf("heavy") !== -1)
    return 900;
  if (s.indexOf("bold") !== -1)
    return 700;
  if (s.indexOf("medium") !== -1)
    return 500;
  return 400;
}
function fontStyle(style) {
  const s = style.toLowerCase();
  return s.indexOf("italic") !== -1 || s.indexOf("oblique") !== -1 ? "italic" : "normal";
}
function fontSource(family) {
  if (GOOGLE_FONTS[family])
    return "google";
  if (SYSTEM_FONTS[family])
    return "system";
  return "unresolved";
}
function addFontUsage(usage, fontName) {
  if (!usage[fontName.family]) {
    usage[fontName.family] = { family: fontName.family, weights: {}, styles: {} };
  }
  usage[fontName.family].weights[String(fontWeight(fontName.style))] = true;
  usage[fontName.family].styles[fontStyle(fontName.style)] = true;
}
function collectFontUsage(node, usage) {
  if (node.visible === false)
    return;
  if (node.type === "TEXT") {
    const text = node;
    if (text.fontName !== figma.mixed) {
      addFontUsage(usage, text.fontName);
    } else {
      const segments = getTextSegments(text);
      for (let i = 0;i < segments.length; i++) {
        if (segments[i].fontName)
          addFontUsage(usage, segments[i].fontName);
      }
    }
  }
  if ("children" in node) {
    const ch = node.children;
    for (let i = 0;i < ch.length; i++)
      collectFontUsage(ch[i], usage);
  }
}
function fontsBlock(node) {
  const usage = {};
  collectFontUsage(node, usage);
  const families = Object.keys(usage).sort();
  if (!families.length)
    return "";
  const lines = [];
  for (let i = 0;i < families.length; i++) {
    const item = usage[families[i]];
    const weights = Object.keys(item.weights).sort(function(a, b) {
      return parseInt(a) - parseInt(b);
    });
    const styles = Object.keys(item.styles).sort();
    lines.push(`${ind(1)}<font ${attrs({
      family: item.family,
      source: fontSource(item.family),
      weights: weights.join(" "),
      styles: styles.join(" ")
    })} />`);
  }
  return `${ind(0)}<fonts>
${lines.join(`
`)}
${ind(0)}</fonts>
`;
}
function lineHeightVal(lh) {
  if (lh.unit === "AUTO")
    return;
  if (lh.unit === "PERCENT")
    return lh.value + "%";
  return String(Math.round(lh.value));
}
function letterSpacingVal(ls) {
  if (ls.value === 0)
    return;
  if (ls.unit === "PERCENT")
    return ls.value + "%";
  return String(ls.value);
}
function getTextSegments(node) {
  try {
    const fn = node.getStyledTextSegments;
    if (typeof fn !== "function")
      return [];
    return fn.call(node, ["fontName", "fontSize", "fills", "textDecoration", "textCase", "letterSpacing", "lineHeight", "hyperlink"]);
  } catch (e) {
    return [];
  }
}
function isMixedText(node) {
  return node.fontName === figma.mixed || node.fontSize === figma.mixed || node.fills === figma.mixed || node.textDecoration === figma.mixed || node.textCase === figma.mixed || node.letterSpacing === figma.mixed || node.lineHeight === figma.mixed;
}
function textToGui(node, depth) {
  const vAlign = { TOP: "top", CENTER: "center", BOTTOM: "bottom" };
  const autoResize = node.textAutoResize;
  const hugW = autoResize === "WIDTH_AND_HEIGHT";
  const hugH = autoResize === "WIDTH_AND_HEIGHT" || autoResize === "HEIGHT";
  const isTruncated = autoResize === "TRUNCATE";
  const mixed = isMixedText(node);
  const a = {
    name: node.name,
    x: Math.round(node.x),
    y: Math.round(node.y),
    width: hugW ? "hug" : Math.round(node.width),
    height: hugH ? "hug" : Math.round(node.height),
    align: node.textAlignHorizontal !== "LEFT" ? node.textAlignHorizontal.toLowerCase() : undefined,
    "vertical-align": node.textAlignVertical !== "TOP" ? vAlign[node.textAlignVertical] : undefined,
    "paragraph-spacing": node.paragraphSpacing !== figma.mixed && node.paragraphSpacing > 0 ? node.paragraphSpacing : undefined,
    "paragraph-indent": node.paragraphIndent !== figma.mixed && node.paragraphIndent > 0 ? node.paragraphIndent : undefined,
    truncate: isTruncated || undefined,
    "max-lines": node.maxLines != null ? node.maxLines : undefined,
    "leading-trim": node.leadingTrim && node.leadingTrim !== "NONE" ? node.leadingTrim.toLowerCase().replace(/_/g, "-") : undefined,
    opacity: node.opacity < 1 ? node.opacity : undefined,
    blend: blendModeAttr(node),
    mask: maskAttr(node),
    rotation: rotationAttr(node)
  };
  Object.assign(a, constraintAttrs(node));
  Object.assign(a, sizingAttrs(node));
  Object.assign(a, minMaxAttrs(node));
  Object.assign(a, strokeAttrs(node));
  if (!mixed) {
    const fontName = node.fontName;
    const lh = node.lineHeight;
    const ls = node.letterSpacing;
    a.value = node.characters;
    a["font-family"] = fontName.family;
    a["font-size"] = node.fontSize;
    a["font-weight"] = fontWeight(fontName.style);
    a["font-style"] = fontStyle(fontName.style) === "italic" ? "italic" : undefined;
    a["line-height"] = lineHeightVal(lh);
    a["letter-spacing"] = letterSpacingVal(ls);
    a.color = solidFill(node.fills);
    a.decoration = node.textDecoration !== "NONE" ? node.textDecoration.toLowerCase() : undefined;
    a["text-case"] = node.textCase !== "ORIGINAL" ? TEXT_CASE[node.textCase] : undefined;
    if (node.hyperlink !== figma.mixed && node.hyperlink !== null) {
      const hl = node.hyperlink;
      if (hl.type === "URL")
        a.href = hl.value;
    }
    const appearance2 = appearanceBlock(node.fills, node.effects, node.width, node.height, depth + 1);
    if (!appearance2)
      return `${ind(depth)}<text ${attrs(a)} />`;
    return `${ind(depth)}<text ${attrs(a)}>
${appearance2}
${ind(depth)}</text>`;
  }
  const segments = getTextSegments(node);
  const segLines = segments.map((seg) => {
    const segColor = solidFill(seg.fills);
    const sa = {
      value: seg.characters,
      "font-family": seg.fontName ? seg.fontName.family : undefined,
      "font-size": seg.fontSize,
      "font-weight": seg.fontName ? fontWeight(seg.fontName.style) : undefined,
      "font-style": seg.fontName && fontStyle(seg.fontName.style) === "italic" ? "italic" : undefined,
      "line-height": seg.lineHeight ? lineHeightVal(seg.lineHeight) : undefined,
      "letter-spacing": seg.letterSpacing ? letterSpacingVal(seg.letterSpacing) : undefined,
      color: segColor,
      decoration: seg.textDecoration && seg.textDecoration !== "NONE" ? seg.textDecoration.toLowerCase() : undefined,
      "text-case": seg.textCase && seg.textCase !== "ORIGINAL" ? TEXT_CASE[seg.textCase] : undefined,
      href: seg.hyperlink && seg.hyperlink.type === "URL" ? seg.hyperlink.value : undefined
    };
    return `${ind(depth + 1)}<segment ${attrs(sa)} />`;
  });
  const appearance = appearanceBlock(node.fills, node.effects, node.width, node.height, depth + 1);
  const innerParts = [appearance, ...segLines].filter(Boolean);
  if (!innerParts.length)
    return `${ind(depth)}<text ${attrs(a)} />`;
  return `${ind(depth)}<text ${attrs(a)}>
${innerParts.join(`
`)}
${ind(depth)}</text>`;
}
function rectToGui(node, depth) {
  const a = {
    type: "rect",
    name: node.name,
    x: Math.round(node.x),
    y: Math.round(node.y),
    width: Math.round(node.width),
    height: Math.round(node.height),
    fill: fillValue(node.fills, node.width, node.height),
    radius: cornerRadius(node),
    "corner-smoothing": node.cornerSmoothing > 0 ? node.cornerSmoothing : undefined,
    opacity: node.opacity < 1 ? node.opacity : undefined,
    blend: blendModeAttr(node),
    mask: maskAttr(node),
    rotation: rotationAttr(node)
  };
  Object.assign(a, strokeAttrs(node));
  Object.assign(a, constraintAttrs(node));
  Object.assign(a, sizingAttrs(node));
  Object.assign(a, minMaxAttrs(node));
  const appearance = appearanceBlock(node.fills, node.effects, node.width, node.height, depth + 1);
  if (!appearance)
    return `${ind(depth)}<shape ${attrs(a)} />`;
  return `${ind(depth)}<shape ${attrs(a)}>
${appearance}
${ind(depth)}</shape>`;
}
function ellipseToGui(node, depth) {
  const arc = node.arcData;
  const TWO_PI = Math.PI * 2;
  const a = {
    type: "ellipse",
    name: node.name,
    x: Math.round(node.x),
    y: Math.round(node.y),
    width: Math.round(node.width),
    height: Math.round(node.height),
    fill: fillValue(node.fills, node.width, node.height),
    "arc-start": arc && Math.abs(arc.startingAngle) > 0.001 ? Math.round(arc.startingAngle * 180 / Math.PI * 100) / 100 : undefined,
    "arc-end": arc && Math.abs(arc.endingAngle - TWO_PI) > 0.001 ? Math.round(arc.endingAngle * 180 / Math.PI * 100) / 100 : undefined,
    "arc-inner": arc && arc.innerRadius > 0 ? arc.innerRadius : undefined,
    opacity: node.opacity < 1 ? node.opacity : undefined,
    blend: blendModeAttr(node),
    mask: maskAttr(node),
    rotation: rotationAttr(node)
  };
  Object.assign(a, strokeAttrs(node));
  Object.assign(a, constraintAttrs(node));
  Object.assign(a, sizingAttrs(node));
  const appearance = appearanceBlock(node.fills, node.effects, node.width, node.height, depth + 1);
  if (!appearance)
    return `${ind(depth)}<shape ${attrs(a)} />`;
  return `${ind(depth)}<shape ${attrs(a)}>
${appearance}
${ind(depth)}</shape>`;
}
function lineToGui(node, depth) {
  const cap = node.strokeCap !== figma.mixed && node.strokeCap !== "NONE" ? node.strokeCap.toLowerCase().replace(/_/g, "-") : undefined;
  const a = {
    type: "line",
    name: node.name,
    x: Math.round(node.x),
    y: Math.round(node.y),
    width: Math.round(node.width),
    "stroke-cap": cap,
    opacity: node.opacity < 1 ? node.opacity : undefined,
    blend: blendModeAttr(node),
    mask: maskAttr(node),
    rotation: rotationAttr(node)
  };
  Object.assign(a, strokeAttrs(node));
  Object.assign(a, constraintAttrs(node));
  Object.assign(a, sizingAttrs(node));
  return `${ind(depth)}<shape ${attrs(a)} />`;
}
function pathToGui(node, depth) {
  const geom = node;
  const paths = node.vectorPaths && node.vectorPaths.length > 0 ? node.vectorPaths : geom.fillGeometry || [];
  const d = paths.map(function(p) {
    return p.data;
  }).join(" ").trim();
  const a = {
    type: "path",
    name: node.name,
    x: Math.round(node.x),
    y: Math.round(node.y),
    width: Math.round(node.width),
    height: Math.round(node.height),
    fill: fillValue(node.fills, node.width, node.height),
    opacity: node.opacity < 1 ? node.opacity : undefined,
    blend: blendModeAttr(node),
    mask: maskAttr(node),
    rotation: rotationAttr(node)
  };
  Object.assign(a, strokeAttrs(node));
  Object.assign(a, constraintAttrs(node));
  Object.assign(a, sizingAttrs(node));
  if (!d)
    return `${ind(depth)}<shape ${attrs(a)} />`;
  return `${ind(depth)}<shape ${attrs(a)}>
${ind(depth + 1)}<path d="${d}" />
${ind(depth)}</shape>`;
}
function shiftedAttr(attrText, attr, delta) {
  const pattern = new RegExp(`\\s${attr}="([^"]*)"`);
  const match = attrText.match(pattern);
  if (!match)
    return attrText;
  const value = parseFloat(match[1]);
  if (!Number.isFinite(value))
    return attrText;
  return attrText.replace(pattern, ` ${attr}="${Math.round(value - delta)}"`);
}
function normalizeWrappedRootPosition(markup, offsetX, offsetY) {
  let isRoot = true;
  return markup.replace(/^(\s*<(?:frame|stack|group|text|img|svg|shape)\b)([^>]*)(\/?>)/gm, function(_, start, attrText, end) {
    if (isRoot) {
      isRoot = false;
      const withX = /\sx="[^"]*"/.test(attrText) ? attrText.replace(/\sx="[^"]*"/, ' x="0"') : attrText + ' x="0"';
      const withY = /\sy="[^"]*"/.test(withX) ? withX.replace(/\sy="[^"]*"/, ' y="0"') : withX + ' y="0"';
      return start + withY + end;
    }
    return start + shiftedAttr(shiftedAttr(attrText, "x", offsetX), "y", offsetY) + end;
  });
}
async function generateGui(node) {
  const w = Math.round(node.width);
  const h = Math.round(node.height);
  const viewport = `${w}x${h}`;
  var inner;
  if (node.type === "FRAME" || node.type === "COMPONENT" || node.type === "INSTANCE") {
    inner = await frameToGui(node, 1);
  } else {
    const wrapA = attrs({ width: w, height: h });
    const wrappedNode = normalizeWrappedRootPosition(await nodeToGui(node, 2), node.x || 0, node.y || 0);
    inner = `${ind(1)}<frame ${wrapA}>
${wrappedNode}
${ind(1)}</frame>`;
  }
  const assetKeys = Object.keys(_imageMap);
  const lines = assetKeys.map(function(hash) {
    const a = _imageMap[hash];
    return `${ind(1)}<image id="${a.id}" format="${a.format}" src="base64:${a.b64}" />`;
  });
  const svgKeys = Object.keys(_svgNodeMap);
  const seenSvgIds = {};
  for (let i = 0;i < svgKeys.length; i++) {
    const a = _svgNodeMap[svgKeys[i]];
    if (seenSvgIds[a.id])
      continue;
    seenSvgIds[a.id] = true;
    lines.push(`${ind(1)}<image id="${a.id}" format="svg" src="base64:${a.b64}" />`);
  }
  const assetsBlock = lines.length > 0 ? `${ind(0)}<assets>
${lines.join(`
`)}
${ind(0)}</assets>
` : "";
  return `<gui version="1.0" name="${xmlEscape(node.name)}" viewport="${viewport}">
${fontsBlock(node)}${assetsBlock}${inner}
</gui>`;
}
