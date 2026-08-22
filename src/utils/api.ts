// No-auth API helper: this app has no login, so requests are plain fetches.
// In production the frontend is served by the same Express server as the
// API, so a relative path works. Set VITE_BACKEND_URL only if you're
// pointing the frontend at a different host than it's served from.
export function getApiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const backendBase = (import.meta as any).env?.VITE_BACKEND_URL;
  if (backendBase) return `${backendBase}${cleanPath}`;
  return cleanPath;
}

export function getWsUrl(): string {
  const backendBase = (import.meta as any).env?.VITE_BACKEND_URL;
  if (backendBase) {
    const wsBase = backendBase.replace(/^http/, 'ws');
    return `${wsBase}/live`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/live`;
}
