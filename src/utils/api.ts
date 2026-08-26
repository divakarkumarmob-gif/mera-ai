/**
 * Intelligent Backend API & WebSocket URL Resolver
 * Supports Web browsers, Capacitor Android APK, and custom Render server URLs.
 */

export const DEFAULT_PRODUCTION_BACKEND_URL = 'https://mera-ai-3496.onrender.com';

export function getBackendBaseUrl(): string {
  if (typeof window === 'undefined') return '';

  // 1. User-configured custom backend URL (stored in localStorage)
  const custom = localStorage.getItem('custom_backend_url') || localStorage.getItem('backend_url');
  if (custom && custom.trim()) {
    return custom.trim().replace(/\/+$/, '');
  }

  // 2. Vite environment variable injected during build (e.g. from GitHub Actions APK build workflow)
  const envUrl = (import.meta as any).env?.VITE_BACKEND_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim() && !envUrl.includes('localhost')) {
    return envUrl.trim().replace(/\/+$/, '');
  }

  // 3. Detect if running inside a native mobile environment (Capacitor Android / file:// / capacitor://localhost)
  const isNativeOrCapacitor =
    Boolean((window as any).Capacitor?.isNativePlatform?.()) ||
    window.location.protocol === 'file:' ||
    window.location.origin.includes('capacitor://') ||
    window.location.origin.includes('localhost') ||
    window.location.origin.includes('127.0.0.1');

  if (isNativeOrCapacitor) {
    return (envUrl || DEFAULT_PRODUCTION_BACKEND_URL).trim().replace(/\/+$/, '');
  }

  // 4. Default for Web browser hosted together with the Express server (relative path)
  return '';
}

export function setCustomBackendUrl(url: string) {
  if (typeof window === 'undefined') return;
  const clean = url.trim().replace(/\/+$/, '');
  if (!clean) {
    localStorage.removeItem('custom_backend_url');
    localStorage.removeItem('backend_url');
  } else {
    localStorage.setItem('custom_backend_url', clean);
  }
}

export function getApiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const base = getBackendBaseUrl();
  if (base) return `${base}${cleanPath}`;
  return cleanPath;
}

export function getWsUrl(): string {
  const base = getBackendBaseUrl();
  if (base) {
    const wsBase = base.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
    return `${wsBase}/live`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/live`;
}
