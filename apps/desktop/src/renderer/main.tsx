import { createRoot } from 'react-dom/client'
import { App } from './App'
import { startDrafts } from './composer/drafts'
import 'katex/dist/katex.min.css'
import './styles/app.css'

void startDrafts()
createRoot(document.getElementById('root')!).render(<App />)
