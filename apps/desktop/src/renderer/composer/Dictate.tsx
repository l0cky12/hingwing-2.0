import { useCallback, useEffect, useRef, useState } from 'react'
import { transcribe } from '../store'
import { IDLE, microphoneRefusal, nextDictation, REFUSAL_WORDS, type Dictation, type DictationEvent } from './dictation'

/** Opus in WebM, which Chromium records and Hermes's transcribers take. */
const OPUS = 'audio/webm;codecs=opus'
const NOT_SENT = "Highwing couldn't send that to Hermes. Try again."

interface Capture { readonly stream: MediaStream; readonly recorder: MediaRecorder; readonly chunks: Blob[] }

const stopTracks = (stream: MediaStream) => stream.getTracks().forEach(track => track.stop())

/**
 * The microphone behind the composer's dictation. Each move of `nextDictation` is carried out here:
 * asking opens the microphone, leaving recording sends what was heard to Hermes, and back to idle
 * lets the microphone go. `onText` gets Hermes's text, and nothing else is done with it.
 */
export function useDictation(onText: (text: string) => void): readonly [Dictation, (event: DictationEvent) => void] {
  const [state, setState] = useState<Dictation>(IDLE)
  const held = useRef(state)
  const capture = useRef<Capture | null>(null)
  const latestOnText = useRef(onText)
  latestOnText.current = onText

  const letGo = () => {
    const taken = capture.current
    capture.current = null
    if (taken === null) return
    taken.recorder.ondataavailable = null
    taken.recorder.onstop = null
    if (taken.recorder.state !== 'inactive') taken.recorder.stop()
    stopTracks(taken.stream)
  }

  const move = useCallback((event: DictationEvent) => {
    const from = held.current
    const next = nextDictation(from, event)
    if (next === null) return
    held.current = next
    setState(next)
    if (next.at === 'asking') listen(next)
    else if (next.at === 'transcribing') send(next)
    else if (next.at === 'idle') letGo()
    if (event.do === 'transcribed' && next.at === 'idle' && event.text.trim() !== '') latestOnText.current(event.text)
  }, [])

  const listen = (asking: Dictation) => {
    Promise.resolve().then(() => navigator.mediaDevices.getUserMedia({ audio: true })).then(stream => {
      if (held.current !== asking) return stopTracks(stream)
      try {
        const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported(OPUS) ? { mimeType: OPUS } : {})
        const chunks: Blob[] = []
        recorder.ondataavailable = ({ data }) => void (data.size > 0 && chunks.push(data))
        recorder.start()
        capture.current = { stream, recorder, chunks }
        move({ do: 'granted' })
      } catch {
        stopTracks(stream)
        move({ do: 'refused', why: 'failed' })
      }
    }, (error: unknown) => move({ do: 'refused', why: microphoneRefusal(error) }))
  }

  const send = (transcribing: Dictation) => {
    const taken = capture.current
    capture.current = null
    if (taken === null) return move({ do: 'failed', message: REFUSAL_WORDS.failed })
    const current = () => held.current === transcribing
    taken.recorder.onstop = () => {
      stopTracks(taken.stream)
      const mime = taken.recorder.mimeType || 'audio/webm'
      const heard = new Blob(taken.chunks, { type: mime })
      if (heard.size === 0) return move({ do: 'transcribed', text: '' })
      void heard.arrayBuffer().then(bytes => transcribe({ mime, audio: new Uint8Array(bytes) })).then(
        outcome => current() && move(outcome.ok ? { do: 'transcribed', text: outcome.value } : { do: 'failed', message: outcome.refusal.message }),
        () => current() && move({ do: 'failed', message: NOT_SENT })
      )
    }
    taken.recorder.stop()
  }

  useEffect(() => () => move({ do: 'cancel' }), [move])
  return [state, move]
}

interface MicrophoneProps {
  readonly state: Dictation
  readonly disabled: boolean
  readonly onPress: () => void
}

/** It keeps focus in the message box on a click, so Ctrl/Cmd+D still stops what the button started. */
export function Microphone({ state, disabled, onPress }: MicrophoneProps) {
  const recording = state.at === 'recording'
  return (
    <button
      type="button" className="clip mic" aria-label={recording ? 'Stop dictating' : 'Dictate'} aria-pressed={recording}
      disabled={disabled || state.at === 'asking' || state.at === 'transcribing'} onClick={onPress}
      onMouseDown={event => event.preventDefault()}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
        <rect x="5.5" y="1.75" width="5" height="8" rx="2.5" fill={recording ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" />
        <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.25" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </button>
  )
}
