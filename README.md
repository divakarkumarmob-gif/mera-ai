# AI Live Agent

Standalone app that opens the AI voice agent directly — no login required.
Extracted and rebuilt from the "Mr.dk" project's floating AI agent, with:

- **No auth / no login** — opens straight into the AI agent
- **Full Live Voice** — real-time voice conversation via Gemini Live API over WebSocket (`/live`)
- **Encrypted chat history** stored locally in SQLite (AES-256-GCM at rest, no Firebase)
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
| `ENCRYPTION_KEY` | Recommended | Any long random string (32+ chars). Encrypts chat history at rest. **If you don't set this, history won't survive a server restart** (a new random key is generated each time the server starts). Generate one with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `SQLITE_PATH` | No | Where the SQLite file lives. Defaults to `./data/history.db` |
| `PORT` | No | Render sets this automatically |

## 3. Deploy to Render

1. Push this folder to a GitHub repo.
2. On Render: **New → Web Service**, connect the repo (it will detect `render.yaml`, or set manually):
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
3. In Render's Environment tab, add:
   - `GEMINI_API_KEY` = your key
   - `ENCRYPTION_KEY` = a random 32+ char string
   - `NODE_ENV` = `production`
4. **Important — persistent history**: Render's local disk is wiped on every deploy/restart unless you attach a persistent Disk. `render.yaml` already requests a 1GB disk mounted at `data/` for the SQLite file. If you set this up manually instead of using `render.yaml`, add a Disk under the service's "Disks" tab mounted at the same path as `SQLITE_PATH` (default `data`).
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
