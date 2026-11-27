/** The part of noVNC 1.7.0's `RFB` (core/rfb.js) Highwing uses. The package ships no types. */
declare module '@novnc/novnc' {
  /** core/display.js, which draws the screen. Not exported, so it is reached through the `RFB` that made it. */
  export interface Display {
    imageRect(x: number, y: number, width: number, height: number, mime: string, bytes: Uint8Array<ArrayBuffer>): void
    _renderQPush(action: { readonly type: 'img'; readonly img: HTMLImageElement; readonly x: number; readonly y: number; readonly width: number; readonly height: number }): void
  }
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, urlOrChannel: string | object, options?: { readonly shared?: boolean })
    readonly _display: Display
    viewOnly: boolean
    scaleViewport: boolean
    disconnect(): void
    focus(): void
  }
}
