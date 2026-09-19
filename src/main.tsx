import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initGlobalFetchInterceptor } from './utils/appSecurityClient';
import { startAvatarPreload } from './utils/avatarPreloader';

// Initialize Zero-Trust Anti-Tamper Fetch Interceptor
initGlobalFetchInterceptor();

// 🚀 Start preloading 3D avatar assets immediately (before any component mounts)
// APK: IndexedDB permanent cache — instant even after APK kill & reopen
// Web: Combined with Service Worker for true offline-ready instant load
void startAvatarPreload();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
