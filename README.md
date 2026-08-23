# AI Live Agent

Standalone app that opens the AI voice agent directly — no login required.
Extracted and rebuilt from the "Mr.dk" project's floating AI agent, with:

- **No auth / no login** — opens straight into the AI agent
- **Full Live Voice** — real-time voice conversation via Gemini Live API over WebSocket (`/live`)
- **Encrypted chat history** stored in Firestore (AES-256-GCM at rest for message text)
- **Persistent memory, contacts, reminders & notes** also stored in Firestore — survives restarts/redeploys with no local disk needed
- **Settings**: voice selection, thinking level, accurate/careful mode, answer length, Google Search mode
- **Live captions** with typewriter effect
- **Image sending** — attach a photo mid-conversation, AI sees and responds to it
- **Chat history viewer** with a clear-history option

## 1. Local setup

```bash
npm install
cp .env.example .env
# edit .env and set GEMINI_API_KEY (and ideally ENCRYPTION_KEY)
npm run dev
```

Open http://localhost:3000 — the AI agent page opens directly.

## 2. Environment variables

| Variable | Required | Notes |
|---|---|---|
| `GEMINI_API_KEY` | ✅ Yes | Your Gemini API key. Get one at https://aistudio.google.com/apikey |
| `FIREBASE_PROJECT_ID` | ✅ Yes | From your Firebase service account JSON. |
| `FIREBASE_CLIENT_EMAIL` | ✅ Yes | From your Firebase service account JSON. |
| `FIREBASE_PRIVATE_KEY` | ✅ Yes | From your Firebase service account JSON (`private_key` field). Keep the `\n` sequences literal. |
| `ENCRYPTION_KEY` | Recommended | Any long random string (32+ chars). Encrypts chat message text at rest in Firestore. **If you don't set this, old history becomes unreadable after a server restart** (a new random key is generated each time). Generate one with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `PORT` | No | Render sets this automatically |

### Getting your Firebase service account credentials

1. Go to the [Firebase Console](https://console.firebase.google.com/) → select your project (or create one).
2. Enable **Firestore Database** (Build → Firestore Database → Create database → production mode is fine, since only the server, via the Admin SDK, talks to it).
3. Go to ⚙️ **Project Settings** → **Service Accounts** tab → **Generate new private key**. This downloads a JSON file.
4. From that JSON, copy:
   - `project_id` → `FIREBASE_PROJECT_ID`
   - `client_email` → `FIREBASE_CLIENT_EMAIL`
   - `private_key` → `FIREBASE_PRIVATE_KEY` (paste it exactly as-is, including the `\n` characters and `-----BEGIN/END PRIVATE KEY-----` lines)
5. **Never commit this JSON file or these values to git.** Keep it only in `.env` locally and in Render's Environment tab in production.

### Firestore security rules

Since this app has no user login, all reads/writes go through the server using the Admin SDK, which bypasses Firestore security rules entirely. Set your Firestore rules to deny all direct client access so nobody can read/write your data from a browser:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

## 3. Deploy to Render

1. Push this folder to a GitHub repo.
2. On Render: **New → Web Service**, connect the repo (it will detect `render.yaml`, or set manually):
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
3. In Render's Environment tab, add:
   - `GEMINI_API_KEY` = your key
   - `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` = from your service account JSON (see above)
   - `ENCRYPTION_KEY` = a random 32+ char string
   - `NODE_ENV` = `production`
4. No persistent Disk is needed anymore — all data lives in Firestore, which survives deploys/restarts automatically.
5. Deploy. Your app will be live at `https://<your-service>.onrender.com`.

## 4. Project structure

```
server.ts                        Express + WebSocket server, SQLite history, Gemini Live session logic
src/App.tsx                      Entry point — opens the AI agent directly
src/components/LiveAIInterface.tsx   Main full-screen AI agent UI (voice, captions, settings, images)
src/components/AgentFace.tsx     Animated agent face
src/components/ChatHistoryModal.tsx  History viewer (reads /api/history)
src/utils/api.ts                 Small fetch/WebSocket URL helpers (no auth)
```

## 5. Notes

- Chat history is per-server (single shared history), since there's no login/user accounts. If you need per-user history later, that requires adding some form of identity back in.
- The AI's personality/system prompt is set in `server.ts` inside `buildSystemInstruction` — edit it there to change tone, language behavior, or scope.
- Voice options (`Aoede`, `Charon`, `Fenrir`, `Kore`, `Puck`) are Gemini Live's prebuilt voices.
- **WhatsApp**: pair once via QR code or 8-digit pairing code (in the WhatsApp Pair modal). The login session (creds + signal protocol keys) is stored in Firestore (`whatsapp_auth` collection) instead of local disk, so it survives server restarts and redeploys — you only need to re-pair if you explicitly reset the session or WhatsApp logs the device out remotely.
- **Reminders**: a background scheduler checks every 30 seconds for due reminders and delivers them via WhatsApp (set `OWNER_WHATSAPP_NUMBER` in your `.env`) and/or pushes them to any open app instance. The very first time this runs, Firestore will likely throw an error in the server logs with a direct link to create the required composite index (on `reminders`: `isCompleted` + `dueTimestamp`) — just click that link once and the query will work from then on.
