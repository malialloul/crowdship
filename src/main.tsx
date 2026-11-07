import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/barlow/400.css'
import '@fontsource/barlow/500.css'
import '@fontsource/barlow/600.css'
import '@fontsource/barlow-condensed/500.css'
import '@fontsource/barlow-condensed/600.css'
import '@fontsource/barlow-condensed/700.css'
import './index.css'
import { StartupError } from './components/StartupError'

const root = createRoot(document.getElementById('root')!)

// App is loaded dynamically so a startup failure (missing env vars, bad
// Supabase URL) shows a readable screen instead of a blank page.
import('./App')
  .then(({ default: App }) =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  )
  .catch((err: unknown) => {
    console.error(err)
    root.render(<StartupError message={err instanceof Error ? err.message : String(err)} />)
  })
