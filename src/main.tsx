import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initGlobalFetchInterceptor } from './utils/appSecurityClient';

// Initialize Zero-Trust Anti-Tamper Fetch Interceptor
initGlobalFetchInterceptor();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
