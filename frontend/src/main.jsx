// src/main.jsx

import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { Toaster } from 'react-hot-toast';
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Toaster
        position="top-right"
        reverseOrder={false}
        toastOptions={{
          duration: 5000,
          style: {
            background: '#333',
            color: '#fff',
            zIndex: 9999,
          },
        }}
      />
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)