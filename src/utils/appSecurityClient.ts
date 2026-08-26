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

            // If server returns 401 ACCESS_LOCKED, force lock immediately
            if (response.status === 401) {
                try {
                    const cloned = response.clone();
                    const data = await cloned.json();
                    if (data?.error === 'ACCESS_LOCKED') {
                        console.warn('[AppSecurityClient] 🚨 ACCESS_LOCKED received from server. Locking app.');
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
}
