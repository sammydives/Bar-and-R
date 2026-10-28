import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AuthGate } from './lib/AuthGate'
import './index.css'
import { VenueGate } from './lib/VenueGate'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><AuthGate>{uid => uid ? <VenueGate uid={uid}>{workspace => <App uid={workspace.scope} workspace={workspace} />}</VenueGate> : null}</AuthGate></React.StrictMode>
)
