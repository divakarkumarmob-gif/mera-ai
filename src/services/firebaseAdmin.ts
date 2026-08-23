import admin from "firebase-admin";

// ---------------------------------------------------------------------------
// Firebase Admin SDK initialization (server-side only — never expose these
// credentials to the client/browser).
//
// Required env vars (see .env.example):
//   FIREBASE_PROJECT_ID
//   FIREBASE_CLIENT_EMAIL
//   FIREBASE_PRIVATE_KEY   (paste with \n literal newlines, we un-escape below)
// ---------------------------------------------------------------------------

function sanitizeValue(val?: string): string | undefined {
  if (!val) return undefined;
  let s = val.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function sanitizePrivateKey(rawKey?: string): string | undefined {
  if (!rawKey) return undefined;
  let key = rawKey.trim();
  // Strip outer quotes if pasted with quotes
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
  }
  // Replace escaped newlines with actual newlines
  key = key.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").trim();
  return key;
}

function buildCredential(): admin.credential.Credential | undefined {
  // Option 1: Entire service account JSON in one env var (convenient for Render/cloud)
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      if (parsed.private_key) {
        parsed.private_key = sanitizePrivateKey(parsed.private_key);
      }
      return admin.credential.cert(parsed);
    } catch (err) {
      console.error("[FirebaseAdmin] Failed to parse FIREBASE_SERVICE_ACCOUNT JSON:", err);
    }
  }

  const projectId = sanitizeValue(process.env.FIREBASE_PROJECT_ID);
  const clientEmail = sanitizeValue(process.env.FIREBASE_CLIENT_EMAIL);
  const privateKey = sanitizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (!projectId || !clientEmail || !privateKey) {
    console.warn(
      "[FirebaseAdmin] WARNING: FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY not fully set. " +
        "Firestore calls will fail until these are configured."
    );
    return undefined;
  }

  return admin.credential.cert({
    projectId,
    clientEmail,
    privateKey,
  } as admin.ServiceAccount);
}

if (!admin.apps.length) {
  const credential = buildCredential();
  if (credential) {
    admin.initializeApp({ credential });
  } else {
    // Initialize with application default or dummy to prevent app crash on startup
    try {
      admin.initializeApp();
    } catch (e) {
      console.warn("[FirebaseAdmin] Initialized without credentials. Configure Firebase env vars to enable Firestore.");
    }
  }
}

export const db = admin.apps.length ? admin.firestore() : (null as unknown as admin.firestore.Firestore);
export const FieldValue = admin.firestore.FieldValue;
export default admin;
