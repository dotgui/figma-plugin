/**
 * Types for the kit modules the plugin UI uses. Runtime is wired in
 * vite.config.ts (render → prebuilt bundle, parser → source). These shims keep
 * the kit's source out of the plugin's typecheck.
 */
declare module '@dotgui/kit/render' {
  export function render(
    code: string,
    container: HTMLElement,
    assetMap?: Record<string, string>,
    options?: { zoom?: boolean; mode?: Record<string, string>; [key: string]: unknown },
  ): unknown
}

declare module '@dotgui/kit/parser' {
  export interface ParsedGUI {
    root: any
    components?: Record<string, any>
    [key: string]: unknown
  }
  export function parse(bytes: Uint8Array): ParsedGUI | null
  export function parseXml(xml: string, assetMap?: Record<string, string>): ParsedGUI | null
}
