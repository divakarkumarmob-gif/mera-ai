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

function buildCredential() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const rawKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !rawKey) {
    console.warn(
      "[FirebaseAdmin] WARNING: FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY not fully set. " +
        "Firestore calls will fail until these are configured."
    );
  }

  return admin.credential.cert({
    projectId,
    clientEmail,
    // .env files usually store the key with literal "\n" sequences instead
    // of real newlines, so we convert them back.
    privateKey: rawKey ? rawKey.replace(/\\n/g, "\n") : undefined,
  } as admin.ServiceAccount);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: buildCredential(),
  });
}

export const db = admin.firestore();
export const FieldValue = admin.firestore.FieldValue;
export default admin;
