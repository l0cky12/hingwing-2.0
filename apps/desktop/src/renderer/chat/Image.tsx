import type { SessionId } from '@highwing/hermes/domain'
import { createContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { parseImageRequest, type Bridge, type ImageRequest } from '../../ipc-contract'

/** The session whose steps the thread shows, which a tool image is asked for by. null where no session is watched. */
export const ImageSessionContext = createContext<SessionId | null>(null)

export type ImageState =
  | { readonly s: 'loading' }
  | { readonly s: 'ready'; readonly url: string }
  | { readonly s: 'failed' }

const LOADING: ImageState = { s: 'loading' }
const FAILED: ImageState = { s: 'failed' }

const keyOf = (request: ImageRequest | null) =>
  request === null ? '' : request.kind === 'web' ? `web ${request.url}` : `tool ${request.sessionId} ${request.path}`

/** What a request comes to. The blob URL it holds is the caller's to revoke. */
export async function settle(request: ImageRequest | null, bridge: Pick<Bridge, 'image'>): Promise<ImageState> {
  // The renderer's own check, so a link main would refuse never makes the trip.
  if (request === null || parseImageRequest(request) === null) return FAILED
  try {
    const outcome = await bridge.image(request)
    return outcome.ok ? { s: 'ready', url: URL.createObjectURL(new Blob([outcome.bytes as Uint8Array<ArrayBuffer>], { type: outcome.type })) } : FAILED
  } catch {
    return FAILED
  }
}

export function useImage(request: ImageRequest | null): ImageState {
  const key = keyOf(request)
  const [held, setHeld] = useState<{ readonly key: string; readonly state: ImageState } | null>(null)
  useEffect(() => {
    let live = true
    let url: string | null = null
    void settle(request, window.highwing).then(state => {
      if (state.s === 'ready') url = state.url
      if (live) setHeld({ key, state })
      else if (url !== null) URL.revokeObjectURL(url)
    })
    return () => {
      live = false
      if (url !== null) URL.revokeObjectURL(url)
    }
    // `request` is rebuilt every render, and `key` says when it means something else.
  }, [key])
  return request === null || parseImageRequest(request) === null ? FAILED : held?.key === key ? held.state : LOADING
}

const MISSED = "Couldn't load this image."

function Viewer({ url, alt, onClose }: { readonly url: string; readonly alt: string; readonly onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])
  return createPortal(
    <dialog
      ref={dialog}
      className="pic-viewer"
      aria-label={alt === '' ? 'Image' : alt}
      onClose={onClose}
      onKeyDown={event => {
        // The thread's find bar closes on an Escape nobody claimed. This one closes the viewer only.
        if (event.key === 'Escape') event.stopPropagation()
      }}
      onClick={event => {
        if (event.target === event.currentTarget) dialog.current?.close()
      }}
    >
      <img alt={alt} src={url} />
      <button type="button" onClick={() => dialog.current?.close()}>Close</button>
    </dialog>,
    document.body
  )
}

export function ImageView({ state, alt }: { readonly state: ImageState; readonly alt: string }) {
  const [viewing, setViewing] = useState(false)
  const [broken, setBroken] = useState<string | null>(null)
  const opener = useRef<HTMLButtonElement>(null)
  if (state.s === 'loading') return <span className="pic-slot" aria-busy="true" />
  // Bytes that pass the sniff can still fail to decode, as a truncated PNG does.
  if (state.s === 'failed' || broken === state.url) {
    return (
      <span className="pic-failed" data-no-find="">
        {alt !== '' && <span className="pic-alt">{alt}</span>}
        {MISSED}
      </span>
    )
  }
  return (
    <>
      <button
        type="button"
        className="pic"
        aria-haspopup="dialog"
        ref={opener}
        onClick={event => {
          // An image inside a link would otherwise also send the link to the browser.
          event.preventDefault()
          setViewing(true)
        }}
      >
        <img alt={alt} src={state.url} onError={() => setBroken(state.url)} />
      </button>
      {viewing && (
        <Viewer
          url={state.url}
          alt={alt}
          onClose={() => {
            setViewing(false)
            opener.current?.focus()
          }}
        />
      )}
    </>
  )
}

export function ThreadImage({ request, alt }: { readonly request: ImageRequest | null; readonly alt: string }) {
  return <ImageView state={useImage(request)} alt={alt} />
}
