import { useEffect, useState } from 'react'
import { copyText } from '../store'

const COPIED_MS = 2000

export function Copy({ text }: { readonly text: string }) {
  const [presses, setPresses] = useState(0)
  useEffect(() => {
    if (presses === 0) return
    const timer = setTimeout(() => setPresses(0), COPIED_MS)
    return () => clearTimeout(timer)
  }, [presses])
  const press = async () => {
    if (await copyText(text)) setPresses(count => count + 1)
  }
  return <button type="button" className={presses > 0 ? 'copy copied' : 'copy'} onClick={() => void press()}>{presses > 0 ? 'Copied' : 'Copy'}</button>
}
