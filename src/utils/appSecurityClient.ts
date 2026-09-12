import { getBackendBaseUrl } from './api';

const STORAGE_KEY = 'app_access_session';

export interface AppSession {
    unlockedAt: number;
    token: string;
}

export function getStoredAppSession(): AppSession | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const session: AppSession = JSON.parse(raw);
        // Valid for 48 hours (2 days)
        if (session.unlockedAt && Date.now() - session.unlockedAt < 48 * 60 * 60 * 1000 && session.token) {
            return session;
        }
    } catch {
        // Tampered session
    }
    return null;
}

export function getAppToken(): string | null {
    const session = getStoredAppSession();
    return session ? session.token : null;
}

export function saveAppSession(token: string) {
    const session: AppSession = {
        unlockedAt: Date.now(),
        token,
    };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch (e) {
        console.warn('[AppSecurityClient] Failed to persist session:', e);
    }
}

export function clearAppSession() {
    try {
        localStorage.removeItem(STORAGE_KEY);
        sessionStorage.removeItem(STORAGE_KEY);
    } catch {}
    window.dispatchEvent(new CustomEvent('app:security_locked'));
}

/**
 * Initializes global fetch interceptor to automatically attach
 * cryptographically signed App Token to all /api/ requests, and
 * resolve relative /api/ URLs to the live backend server on mobile APK.
 */
export function initGlobalFetchInterceptor() {
    if (typeof window === 'undefined') return;

    const originalFetch = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

        // In mobile APK (Capacitor/Cordova) or when backend URL is configured, resolve relative /api/
        let resolvedUrl = rawUrl;
        const backendBase = getBackendBaseUrl();
        if (rawUrl.startsWith('/api/')) {
            resolvedUrl = backendBase ? `${backendBase}${rawUrl}` : rawUrl;
        }

        const isInternalApi =
            (rawUrl.startsWith('/api/') || (backendBase && rawUrl.startsWith(`${backendBase}/api/`))) &&
            !rawUrl.includes('/api/app-key/');

        if (isInternalApi) {
            const token = getAppToken();
            const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : {}));

            if (token) {
                headers.set('x-app-key-token', token);
            }

            const modifiedInit: RequestInit = {
                ...init,
                headers,
            };

            const response = await originalFetch(resolvedUrl, modifiedInit);

            // If server returns 401 or 403 with lockout/revocation error, force lock immediately
            if (response.status === 401 || response.status === 403) {
                try {
                    const cloned = response.clone();
                    const data = await cloned.json();
                    if (
                        data?.error === 'ACCESS_LOCKED' ||
                        data?.error === 'SESSION_REVOKED' ||
                        data?.error === 'ACCESS_BLOCKED' ||
                        data?.error === 'ACCESS_BLOCKED_IMMEDIATE'
                    ) {
                        console.warn('[AppSecurityClient] 🚨 Access revoked/locked by server. Triggering local logout.');
                        clearAppSession();
                    }
                } catch {}
            }

            return response;
        }

        // If it was /api/app-key/* with relative path, send to resolved URL
        if (rawUrl.startsWith('/api/')) {
            return originalFetch(resolvedUrl, init);
        }

        return originalFetch(input, init);
    };

    // Background Heartbeat: Check session validity every 25 seconds
    if (typeof window !== 'undefined' && !(window as any).__sessionHeartbeatStarted) {
        (window as any).__sessionHeartbeatStarted = true;
        setInterval(async () => {
            const token = getAppToken();
            if (!token) return;

            const backendBase = getBackendBaseUrl();
            const checkUrl = backendBase ? `${backendBase}/api/app-key/session-check` : '/api/app-key/session-check';

            try {
                const res = await originalFetch(checkUrl, {
                    headers: { 'x-app-key-token': token },
                });
                if (res.status === 401 || res.status === 403) {
                    console.warn('[AppSecurityClient] Heartbeat session invalid/revoked. Locking.');
                    clearAppSession();
                }
            } catch {
                // Ignore transient network errors
            }
        }, 25000);
    }
}
