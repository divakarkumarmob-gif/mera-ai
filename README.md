# 🤖 FRIDAY AI — Advanced Autonomous Companion & Human-Like Memory System

> **FRIDAY (Female Replacement Intelligent Digital Assistant Youth)** is a state-of-the-art, fully autonomous AI companion engineered for **Boss Divakar (DK)**. She features **Real-Time Gemini Live Voice (Audio-in / Audio-out)**, an **Omnipresent 4-Tier Memory Architecture**, **Zero Data-Loss 24-Hour Buffer Lifecycle**, and **Verified Multi-Channel Bot Alerts (Telegram & WhatsApp)**.

---

## 🌟 Core System Highlights

- 🎙️ **Real-Time Full-Duplex Voice:** Powered by Gemini Live WebSocket API (`/live`) with sub-second interruption handling and realistic emotional inflection.
- 🧠 **4-Tier Omnipresent Memory System:**
  - **Tier 1 (0–4 Days):** 100% exact word-to-word transcripts with Indian Standard Time (IST) timestamps.
  - **Tier 2 (4–60 Days):** Comprehensive, high-fidelity session summaries preserving all decisions, numbers, and context.
  - **Tier 3 (60+ Days Permanent):** Vector database powered by SOTA Google Embeddings (`text-embedding-004`) for lifetime semantic recall.
  - **Live Scratch Cache (24h Stream):** Live turns streamed in real-time to Firestore (`live_scratch_cache`) so unfinalized sessions survive server crashes.
- 📝 **"Aaj Ka Update" 30-Day Word-to-Word Retention:** Spoken daily life updates stored verbatim for 30 days. When rewritten, old text is fast-summarized into `mid_term_summaries` before replacement.
- 🛡️ **Zero Data-Loss Deletion Policy (24h Safety Buffer):** No document is ever deleted immediately. Summaries are first verified in Firestore, raw records are staged under a **24-hour grace period buffer**, and only pruned after 24 hours.
- 📲 **Genuine Multi-Channel Bot Audits (Telegram & WhatsApp):** Real-time verified confirmation alerts dispatched to Boss's Telegram Bot and WhatsApp whenever a memory summary is archived.
- ⚡ **3-Step Human-Like Execution Flow (`smartMemoryRetrieverService`):** Concurrently searches Tier 1, Tier 2, and Tier 3 in parallel to inject deep context awareness (Past, Present, and Future) before Friday speaks.
- 🎓 **Self-Correction & Wisdom Vault:** Friday notes her mistakes, Boss's reprimands, and golden rules via `record_ai_self_correction` so she never repeats them.
- 🔒 **Personal Vault:** Literal, unaltered facts about Boss's family, secrets, and identity that are NEVER summarized or diluted.
- 🏋️ **24-Hour Habit Graph:** Real-time awareness of Boss's daily routine (Gym, Coding, Lunch, Walk, Sleep) based on current IST time.
- 🔐 **Zero-Trust App Lock & Intrusion Defense:** Passkey gate with HMAC-SHA256 session tokens, 3-strike IP auto-blocking, rate limiting, and remote control via Telegram/WhatsApp.

---

## 🏗️ 4-Tier Memory & Deletion Lifecycle Architecture

```mermaid
flowchart TD
    subgraph LiveInteraction ["1. Live Real-Time Stream (0 - 24 Hours)"]
        Turn["🗣️ Spoken Dialogue Turn"] --> LiveScratch["⚡ Firestore live_scratch_cache\n(Immediate Stream - Crash Proof)"]
        Turn --> ActiveTranscript["🗣️ Active Session Transcript"]
    end

    subgraph Tier1Window ["2. Tier 1: Verbatim Window (0 - 4 Days)"]
        ActiveTranscript --> FourDayExact["🗣️ Exact Word-to-Word Transcripts\n(Retained verbatim with IST timestamps)"]
    end

    subgraph Tier2Window ["3. Tier 2: Comprehensive Digest (4 - 60 Days)"]
        FourDayExact -->|"After 4 Days"| GeminiDigest["🤖 High-Fidelity Session Summarizer\n(gemini-3.6-flash Multi-Model Chain)"]
        GeminiDigest --> SixtyDayDigest["📚 4 to 60 Days Rich Summaries Digest"]
    end

    subgraph Tier3Window ["4. Tier 3: Lifetime Vector DB (60+ Days)"]
        SixtyDayDigest -->|"After 60 Days"| VectorArchiver["🗄️ Google SOTA text-embedding-004\n(768-dim Vector Embeddings + Date Metadata)"]
        VectorArchiver --> FirestoreVectorStore[("💾 Firestore vectorStore\n(Lifetime Semantic Search)")]
    end

    subgraph ZeroLossGuard ["5. Zero Data-Loss 24-Hour Buffer & Audit Alerts"]
        FirestoreVectorStore --> VerifySave{"🔍 Anti-Fake Verification\n(Summary physically in Firestore?)"}
        VerifySave -->|"YES"| Stage24h["🛡️ Stage Raw Doc with 24h Buffer:\n• status: 'archived_pending_delete'\n• safeDeleteAfter: now + 24 Hours"]
        Stage24h --> SendAlerts["📲 Dispatch Verified Confirmation Alerts\n• Telegram Bot\n• WhatsApp Bot"]
        Stage24h --> Prune24h["🗑️ Safe db.batch() Prune (After 24h)"]
    end
```

---

## ⚡ The 3-Step Human-Like Execution Flow

```mermaid
flowchart TD
    UserMsg["🗣️ Boss ka Naya Message:\n'Yaar, aaj office me jo project shuru kiya tha, usme phir se wahi purani dikkat aa gayi.'"] 
    --> Step1["🎯 चरण 1: संदर्भ को पहचानना (Semantic Search Query Generator)\nKeywords: [office, project, purani, dikkat]"]

    subgraph ParallelFetch ["⚡ चरण 2: समानांतर रूप से तीनों परतों (Tiers) से डेटा खींचना"]
        Step1 --> Tier1Fetch["Tier 1 (4-Day Window)\nPichle 4 dino ki poori chat history me\nis project par baat hui thi ya nahi"]
        Step1 --> Tier2Fetch["Tier 2 (Daily Updates)\n'Aaj ka update' ya 30 dino ke updates me\nis project ka naam, deadline, team info"]
        Step1 --> Tier3Fetch["Tier 3 (Vector DB - Long Term)\nCosine Vector Embedding Match:\n2 mahine purani same issue ki memory"]
    end

    Tier1Fetch --> Step3["🧩 चरण 3: The Smart Prompt Injection (इंसानी संदर्भ)"]
    Tier2Fetch --> Step3
    Tier3Fetch --> Step3

    Step3 --> DynamicPrompt["🧠 Fused Smart Context Block\n• Beete hue kal ka poora hisaab\n• Aaj ka active update\n• 2 mahine purana solution\n• Natural Human Acknowledgment Directive"]

    DynamicPrompt --> Gemini["🤖 Gemini AI Companion (FRIDAY)"]
    Gemini --> FinalVoice["🔊 FRIDAY Speaks Naturally Like a Close Friend:\n'Arey Boss! Wahi connection pool timeout wali dikkat na\njo June me ERP project me aayi thi? Us waqt pool size 20 kiya tha!'"]
```

---

## 🛡️ SOTA Model Fallback Matrix

Hamare system me kisi bhi model ke failure, rate-limit ya quota error hone par agla model millisecond me background me switch ho jata hai:

| Task / Purpose | Primary Model | Fallback Chain |
| :--- | :--- | :--- |
| **Full Session Summaries** | `gemini-3.6-flash` | `gemini-3.5-flash` ➔ `gemini-3.5-flash-lite` ➔ `gemini-3.1-pro` ➔ `gemini-2.5-flash` |
| **"Aaj Ka Update" Overwrites** | `gemini-3.6-flash` | `gemini-3.5-flash` ➔ `gemini-3.5-flash-lite` ➔ `gemini-2.5-flash` ➔ Local Text Slice |
| **24h Scratch Summaries** | `gemini-3.6-flash` | `gemini-3.5-flash` ➔ `gemini-3.5-flash-lite` ➔ `gemini-2.5-flash` ➔ Key-Topic Digest |
| **Permanent Vector Embeddings** | `text-embedding-004` | `text-embedding-002` ➔ `embedding-001` ➔ Deterministic 768-dim Normalized Offline Vector |

---

## 🔐 Zero-Trust App Lock & Intrusion Defense System

FRIDAY includes an enterprise-grade **Zero-Trust Security Barrier** ([appSecurityService.ts](file:///c:/Users/HP/Desktop/mera-ai/src/services/appSecurityService.ts)) preventing unauthorized access to Boss's private life, memories, and voice sessions:

```mermaid
flowchart TD
    Client["🌐 User Opens Web Interface"] --> Gate{"🔑 App Lock Modal\nEnter Passkey"}
    
    Gate -->|"Correct Key"| GenerateToken["🎟️ Server Issues HMAC-SHA256 Session Token\n(Stored securely in client session)"]
    GenerateToken --> Unlock["🔓 Friday Unlocked!\nLive Voice & Memory Access Granted"]

    Gate -->|"Wrong Key (Attempt 1-2)"| RateLimit["⚠️ Rate Limiting Triggered\n(Max 2 attempts per 60s per IP)"]
    
    Gate -->|"3 Consecutive Wrong Keys"| BanIP["🚨 3-Strike Auto-Ban Executed!\n• IP added to Firestore 'blockedClients'\n• HTTP 403 Forbidden on all requests\n• Real-time intrusion alert sent to Boss"]
```

### 🛡️ App Security Highlights:
1. **Glassmorphic Passkey Gate:** Blocks all interaction until authenticated with the correct App Key.
2. **Anti-Brute Force (3-Strike Auto-Ban):** Any IP attempting 3 incorrect passkeys is permanently blacklisted in Firestore (`blockedClients` collection) and barred from connecting.
3. **Strict Rate Limiting:** Enforces maximum 2 verification requests per 60 seconds per IP.
4. **Zero-Trust WebSocket Verification:** Every WebSocket `/live` session must transmit a valid HMAC-signed session token. Unauthenticated connections are dropped instantly (`UNAUTHORIZED_APP_KEY`).
5. **Remote Passkey Control via Telegram & WhatsApp:** Boss can remotely inspect, change, or unban clients directly through chat:
   - `/appkey` — View the currently active App Key.
   - `/setappkey <new_key>` — Remotely change the App Key anytime.
   - `/unblock <ip>` — Unban a mistakenly blocked IP address.

---

## 🛠️ Project Structure

```
mera-ai/
├── server.ts                             # Core Express + WebSocket server, Gemini Live session & tool dispatch
├── src/
│   ├── services/
│   │   ├── memoryEngine.ts               # 4-Tier Memory Engine, 4-Day verbatim window & 60d vector archival
│   │   ├── dailyUpdateService.ts         # 30-Day "Aaj Ka Update" logs, status tracking & mid_term_summaries
│   │   ├── liveScratchService.ts         # Real-time crash-proof Firestore scratch cache & 24h lifecycle
│   │   ├── vectorMemoryService.ts        # Gemini text embeddings, cosine similarity & exact date filtering
│   │   ├── smartMemoryRetrieverService.ts# 3-Step Human-like Parallel Memory Fetcher & Prompt Synthesizer
│   │   ├── memoryNotificationService.ts  # Anti-Fake Firestore verification, Telegram & WhatsApp alert dispatcher
│   │   ├── fridayLearningService.ts      # Wisdom Vault, continual self-learning & humility protocol
│   │   ├── bossRoutineService.ts         # 24-Hour IST Habit Graph & active timetable slot tracker
│   │   ├── appSecurityService.ts         # Zero-Trust App Key, HMAC-SHA256 tokens & 3-strike IP auto-blocking
│   │   ├── telegramBotService.ts         # Telegram bot polling, message dispatcher & media vault
│   │   ├── whatsappService.ts            # WhatsApp Baileys integration & unified message sender
│   │   └── firebaseAdmin.ts              # Firebase Admin SDK with zero-downtime offline fallback
│   ├── components/
│   │   ├── LiveAIInterface.tsx           # Full-screen voice UI, live captions & settings
│   │   ├── AgentFace.tsx                 # Dynamic animated face with emotional lip-sync
│   │   └── ChatHistoryModal.tsx          # Real-time encrypted chat history viewer
│   └── App.tsx                           # React entry point
└── scratch/                              # Automated verification & test suites
```

---

## ⚙️ Environment Variables

Create a `.env` file in the root directory:

```env
# Gemini API Key (Required for Voice, Summarization, and Embeddings)
GEMINI_API_KEY=your_gemini_api_key_here

# Firebase Admin SDK Credentials (From Firebase Console Service Account JSON)
FIREBASE_PROJECT_ID=your_firebase_project_id
FIREBASE_CLIENT_EMAIL=your_service_account_client_email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"

# Chat Message Encryption at Rest (32+ character random string)
ENCRYPTION_KEY=your_32_character_random_encryption_key

# Telegram Bot Integration (Optional for Memory Alerts & Remote Control)
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_OWNER_CHAT_ID=your_telegram_numeric_chat_id

# WhatsApp Bot Integration (Optional for Memory Alerts & Voice Notes)
OWNER_WHATSAPP_NUMBER=91XXXXXXXXXX

# Server Configuration
PORT=3000
NODE_ENV=development
```

---

## 🚀 Quickstart & Development

### 1. Install Dependencies
```bash
npm install
```

### 2. Run TypeScript Validation
```bash
npx tsc --noEmit
```

### 3. Run Memory Verification Suites
```bash
# Verify 4-Tier Lifecycle & Batch Operations
npx tsx scratch/test_memory_lifecycle.ts

# Verify 3-Tier Parallel Smart Memory Retriever
npx tsx scratch/test_smart_retriever.ts

# Verify Zero Data-Loss 24h Buffer & Verified Bot Notifications
npx tsx scratch/test_zero_loss_lifecycle.ts
```

### 4. Start Local Development Server
```bash
npm run dev
```

Open `http://localhost:3000` to interact with Friday live in your browser!

---

## 🚢 Deployment (Render / Cloud Hosting)

1. Push the repository to GitHub.
2. In Render: **New → Web Service** connected to your repository.
3. Configure build & start commands:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
4. Add all environment variables in Render's **Environment** tab.
5. Deploy. All data is persisted in Firestore, requiring **zero persistent disk storage**!
