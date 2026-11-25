/** What Hermes asked of the window beside the chat: `preview.open` and `preview.close` from its `desktop_preview` tool. */
export type PaneAsk =
  /** `url` is a web URL, a `file:` URL or a path, as the tool passed it on (tools/open_preview_tool.py:18-31). */
  | { readonly do: 'open'; readonly url: string; readonly label: string | null }
  /** null: close every page. The tool sends `url: ''` for that (tools/preview_tool.py:15-23). */
  | { readonly do: 'close'; readonly url: string | null }
