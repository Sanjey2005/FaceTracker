import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import Landing from './Landing.jsx'

function Root() {
  const [showLanding, setShowLanding] = useState(true)

  if (showLanding) {
    return <Landing onEnter={() => setShowLanding(false)} />
  }
  return <App />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
