import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import './formio/register' // <-- important: registers the "slider" component

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
