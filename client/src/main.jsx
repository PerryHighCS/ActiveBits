import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

/**
 * The main entry point of the React application. It renders the App component
 * inside a StrictMode wrapper, which helps identify potential problems in the
 * application.
 */
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
