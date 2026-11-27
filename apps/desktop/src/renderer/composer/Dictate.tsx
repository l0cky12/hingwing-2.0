import { useEffect, useRef, useState } from 'react'
import type { Recording } from '@highwing/hermes/domain'
import { transcribe } from '../store'
import { dictationDriver, IDLE, type Dictation, type DictationEvent, type Take } from './dictation'

/** Opus in WebM, which Chromium records and Hermes's transcribers take. */
const OPUS = 'audio/webm;codecs=opus'

const stopTracks = (stream: MediaStream) => stream.getTracks().forEach(track => track.stop())

/** This computer's microphone, recorded by Chromium. A recorder that cannot start lets the microphone go. */
async function microphone(): Promise<Take> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  try {
    const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported(OPUS) ? { mimeType: OPUS } : {})
    const chunks: Blob[] = []
    recorder.ondataavailable = ({ data }) => void (data.size > 0 && chunks.push(data))
    recorder.start()
    return {
      stop: () => new Promise<Recording | null>((resolve, reject) => {
        recorder.onstop = () => {
          stopTracks(stream)
          const mime = recorder.mimeType || 'audio/webm'
          const heard = new Blob(chunks, { type: mime })
          if (heard.size === 0) return resolve(null)
          heard.arrayBuffer().then(bytes => resolve({ mime, audio: new Uint8Array(bytes) }), reject)
        }
        recorder.stop()
      }),
      drop: () => {
        recorder.ondataavailable = null
        recorder.onstop = null
        if (recorder.state !== 'inactive') recorder.stop()
        stopTracks(stream)
      }
    }
  } catch (error) {
    stopTracks(stream)
    throw error
  }
}

/** The composer's dictation: its state, and the way to move it. `onText` gets Hermes's text, and nothing else is done with it. */
export function useDictation(onText: (text: string) => void): readonly [Dictation, (event: DictationEvent) => void] {
  const [state, setState] = useState<Dictation>(IDLE)
  const latestOnText = useRef(onText)
  latestOnText.current = onText
  const [move] = useState(() => dictationDriver({ listen: microphone, transcribe, onChange: setState, onText: text => latestOnText.current(text) }))
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
