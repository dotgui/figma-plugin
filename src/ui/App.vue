<template>
  <div class="plugin">
    <header>
      <span class="logo">dotgui</span>
      <div class="tabs">
        <button :class="{ active: tab === 'code' }" @click="tab = 'code'">Code</button>
        <button :class="{ active: tab === 'preview' }" @click="tab = 'preview'">Preview</button>
      </div>
      <div class="actions">
        <template v-if="code">
          <button class="action-btn" @click="copyFile">Save</button>
          <button class="action-btn" v-if="tab === 'code'" @click="copy">Copy</button>
        </template>
      </div>
    </header>

    <div class="sizes" v-if="state === 'gui' || loading">
      <template v-if="loading">
        <span class="size-item" v-for="fmt in ['SVG', 'PNG', '.gui']" :key="fmt">
          <span class="size-label">{{ fmt }}</span>
          <span class="size-value loading">···</span>
        </span>
      </template>
      <template v-else-if="sizes">
        <span
          v-for="item in sizeItems"
          :key="item.label"
          class="size-item"
          :class="{ smallest: item.isSmallest }"
        >
          <span class="size-label">{{ item.label }}</span>
          <span class="size-value">{{ item.display }}</span>
        </span>
      </template>
    </div>

    <div class="body">
      <div v-if="state !== 'gui'" class="empty">
        <p v-if="state === 'no-selection'">Select a layer to generate <code>.gui</code></p>
        <p v-else-if="state === 'multi-selection'">Select one layer at a time</p>
        <p v-else-if="state === 'not-frame'"><code>{{ nodeType }}</code> is not supported</p>
      </div>

      <template v-else>
        <div v-show="tab === 'code'" class="code-panel">
          <div class="code-search">
            <input
              v-model="searchText"
              type="search"
              placeholder="Search"
              @keydown.enter.prevent="runCodeSearch('next')"
            />
            <span class="search-count">{{ searchMatchLabel }}</span>
            <button class="search-nav" :disabled="!searchText" @click="runCodeSearch('previous')">↑</button>
            <button class="search-nav" :disabled="!searchText" @click="runCodeSearch('next')">↓</button>
          </div>
          <div ref="codeEditorEl" class="code-editor" />
        </div>
        <div v-show="tab === 'preview'" class="preview-wrap" @wheel.prevent="zoomWheel">
          <div ref="previewEl" class="preview" />
          <div class="zoom-bar">
            <button class="zoom-btn" @click="zoomOut" :disabled="zoomFactor <= MIN_ZOOM">−</button>
            <button class="zoom-reset" @click="zoomReset">{{ zoomLabel }}</button>
            <button class="zoom-btn" @click="zoomIn" :disabled="zoomFactor >= MAX_ZOOM">+</button>
          </div>
        </div>
      </template>
    </div>

    <div class="toast" :class="{ visible: toastVisible }">{{ toastMessage }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed, onBeforeUnmount } from 'vue'
import { render } from 'dotgui-render'
import { EditorState } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { HighlightStyle, foldGutter, foldKeymap, syntaxHighlighting } from '@codemirror/language'
import { xml } from '@codemirror/lang-xml'
import { SearchQuery, findNext, findPrevious, openSearchPanel, search, searchKeymap, searchPanelOpen, setSearchQuery } from '@codemirror/search'
import { tags } from '@lezer/highlight'

type State = 'idle' | 'no-selection' | 'multi-selection' | 'not-frame' | 'gui'
interface Sizes { gui: number; png: number; svg: number }
interface GuiAsset { id: string; format: string; src: string; bytes: Uint8Array }
interface GuiPreview { format: string; src: string; bytes: Uint8Array }
interface ExportFile { blob: Blob; mode: 'inline' | 'package'; bytes: number }

const state = ref<State>('idle')
const code = ref('')
const displayCode = ref('')
const assetMap = ref<Record<string, string>>({})
const exportFile = ref<ExportFile | null>(null)
const nodeName = ref('export')
const nodeType = ref('')
const tab = ref<'code' | 'preview'>('code')
const toastVisible = ref(false)
const loading = ref(false)
const sizes = ref<Sizes | null>(null)
const previewEl = ref<HTMLElement>()
const codeEditorEl = ref<HTMLElement>()
const zoomFactor = ref(1)
const searchText = ref('')
let applyZoom: ((factor: number, anchorX?: number, anchorY?: number) => void) | null = null
let codeView: EditorView | null = null
const MIN_ZOOM = 0.1
const MAX_ZOOM = 16
const PACKAGE_ASSET_LIMIT = 3
const PACKAGE_BYTE_LIMIT = 250_000

const dotguiHighlight = HighlightStyle.define([
  { tag: tags.angleBracket, color: '#7c7c86' },
  { tag: tags.tagName, color: '#0f6cbd' },
  { tag: tags.attributeName, color: '#8f4e00' },
  { tag: tags.string, color: '#137333' },
  { tag: tags.number, color: '#8e24aa' },
  { tag: tags.comment, color: '#7c7c86' },
])

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: '#fbfbfd',
    color: '#1c1c1e',
    fontSize: '11px',
  },
  '.cm-scroller': {
    fontFamily: '"SF Mono", "Fira Code", ui-monospace, monospace',
    lineHeight: '1.65',
  },
  '.cm-content': {
    padding: '12px 0',
  },
  '.cm-gutters': {
    backgroundColor: '#fbfbfd',
    color: '#9b9ba3',
    borderRight: '1px solid #e5e5ea',
  },
  '.cm-activeLine': {
    backgroundColor: '#f1f3f8',
  },
  '.cm-activeLineGutter': {
    backgroundColor: '#f1f3f8',
  },
  '.cm-foldGutter span': {
    cursor: 'pointer',
  },
  '.cm-searchMatch': {
    backgroundColor: '#ffe28a',
    color: '#1c1c1e',
    outline: '1px solid #d29a00',
    borderRadius: '2px',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: '#ffc44d',
    color: '#1c1c1e',
    outline: '1px solid #b77900',
  },
}, { dark: false })

function editorExtensions() {
  return [
    lineNumbers(),
    foldGutter(),
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    highlightActiveLine(),
    xml(),
    search({
      createPanel: () => {
        const dom = document.createElement('div')
        dom.style.display = 'none'
        return { dom }
      },
    }),
    syntaxHighlighting(dotguiHighlight),
    keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, ...searchKeymap]),
    EditorView.editable.of(false),
    EditorState.readOnly.of(true),
    editorTheme,
  ]
}

function mountCodeEditor() {
  if (!codeEditorEl.value || codeView) return
  codeView = new EditorView({
    state: EditorState.create({
      doc: displayCode.value,
      extensions: editorExtensions(),
    }),
    parent: codeEditorEl.value,
  })
}

function destroyCodeEditor() {
  if (!codeView) return
  codeView.destroy()
  codeView = null
}

function updateCodeEditorDoc(value: string) {
  if (!codeView) return
  const current = codeView.state.doc.toString()
  if (current === value) return
  codeView.dispatch({
    changes: { from: 0, to: current.length, insert: value },
  })
}

function syncCodeSearch() {
  if (!codeView) return
  if (searchText.value && !searchPanelOpen(codeView.state)) openSearchPanel(codeView)
  codeView.dispatch({
    effects: setSearchQuery.of(new SearchQuery({
      search: searchText.value,
      caseSensitive: false,
      literal: false,
    })),
  })
}

function runCodeSearch(direction: 'next' | 'previous') {
  if (!codeView || !searchText.value) return
  syncCodeSearch()
  ;(direction === 'next' ? findNext : findPrevious)(codeView)
  codeView.focus()
}

const searchMatchCount = computed(() => {
  if (!searchText.value) return 0
  const query = new SearchQuery({ search: searchText.value, caseSensitive: false })
  if (!query.valid) return 0

  let count = 0
  const cursor = query.getCursor(EditorState.create({ doc: displayCode.value }))
  for (let next = cursor.next(); !next.done; next = cursor.next()) count++
  return count
})

const searchMatchLabel = computed(() => searchText.value ? String(searchMatchCount.value) : '')

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function truncateBase64(s: string): string {
  let out = ''
  let at = 0

  while (at < s.length) {
    const start = s.indexOf('base64:', at)
    if (start === -1) {
      out += s.slice(at)
      break
    }

    let end = start + 7
    while (end < s.length && isBase64Char(s.charCodeAt(end))) end++

    const bytes = Math.round((end - start - 7) * 0.75)
    out += s.slice(at, start)
    out += bytes < 1024 ? `base64:[${bytes} B]` : `base64:[${(bytes / 1024).toFixed(1)} KB]`
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

function textBytes(s: string): number {
  return new TextEncoder().encode(s).length
}

function dataUrlBytes(url: string): Uint8Array {
  const comma = url.indexOf(',')
  if (comma === -1) return new Uint8Array()
  const meta = url.slice(0, comma)
  const data = url.slice(comma + 1)

  if (meta.indexOf(';base64') !== -1) {
    const bin = atob(data)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
  }

  return new TextEncoder().encode(decodeURIComponent(data))
}

function formatFromDataUrl(url: string, fallback: string): string {
  if (url.startsWith('data:image/svg+xml')) return 'svg'
  if (url.startsWith('data:image/webp')) return 'webp'
  if (url.startsWith('data:image/png')) return 'png'
  if (url.startsWith('data:image/jpeg') || url.startsWith('data:image/jpg')) return 'jpg'
  return fallback
}

function parseGuiAssets(guiCode: string, assets: Record<string, string>): GuiAsset[] {
  const doc = new DOMParser().parseFromString(guiCode, 'text/xml')
  if (doc.querySelector('parsererror')) return []

  const out: GuiAsset[] = []
  for (const node of Array.from(doc.querySelectorAll('assets > image'))) {
    const id = node.getAttribute('id')
    const format = node.getAttribute('format') || 'png'
    if (!id) continue

    const key = `$${id}`
    const src = assets[key] || ''
    if (!src.startsWith('data:')) continue
    const actualFormat = formatFromDataUrl(src, format)
    out.push({ id, format: actualFormat, src, bytes: dataUrlBytes(src) })
  }
  return out
}

function previewTag(src: string): string {
  return `<preview format="${formatFromDataUrl(src, 'webp')}" src="base64:${src.split(',')[1] || ''}" />`
}

function addPreview(guiCode: string, src: string): string {
  const existing = /<preview\b[^>]*\/>\n?/.exec(guiCode)
  if (existing) return guiCode.replace(existing[0], `${previewTag(src)}\n`)
  return guiCode.replace(/(<gui\b[^>]*>\n?)/, `$1${previewTag(src)}\n`)
}

function parsePreview(guiCode: string): GuiPreview | null {
  const doc = new DOMParser().parseFromString(guiCode, 'text/xml')
  if (doc.querySelector('parsererror')) return null
  const node = doc.querySelector('gui > preview')
  if (!node) return null

  const format = node.getAttribute('format') || 'webp'
  const src = node.getAttribute('src') || ''
  if (!src.startsWith('base64:')) return null

  const dataUrl = `data:image/${format === 'svg' ? 'svg+xml' : format};base64,${src.slice(7)}`
  return { format, src: dataUrl, bytes: dataUrlBytes(dataUrl) }
}

function packagedIndex(guiCode: string, assets: GuiAsset[], preview: GuiPreview | null): string {
  let out = guiCode
  for (const asset of assets) {
    const b64 = asset.src.split(',')[1]
    if (!b64) continue
    out = out.replace(
      `src="base64:${b64}"`,
      `src="assets/${asset.id}.${asset.format}"`
    )
    out = out.replace(
      new RegExp(`(<image\\b[^>]*\\bid="${asset.id}"[^>]*\\bformat=")[^"]+("[^>]*>)`),
      `$1${asset.format}$2`
    )
  }
  if (preview) {
    const b64 = preview.src.split(',')[1]
    if (b64) {
      out = out.replace(`src="base64:${b64}"`, 'src="preview.webp"')
      out = out.replace(/(<preview\b[^>]*\bformat=")[^"]+("[^>]*>)/, '$1webp$2')
    }
  }
  return out
}

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function u16(n: number): number[] {
  return [n & 255, (n >>> 8) & 255]
}

function u32(n: number): number[] {
  return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function zipStore(entries: { name: string; bytes: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder()
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const crc = crc32(entry.bytes)
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(entry.bytes.length), ...u32(entry.bytes.length),
      ...u16(name.length), ...u16(0),
      ...name,
    ])
    localParts.push(local, entry.bytes)

    const central = new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(entry.bytes.length), ...u32(entry.bytes.length),
      ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
      ...name,
    ])
    centralParts.push(central)
    offset += local.length + entry.bytes.length
  }

  const central = concatBytes(centralParts)
  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length),
    ...u32(central.length), ...u32(offset), ...u16(0),
  ])

  return concatBytes([...localParts, central, end])
}

function makePackage(guiCode: string, assets: GuiAsset[], preview: GuiPreview | null): Blob {
  const index = packagedIndex(guiCode, assets, preview)
  const encoder = new TextEncoder()
  const entries = [
    { name: 'index.gui', bytes: encoder.encode(index) },
    ...assets.map(asset => ({ name: `assets/${asset.id}.${asset.format}`, bytes: asset.bytes })),
  ]
  if (preview) entries.push({ name: 'preview.webp', bytes: preview.bytes })
  return new Blob([zipStore(entries)], { type: 'application/zip' })
}

async function prepareExport(guiCode: string, assets: Record<string, string>): Promise<ExportFile> {
  const guiAssets = parseGuiAssets(guiCode, assets)
  const preview = parsePreview(guiCode)
  const assetBytes = guiAssets.reduce((sum, asset) => sum + asset.bytes.length, preview ? preview.bytes.length : 0)
  const shouldPackage = guiAssets.length > PACKAGE_ASSET_LIMIT || assetBytes > PACKAGE_BYTE_LIMIT

  if (shouldPackage) {
    const blob = makePackage(guiCode, guiAssets, preview)
    return { blob, mode: 'package', bytes: blob.size }
  }

  const blob = new Blob([guiCode], { type: 'text/xml' })
  return { blob, mode: 'inline', bytes: textBytes(guiCode) }
}

function toWebP(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('no ctx')); return }
      ctx.drawImage(img, 0, 0)
      resolve(canvas.toDataURL('image/webp', 0.85))
    }
    img.onerror = reject
    img.src = dataUrl
  })
}

async function applyWebP(
  rawCode: string,
  rawAssetMap: Record<string, string>
): Promise<{ code: string; assetMap: Record<string, string> }> {
  const ids = Object.keys(rawAssetMap)
  if (!ids.length) return { code: rawCode, assetMap: rawAssetMap }

  let patched = rawCode
  const newMap: Record<string, string> = {}

  for (const id of ids) {
    const origUrl = rawAssetMap[id]
    if (origUrl.startsWith('data:image/svg+xml')) {
      newMap[id] = origUrl
      continue
    }
    try {
      const webpUrl = await toWebP(origUrl)
      newMap[id] = webpUrl
      const webpB64 = webpUrl.split(',')[1]
      const assetId = id.slice(1)
      patched = patched.replace(
        new RegExp(`<image\\b[^>]*\\bid="${assetId}"[^>]*>`),
        (tag) => tag
          .replace(/format="[^"]*"/, 'format="webp"')
          .replace(/src="base64:[^"]*"/, `src="base64:${webpB64}"`)
      )
    } catch {
      newMap[id] = origUrl
    }
  }

  return { code: patched, assetMap: newMap }
}

const sizeItems = computed(() => {
  if (!sizes.value) return []
  const s = sizes.value
  const entries = [
    { label: 'SVG', bytes: s.svg },
    { label: 'PNG', bytes: s.png },
    { label: '.gui', bytes: s.gui },
  ]
  const min = Math.min(s.svg, s.png, s.gui)
  return entries.map(e => ({ ...e, display: fmtBytes(e.bytes), isSmallest: e.bytes === min }))
})

const zoomLabel = computed(() => zoomFactor.value === 1 ? 'Fit' : `${Math.round(zoomFactor.value * 100)}%`)

window.onmessage = async (event: MessageEvent) => {
  const msg = event.data.pluginMessage
  if (!msg) return
  if (msg.type === 'loading') {
    loading.value = true
    sizes.value = null
    return
  }
  loading.value = false
  state.value = msg.type === 'gui' ? 'gui' : msg.type as State
  nodeType.value = msg.nodeType ?? ''

  if (msg.type !== 'gui') {
    code.value = ''
    displayCode.value = ''
    assetMap.value = {}
    exportFile.value = null
    nodeName.value = 'export'
    sizes.value = null
    return
  }

  nodeName.value = msg.name || 'export'
  sizes.value = msg.sizes ?? null

  const rawAssetMap: Record<string, string> = msg.assetMap || {}
  const { code: patched, assetMap: webpMap } = await applyWebP(msg.code, rawAssetMap)
  let finalCode = patched
  if (msg.preview) {
    try {
      finalCode = addPreview(patched, await toWebP(msg.preview))
    } catch {
      finalCode = addPreview(patched, msg.preview)
    }
  }

  code.value = finalCode
  displayCode.value = truncateBase64(finalCode)
  assetMap.value = webpMap

  exportFile.value = await prepareExport(finalCode, webpMap)
  if (sizes.value) sizes.value = { ...sizes.value, gui: exportFile.value.bytes }

  if (tab.value === 'preview') triggerRender()
  if (tab.value === 'code') nextTick(mountCodeEditor)
}

watch(tab, (t) => {
  if (t === 'preview') triggerRender()
  if (t === 'code') nextTick(mountCodeEditor)
})

watch(state, (next) => {
  if (next !== 'gui') {
    destroyCodeEditor()
    return
  }
  if (tab.value === 'code') nextTick(mountCodeEditor)
})

watch(displayCode, (value) => {
  updateCodeEditorDoc(value)
  nextTick(syncCodeSearch)
})

watch(searchText, () => {
  syncCodeSearch()
})

function triggerRender() {
  if (!code.value) return
  zoomFactor.value = 1
  applyZoom = null
  nextTick(() => {
    if (previewEl.value) applyZoom = render(code.value, previewEl.value, assetMap.value)
  })
}

onBeforeUnmount(() => {
  destroyCodeEditor()
})

function zoomIn() {
  const rect = previewEl.value?.getBoundingClientRect()
  setZoom(
    zoomFactor.value * 1.2,
    rect ? rect.width / 2 : undefined,
    rect ? rect.height / 2 : undefined,
  )
}

function zoomOut() {
  const rect = previewEl.value?.getBoundingClientRect()
  setZoom(
    zoomFactor.value / 1.2,
    rect ? rect.width / 2 : undefined,
    rect ? rect.height / 2 : undefined,
  )
}

function zoomWheel(event: WheelEvent) {
  const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1
  // Mac trackpad pinch sends ctrlKey=true with small deltaY (~1–5); needs a
  // higher multiplier than a regular scroll wheel (deltaY ~100 per click).
  const multiplier = event.ctrlKey ? 0.01 : 0.003
  const direction = Math.exp(-event.deltaY * unit * multiplier)
  const rect = previewEl.value?.getBoundingClientRect()
  setZoom(
    zoomFactor.value * direction,
    rect ? event.clientX - rect.left : undefined,
    rect ? event.clientY - rect.top : undefined,
  )
}

function setZoom(value: number, anchorX?: number, anchorY?: number) {
  zoomFactor.value = Math.min(Math.max(+value.toFixed(3), MIN_ZOOM), MAX_ZOOM)
  if (applyZoom) applyZoom(zoomFactor.value, anchorX, anchorY)
}

function zoomReset() {
  setZoom(1)
}

const toastMessage = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(msg: string) {
  toastMessage.value = msg
  toastVisible.value = true
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastVisible.value = false }, 1800)
}

function copyFallback(text: string) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;'
  document.body.appendChild(ta)
  ta.focus()
  ta.select()
  try { document.execCommand('copy') } catch {}
  document.body.removeChild(ta)
  showToast('Copied to clipboard')
}

function copy() {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code.value).then(() => showToast('Copied to clipboard')).catch(() => copyFallback(code.value))
  } else {
    copyFallback(code.value)
  }
}

function copyFile() {
  const file = exportFile.value || {
    blob: new Blob([code.value], { type: 'text/xml' }),
    mode: 'inline' as const,
    bytes: textBytes(code.value),
  }
  const url = URL.createObjectURL(file.blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${nodeName.value}.gui`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  showToast(file.mode === 'package' ? `Saved packaged ${nodeName.value}.gui` : `Saved ${nodeName.value}.gui`)
}
</script>

<style>
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: Inter, sans-serif;
  font-size: 12px;
  background: #fff;
  color: #1c1c1e;
}

.plugin {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  height: 40px;
  border-bottom: 1px solid #e5e5ea;
  flex-shrink: 0;
}

.logo {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: -0.3px;
  width: 60px;
}

.tabs {
  display: flex;
  gap: 2px;
  background: #f0f0f5;
  border-radius: 6px;
  padding: 2px;
}

.tabs button {
  padding: 4px 12px;
  border: none;
  border-radius: 4px;
  background: transparent;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  color: #6e6e73;
}

.tabs button.active {
  background: #fff;
  color: #1c1c1e;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.actions {
  display: flex;
  gap: 4px;
  align-items: center;
  width: 130px;
  justify-content: flex-end;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid #e5e5ea;
  border-radius: 4px;
  background: #fff;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  color: #1c1c1e;
  white-space: nowrap;
}

.action-btn:hover { background: #f5f5f7; }

.copy-btn { min-width: 52px; justify-content: center; }

.sizes {
  display: flex;
  gap: 0;
  border-bottom: 1px solid #e5e5ea;
  flex-shrink: 0;
}

.size-item {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 0;
  border-right: 1px solid #e5e5ea;
}

.size-item:last-child { border-right: none; }

.size-label {
  font-size: 10px;
  font-weight: 600;
  color: #aeaeb2;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.size-value {
  font-size: 11px;
  font-weight: 500;
  color: #1c1c1e;
  font-variant-numeric: tabular-nums;
}

.size-item.smallest .size-value { color: #34c759; }

.size-value.loading {
  color: #aeaeb2;
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #6e6e73;
  text-align: center;
  padding: 24px;
  line-height: 1.5;
}

.empty code {
  font-family: 'SF Mono', monospace;
  font-size: 11px;
  background: #f5f5f7;
  padding: 1px 4px;
  border-radius: 3px;
}

.code-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #fbfbfd;
}

.code-search {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid #e5e5ea;
  flex-shrink: 0;
}

.code-search input {
  min-width: 0;
  flex: 1;
  height: 24px;
  padding: 0 8px;
  border: 1px solid #d8d8df;
  border-radius: 5px;
  background: #fff;
  color: #1c1c1e;
  font-size: 11px;
  outline: none;
}

.code-search input:focus {
  border-color: #0a84ff;
}

.search-count {
  min-width: 24px;
  color: #6e6e73;
  font-size: 11px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.search-nav {
  width: 24px;
  height: 24px;
  border: 1px solid #d8d8df;
  border-radius: 5px;
  background: #fff;
  color: #1c1c1e;
  cursor: pointer;
  line-height: 1;
}

.search-nav:disabled {
  opacity: 0.35;
  cursor: default;
}

.code-editor {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: #fbfbfd;
  color: #1c1c1e;
}

.code-editor .cm-editor {
  height: 100%;
}

.code-editor .cm-searchMatch,
.code-editor .cm-selectionMatch {
  background-color: #ffe28a !important;
  color: #1c1c1e !important;
  outline: 1px solid #d29a00 !important;
  border-radius: 2px;
}

.code-editor .cm-searchMatch-selected,
.code-editor .cm-searchMatch.cm-searchMatch-selected {
  background-color: #ffc44d !important;
  color: #1c1c1e !important;
  outline: 1px solid #b77900 !important;
}

@media (prefers-color-scheme: dark) {
  body {
    background: #1e1e1e;
    color: #f5f5f7;
  }

  header,
  .sizes,
  .size-item {
    border-color: #3a3a3c;
  }

  .tabs {
    background: #2c2c2e;
  }

  .tabs button.active,
  .action-btn {
    background: #3a3a3c;
    color: #f5f5f7;
  }

  .action-btn {
    border-color: #4a4a4d;
  }

  .action-btn:hover {
    background: #48484a;
  }

  .code-panel,
  .code-editor {
    background: #1e1e1e;
    color: #d4d4d4;
  }

  .code-search {
    border-color: #3a3a3c;
  }

  .code-search input,
  .search-nav {
    background: #2c2c2e;
    border-color: #4a4a4d;
    color: #f5f5f7;
  }

  .search-count {
    color: #858585;
  }

  .code-editor .cm-editor {
    background: #1e1e1e;
    color: #d4d4d4;
  }

  .code-editor .cm-gutters {
    background: #1e1e1e;
    color: #858585;
    border-color: #3a3a3c;
  }

  .code-editor .cm-activeLine,
  .code-editor .cm-activeLineGutter {
    background: #252526;
  }

  .code-editor .cm-searchMatch {
    background: #6b5a1c !important;
    color: #f5f5f7 !important;
    outline-color: #a98c2a !important;
  }

  .code-editor .cm-selectionMatch {
    background: #6b5a1c !important;
    color: #f5f5f7 !important;
    outline-color: #a98c2a !important;
  }

  .code-editor .cm-searchMatch-selected,
  .code-editor .cm-searchMatch.cm-searchMatch-selected {
    background: #9a7316 !important;
    color: #fff !important;
    outline-color: #d8b547 !important;
  }

  .preview-wrap {
    background: #242426;
  }
}

.preview-wrap {
  flex: 1;
  overflow: hidden;
  position: relative;
  background: #f4f4f6;
}

.preview {
  width: 100%;
  height: 100%;
}

.zoom-bar {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 1px;
  background: rgba(28,28,30,0.75);
  backdrop-filter: blur(8px);
  border-radius: 8px;
  padding: 3px;
}

.zoom-btn {
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: #fff;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.zoom-btn:hover:not(:disabled) { background: rgba(255,255,255,0.12); }
.zoom-btn:disabled { opacity: 0.3; cursor: default; }

.zoom-reset {
  height: 26px;
  padding: 0 8px;
  border: none;
  background: transparent;
  color: #fff;
  font-size: 11px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  border-radius: 5px;
  white-space: nowrap;
  min-width: 36px;
  text-align: center;
}

.zoom-reset:hover { background: rgba(255,255,255,0.12); }

.toast {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%) translateY(6px);
  background: rgba(28,28,30,0.88);
  backdrop-filter: blur(8px);
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  padding: 7px 14px;
  border-radius: 8px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.18s ease, transform 0.18s ease;
  white-space: nowrap;
}

.toast.visible {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
</style>
