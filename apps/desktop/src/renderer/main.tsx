import { createRoot } from 'react-dom/client'
import { App } from './App'
import { loadDrafts } from './composer/drafts'
import './styles/app.css'

void loadDrafts()
createRoot(document.getElementById('root')!).render(<App />)
