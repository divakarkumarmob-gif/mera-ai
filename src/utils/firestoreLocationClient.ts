/**
 * FRIDAY AI — Firestore Client SDK with Offline Persistence
 *
 * Architecture:
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  GPS ON + Data OFF                                          │
 *   │  setDoc() → IndexedDB cache → app continues normally       │
 *   │             ↓ (when data returns)                           │
 *   │  Firestore SDK auto-syncs → server receives update         │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * Security:
 *   - Client uses Firebase Auth anonymous sign-in (no password needed)
 *   - Firestore Rules: only authenticated users can write to locations/{deviceId}
 *   - Server (Admin SDK) can read all — no change needed there
 *
 * Offline Persistence:
 *   - Uses IndexedDB (browser) / SQLite (Capacitor native)
 *   - Writes are NEVER lost even if data is off for hours
 *   - Auto-synced when ANY internet connection returns (WiFi, data, etc.)
 */

import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  setDoc,
  serverTimestamp,
  Firestore,
  CACHE_SIZE_UNLIMITED,
} from 'firebase/firestore';
import {
  getAuth,
  signInAnonymously,
  Auth,
  onAuthStateChanged,
} from 'firebase/auth';

// ── Firebase Client Config ─────────────────────────────────────────────────
// These are PUBLIC client-side keys — safe to expose in frontend
// (Security is enforced by Firestore Rules, not by hiding these keys)
const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyDummy_Replace_With_Real_WebApiKey', // ← Replace this
  authDomain:        'friday-ai-7f434.firebaseapp.com',
  projectId:         'friday-ai-7f434',
  storageBucket:     'friday-ai-7f434.appspot.com',
  messagingSenderId: '000000000000',  // ← Replace from Firebase Console
  appId:             '1:000000000000:web:0000000000000000000000', // ← Replace
};

// ── Collection path ────────────────────────────────────────────────────────
const LOCATION_COLLECTION = 'locations'; // same collection server uses

// ── Types ──────────────────────────────────────────────────────────────────
export interface FirestoreLocationPayload {
  deviceId:          string;
  username?:         string;
  label?:            string;
  lat:               number;
  lon:               number;
  accuracy:          number;
  altitude?:         number | null;
  speed?:            number | null;
  heading?:          number | null;
  batteryLevel?:     number | null;
  isCharging?:       boolean | null;
  networkType?:      string | null;
  isCachedLastKnown?: boolean;
  updatedAt:         any; // serverTimestamp()
}

// ── Service ────────────────────────────────────────────────────────────────

class FirestoreLocationClient {
  private app:  FirebaseApp | null = null;
  private db:   Firestore   | null = null;
  private auth: Auth        | null = null;
  private ready = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize Firebase with offline persistence.
   * Called once on service startup.
   */
  async init(): Promise<void> {
    if (this.ready) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInit();
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    try {
      // Avoid re-initializing if Firebase is already running
      if (getApps().length === 0) {
        this.app = initializeApp(FIREBASE_CONFIG);
      } else {
        this.app = getApps()[0];
      }

      // ── Initialize Firestore with OFFLINE PERSISTENCE ──────────────────
      // persistentLocalCache = IndexedDB on web, SQLite on native
      // This is the key that makes offline writes work!
      try {
        this.db = initializeFirestore(this.app, {
          localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager(),
            cacheSizeBytes: CACHE_SIZE_UNLIMITED,
          }),
        });
        console.log('[FirestoreClient] ✅ Offline persistence enabled (IndexedDB)');
      } catch (persistErr: any) {
        // Persistence might fail if already initialized — fall back to default
        console.warn('[FirestoreClient] Persistence fallback:', persistErr?.message);
        this.db = getFirestore(this.app);
      }

      // ── Anonymous Auth (required for Firestore rules) ──────────────────
      this.auth = getAuth(this.app);
      await this._ensureSignedIn();

      this.ready = true;
      console.log('[FirestoreClient] ✅ Ready — writes will persist offline automatically');
    } catch (err: any) {
      console.error('[FirestoreClient] ❌ Init failed:', err?.message);
      this.ready = false;
    }
  }

  /** Sign in anonymously so Firestore rules allow writes */
  private async _ensureSignedIn(): Promise<void> {
    if (!this.auth) return;
    return new Promise((resolve) => {
      const unsub = onAuthStateChanged(this.auth!, (user) => {
        unsub();
        if (user) {
          console.log('[FirestoreClient] 👤 Already signed in:', user.uid);
          resolve();
        } else {
          signInAnonymously(this.auth!)
            .then(cred => {
              console.log('[FirestoreClient] 👤 Anonymous sign-in:', cred.user.uid);
              resolve();
            })
            .catch(err => {
              console.warn('[FirestoreClient] ⚠️ Auth failed (offline mode):', err?.message);
              resolve(); // Don't block — offline writes still queue
            });
        }
      });
    });
  }

  /**
   * Write location to Firestore.
   *
   * Behavior:
   *   ✅ Data ON  → writes immediately to Firestore
   *   ✅ Data OFF → writes to IndexedDB cache → auto-syncs when data returns
   *
   * This replaces the manual offline queue — Google handles it for us!
   *
   * @returns 'written' | 'queued-offline' | 'error'
   */
  async writeLocation(payload: Omit<FirestoreLocationPayload, 'updatedAt'>): Promise<'written' | 'queued-offline' | 'error'> {
    if (!this.ready) {
      await this.init();
      if (!this.ready) return 'error';
    }

    if (!this.db) return 'error';

    try {
      const docRef = doc(this.db, LOCATION_COLLECTION, payload.deviceId);
      await setDoc(docRef, {
        ...payload,
        updatedAt: serverTimestamp(),
        source: 'client-sdk', // distinguish from server-written entries
      }, { merge: true });

      // If we're online: written immediately
      // If offline: written to IndexedDB, pending sync
      const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
      if (isOnline) {
        console.log(`[FirestoreClient] ✅ Location written: lat=${payload.lat} lon=${payload.lon}`);
        return 'written';
      } else {
        console.log(`[FirestoreClient] 📦 Location queued offline (auto-syncs when data returns): lat=${payload.lat} lon=${payload.lon}`);
        return 'queued-offline';
      }
    } catch (err: any) {
      console.error('[FirestoreClient] ❌ Write error:', err?.message);
      return 'error';
    }
  }

  get isReady(): boolean { return this.ready; }
  get isSignedIn(): boolean { return !!this.auth?.currentUser; }
}

export const firestoreLocationClient = new FirestoreLocationClient();
