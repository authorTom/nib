import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/theme.css'
// After theme.css: every palette here overrides the default one it defines.
import './styles/themes.css'
import './styles/global.css'
import './styles/editor.css'
import './styles/print.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
