import { GoogleGenAI, Type } from "@google/genai";
import { geminiKeyPoolService } from "./geminiKeyPoolService";

export interface ClassifiedIntent {
  action: string;
  confidence: number;
  parameters: Record<string, any>;
  reasoning: string;
  originalText: string;
}

export interface IntentContext {
  platform: "whatsapp" | "telegram" | "voice" | "web";
  isGroup: boolean;
  isOwner: boolean;
  senderName: string;
  senderPhone: string;
  groupName?: string;
  quotedMessage?: string;
  recentMessages?: string[];
  timeOfDay: string;
  userTimezone: string;
}

const INTENT_FUNCTION_DECLARATIONS = [
  {
    name: "make_phone_call",
    description: "Trigger a real cellular phone call via Exotel to any number. Use when user explicitly wants to CALL someone (not message). Examples: 'call me', 'mujhe call karo', 'phone lagao', 'call 9876543210', 'call boss', 'ring me up'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        targetPhone: { type: Type.STRING, description: "10-digit phone number or contact name (e.g. 'Rahul', 'Ram') to call. If not specified or 'call me', call the owner/boss." },
        reason: { type: Type.STRING, description: "Why the call is being made (user's stated reason)" }
      },
      required: []
    }
  },
  {
    name: "send_whatsapp_message",
    description: "Send a WhatsApp message to a contact. Use when user wants to MESSAGE/TEXT someone (not call). Examples: 'Ram ko msg karo', 'message Rahul', 'bhej do message', 'whatsapp par bolo'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        contactNameOrPhone: { type: Type.STRING, description: "Contact name (e.g. 'Ram', 'Rahul') or phone number" },
        messageText: { type: Type.STRING, description: "The message content to send" }
      },
      required: ["contactNameOrPhone", "messageText"]
    }
  },
  {
    name: "save_contact",
    description: "Save a new contact to the address book. Examples: 'save contact Rahul 9876543210', 'isko save karo', 'number save kar do'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        contactName: { type: Type.STRING, description: "Name of the contact" },
        phoneNumber: { type: Type.STRING, description: "Phone number" },
        relation: { type: Type.STRING, description: "Optional relationship (friend, family, colleague, etc.)" }
      },
      required: ["contactName", "phoneNumber"]
    }
  },
  {
    name: "lookup_phone_details",
    description: "Look up phone number intelligence (Truecaller-style). Examples: 'ye number kiska hai', '9876543210 ki details', 'check this number', 'phone number lookup'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        phoneNumber: { type: Type.STRING, description: "Phone number to look up" }
      },
      required: ["phoneNumber"]
    }
  },
  {
    name: "play_music",
    description: "Search and play music/songs. Examples: 'gaana bajao', 'song play karo', 'Arijit Singh ka gaana', 'music chalu karo'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        songQuery: { type: Type.STRING, description: "Song name, artist, or genre to search" }
      },
      required: ["songQuery"]
    }
  },
  {
    name: "get_weather",
    description: "Get weather forecast. Examples: 'mausam kaisa hai', 'weather batao', 'aaj barish hogi kya', 'temperature kya hai'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        place: { type: Type.STRING, description: "City or location (default: user's city)" }
      },
      required: ["place"]
    }
  },
  {
    name: "get_news",
    description: "Get latest news headlines. Examples: 'news batao', 'aaj ki khabar', 'top 10 news', 'local news', 'sports news'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        topic: { type: Type.STRING, description: "News category: top 10, politics, local, sports, business, tech, viral, or city name" },
        count: { type: Type.NUMBER, description: "Number of headlines (default: 10)" }
      },
      required: ["topic"]
    }
  },
  {
    name: "set_reminder",
    description: "Set a reminder/alarm. Examples: 'remind me at 5pm', 'subah 6 baje uthana', '10 minute baad yaad dilana', 'alarm laga do'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: "What to remind about" },
        timeString: { type: Type.STRING, description: "When to remind (e.g. '5:00 PM', 'in 10 minutes', 'tomorrow 9am')" }
      },
      required: ["title", "timeString"]
    }
  },
  {
    name: "save_daily_update",
    description: "Save user's daily life update/log. Examples: 'aaj ka update note karo: khana kha liya', 'log karo: gym gaya tha', 'update save karo'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        updateText: { type: Type.STRING, description: "The update content to save" }
      },
      required: ["updateText"]
    }
  },
  {
    name: "get_daily_update",
    description: "Recall saved daily updates. Examples: 'aaj kya update tha', 'kal kya kiya tha', '3 din pehle kya update tha'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        dateWord: { type: Type.STRING, description: "Which day: 'aaj', 'kal', 'parso', '3 din pehle', etc." }
      },
      required: ["dateWord"]
    }
  },
  {
    name: "get_device_location",
    description: "Get the live GPS location / address of a tracked family device. Use when user asks WHERE someone is, their location, address, or live tracking. Examples: 'boss location', 'mera location kya hai', 'main kahan hoon', 'bhai kahan hai', 'papa ki location batao', 'mummy kahan hain', 'location batao', 'mera address', 'kahan hoon main', 'apna location batao', 'live location batao', 'track karo'. IMPORTANT: ALWAYS use this for location/address/kahan queries — NEVER use search_memory for these.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        personNameOrLabel: { type: Type.STRING, description: "Who to locate: 'boss', 'bhai', 'papa', 'mummy', 'wife', or device label. Default: 'boss' for self-location queries." }
      },
      required: []
    }
  },
  {
    name: "search_memory",
    description: "Search long-term memory/vector database for past CONVERSATIONS, DECISIONS, and TEXT FACTS only. Examples: 'pichle mahine kya discuss kiya tha', 'purani baat dhundho', '25 August ko kya bola tha'. IMPORTANT: Do NOT use this for location/GPS/address queries — use get_device_location instead.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        searchQuery: { type: Type.STRING, description: "What to search for in memory" },
        filterDate: { type: Type.STRING, description: "Optional specific date/month to filter (e.g. '2026-08-25', 'June 2026')" }
      },
      required: ["searchQuery"]
    }
  },
  {
    name: "remember_fact",
    description: "Permanently save an important personal fact. Examples: 'yaad rakhna: meri birthday 5 March hai', 'note karo: main vegetarian hoon', 'don't forget this'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        factText: { type: Type.STRING, description: "Exact fact to remember" },
        category: { type: Type.STRING, description: "Category: boss_identity, family_members, personal_secrets_and_facts, career_and_business, residence_and_lifestyle, general_personal_info" }
      },
      required: ["factText"]
    }
  },
  {
    name: "translate_text",
    description: "Translate text between languages. Examples: 'translate to English', 'is ka Hindi matlab batao', 'French me bolo'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        text: { type: Type.STRING, description: "Text to translate" },
        targetLanguage: { type: Type.STRING, description: "Target language name (e.g. 'English', 'Hindi', 'Spanish', 'French')" }
      },
      required: ["text", "targetLanguage"]
    }
  },
  {
    name: "generate_ai_image",
    description: "Generate AI image/photo. Examples: 'photo banao', 'image generate karo', 'AI picture banao ladki ki jungle me'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        prompt: { type: Type.STRING, description: "Detailed visual description" },
        aspectRatio: { type: Type.STRING, description: "Aspect ratio: '9:16' (portrait), '1:1' (square), '16:9' (landscape)" },
        sendToWhatsApp: { type: Type.BOOLEAN, description: "Whether to send to WhatsApp" }
      },
      required: ["prompt"]
    }
  },
  {
    name: "analyze_youtube_video",
    description: "Analyze YouTube video from URL. Examples: 'youtube.com/watch?v=... analyze karo', 'is video ka summary do', 'youtube video ka transcript'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        videoUrl: { type: Type.STRING, description: "YouTube video URL or ID" },
        question: { type: Type.STRING, description: "Optional specific question about the video" }
      },
      required: ["videoUrl"]
    }
  },
  {
    name: "get_cricket_scores",
    description: "Get live cricket scores. Examples: 'cricket score batao', 'India match ka score', 'live match kya chal raha hai'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        team: { type: Type.STRING, description: "Optional team filter" }
      },
      required: []
    }
  },
  {
    name: "search_web",
    description: "Search Google/browse web. Examples: 'Google par search karo', 'web pe dhundho', 'browse this website', 'online check karo'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "Search query or URL to browse" },
        action: { type: Type.STRING, description: "Action: 'google_search', 'browse', 'ecommerce_lookup', 'screenshot'" }
      },
      required: ["query", "action"]
    }
  },
  {
    name: "schedule_message",
    description: "Schedule a message for later. Examples: '5 bje message bhejna', 'kal subah 8 bje msg karo', 'schedule message for tomorrow'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        contactNameOrPhone: { type: Type.STRING, description: "Recipient contact name or phone" },
        messageBody: { type: Type.STRING, description: "Message to send" },
        timeInstruction: { type: Type.STRING, description: "When to send (e.g. 'in 15 minutes', 'tomorrow 9am', 'at 5:30 PM')" }
      },
      required: ["contactNameOrPhone", "messageBody", "timeInstruction"]
    }
  },
  {
    name: "create_cron_task",
    description: "Create recurring automated task. Examples: 'har roz 6 bje weather bhejna', 'daily morning news', 'har Monday briefing bhejna'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: "Task title" },
        timeString: { type: Type.STRING, description: "Time (e.g. '06:00 PM', '6:00 AM')" },
        frequency: { type: Type.STRING, description: "Frequency: 'daily', 'weekdays', 'weekends', 'monday', etc." },
        actionType: { type: Type.STRING, description: "Action: 'weather_update', 'news_briefing', 'custom_prompt'" },
        city: { type: Type.STRING, description: "City for weather (default: Patna)" },
        messageBody: { type: Type.STRING, description: "Custom message/prompt for custom_prompt action" }
      },
      required: ["title", "timeString", "actionType"]
    }
  },
  {
    name: "get_whatsapp_messages",
    description: "Read recent WhatsApp messages. Examples: 'koi message hai', 'whatsapp check karo', 'Rahul ne kya likha', 'group me kya baat hui'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        messageType: { type: Type.STRING, description: "Type: 'personal', 'group', 'all'" },
        senderName: { type: Type.STRING, description: "Filter by sender name" },
        groupName: { type: Type.STRING, description: "Filter by group name" },
        dateFilter: { type: Type.STRING, description: "Date filter: 'aaj', 'kal', '5 din pehle'" },
        limit: { type: Type.NUMBER, description: "Max messages" }
      },
      required: ["messageType"]
    }
  },
  {
    name: "get_conversation_history",
    description: "Get full conversation history with a contact. Examples: 'Ram se kya baat hui', 'Rahul ne kya msg kiya', 'conversation history dikhao'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        contactNameOrPhone: { type: Type.STRING, description: "Contact name or phone" },
        daysBack: { type: Type.NUMBER, description: "Days back to search (default: 7)" },
        limit: { type: Type.NUMBER, description: "Max messages (default: 30)" }
      },
      required: ["contactNameOrPhone"]
    }
  },
  {
    name: "set_routine",
    description: "Set/update daily routine or confirm routine/reminder suggestions from photos/documents. Examples: 'mera routine note karo: 7 bje uthna', 'gym ka time 7 bje kar do', 'routine me lunch 2 bje set karo', 'haan set kar do', 'routine set karo', 'photo wala routine save karo', 'schedule set kar do', 'haan routine bana do'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        slots: { type: Type.ARRAY, description: "Array of routine slots with title, startTimeStr, endTimeStr, activity", items: { type: Type.OBJECT, properties: { title: { type: Type.STRING, description: "Title of the slot" }, startTimeStr: { type: Type.STRING, description: "Start time" }, endTimeStr: { type: Type.STRING, description: "End time" }, activity: { type: Type.STRING, description: "Activity description" } } } },
        slotQuery: { type: Type.STRING, description: "Which slot to update (for single updates)" },
        startTimeStr: { type: Type.STRING, description: "New start time" },
        endTimeStr: { type: Type.STRING, description: "New end time" },
        activity: { type: Type.STRING, description: "Activity description" }
      },
      required: []
    }
  },
  {
    name: "get_routine",
    description: "Get current daily routine. Examples: 'mera routine kya hai', 'schedule dikhao', 'timetable batao', 'abhi kya karna chahiye'.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
      required: []
    }
  },
  {
    name: "group_admin_action",
    description: "Group admin actions (kick, ban, delete message, promote, demote). Examples: 'kick karo isko', 'delete this message', 'ban this user', 'make admin'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: "Action: 'kick', 'delete_message', 'promote', 'demote', 'mute', 'unmute'" },
        groupName: { type: Type.STRING, description: "Group name" },
        targetMember: { type: Type.STRING, description: "Member phone or name" },
        reason: { type: Type.STRING, description: "Reason for action" }
      },
      required: ["action", "groupName", "targetMember"]
    }
  },
  {
    name: "group_safety_toggle",
    description: "Toggle group safety features (anti-abuse, auto-transcribe, quiet mode, welcome). Examples: 'block safe on', 'auto transcribe on', 'quiet mode enable', 'welcome card on'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        groupName: { type: Type.STRING, description: "Group name" },
        feature: { type: Type.STRING, description: "Feature: 'block_safe', 'auto_transcribe', 'quiet_mode', 'welcome'" },
        enable: { type: Type.BOOLEAN, description: "true to enable, false to disable" }
      },
      required: ["groupName", "feature", "enable"]
    }
  },
  {
    name: "create_poll",
    description: "Create a poll in group. Examples: 'poll banao', 'voting start karo', 'poll dalo topic pe'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        topicOrQuestion: { type: Type.STRING, description: "Poll topic or question" }
      },
      required: ["topicOrQuestion"]
    }
  },
  {
    name: "generate_quiz",
    description: "Generate quiz/trivia. Examples: 'quiz banao', 'trivia question', 'general knowledge quiz'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        topic: { type: Type.STRING, description: "Quiz topic (e.g. 'Space', 'Cricket', 'JavaScript')" }
      },
      required: ["topic"]
    }
  },
  {
    name: "identify_song",
    description: "Identify song from humming/audio. Examples: 'ye gaana kaun sa hai', 'shazam karo', 'humming se pata karo'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        hasAudio: { type: Type.BOOLEAN, description: "Whether user sent voice/audio" }
      },
      required: ["hasAudio"]
    }
  },
  {
    name: "analyze_media",
    description: "Analyze image/document/video sent on WhatsApp. Examples: 'photo me kya hai', 'PDF padho', 'document analyze karo', 'image ka summary'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "Specific question about the media" }
      },
      required: ["query"]
    }
  },
  {
    name: "voice_mode_toggle",
    description: "Change voice tone for replies. Examples: 'ladki ki aawaz me bolo', 'male voice me reply karo', 'english voice use karo', 'voice change karo'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        voiceTone: { type: Type.STRING, description: "Voice tone: 'female', 'male', 'english'" }
      },
      required: ["voiceTone"]
    }
  },
  {
    name: "check_session_health",
    description: "Check WhatsApp bot session health, ban risk, or account safety status. Examples: 'session health kaisa hai', 'ban risk check karo', 'whatsapp ban status kya hai', 'whatsapp safe hai kya', 'account health'. Note: Do NOT use for posting/viewing personal WhatsApp Story/Status feed.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
      required: []
    }
  },
  {
    name: "unpause_bot",
    description: "Unpause bot if paused due to ban risk. Examples: 'bot chalu karo', 'unpause', 'resume bot', 'start bot'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        password: { type: Type.STRING, description: "App password if required" }
      },
      required: []
    }
  },
  {
    name: "teach_friday",
    description: "Teach Friday a new behavior/lesson. Examples: 'aise bolna seekho', 'sikhao: jab main gussa hoon to softly bolna', 'teach friday'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        situationTrigger: { type: Type.STRING, description: "When this applies (e.g. 'Jab Boss thake hue hon')" },
        taughtReaction: { type: Type.STRING, description: "How to react (e.g. 'Bohot softly baat karna, comfort dena')" },
        category: { type: Type.STRING, description: "Category: emotional_comfort, relationship_advice, social_etiquette, task_execution, voice_tone" }
      },
      required: ["situationTrigger", "taughtReaction"]
    }
  },
  {
    name: "correct_friday",
    description: "Correct Friday's mistake. Examples: 'galat bola tumne', 'aise nahi bolna chahiye', 'correction: maine ye nahi kaha tha'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        correctionText: { type: Type.STRING, description: "What was wrong and how to fix it" }
      },
      required: ["correctionText"]
    }
  },
  {
    name: "add_directive",
    description: "Add a strict rule/word replacement. Examples: 'mango ko frooti bolo', 'rule: aaj se tum X ko Y bologe', 'strict directive'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        ruleText: { type: Type.STRING, description: "Full directive text" },
        targetWord: { type: Type.STRING, description: "Word to replace" },
        replacementWord: { type: Type.STRING, description: "Replacement word" },
        type: { type: Type.STRING, description: "Type: 'word_replacement', 'behavior_rule', 'strict_order'" }
      },
      required: ["ruleText"]
    }
  },
  {
    name: "scan_website_security",
    description: "Scan a website/URL for vulnerabilities, phishing risk, security headers, SSL and exposed paths. Use when user says 'find vulnerabilities', 'find error in url', 'link scan karo', 'website security check karo', 'domain audit karo', 'ye link safe hai kya', 'scan url'. Examples: 'find vulnerabilities in example.com', 'find error in url xyz.com', 'scan https://example.com'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        urlOrDomain: { type: Type.STRING, description: "URL or domain to scan (e.g. 'example.com', 'https://example.com')" },
        scanMode: { type: Type.STRING, description: "Scan depth: 'deep' (vulnerabilities), 'audit' (headers/SSL/grade), 'link' (phishing safety). Default: 'deep'." }
      },
      required: ["urlOrDomain"]
    }
  },
  {
    name: "general_chat",
    description: "General conversation - no specific action needed. Just chat naturally. Use for greetings, casual talk, questions not covered above, emotional venting, etc.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        response: { type: Type.STRING, description: "Natural conversational response to give" }
      },
      required: ["response"]
    }
  }
];

class IntentClassifierService {
  private readonly models = [
    "gemini-3.8-flash",
    "gemini-3.5-flash",
    "gemini-3.6-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash-lite",
  ];

  async classifyIntent(userText: string, context: IntentContext): Promise<ClassifiedIntent> {
    if (!geminiKeyPoolService.hasAvailableKey()) {
      return this.fallbackClassification(userText, context);
    }

    const priority = context.isOwner ? "boss" : context.isGroup ? "public" : "background";
    const systemPrompt = this.buildSystemPrompt(context);

    // Try each model in the 5-model chain sequentially with predictive key allocation
    for (const model of this.models) {
      const allocation = geminiKeyPoolService.getOptimalClient({ priority });
      const ai = allocation.client;

      try {
        const response = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: userText }] }],
          config: {
            systemInstruction: systemPrompt,
            tools: [{ functionDeclarations: INTENT_FUNCTION_DECLARATIONS as any }],
            toolConfig: { functionCallingConfig: { mode: "ANY" as any } },
            temperature: 0.1,
            maxOutputTokens: 1024,
          },
        });

        geminiKeyPoolService.recordSuccess(allocation.keyIndex);

        // Robust functionCall extraction:
        // 1. response.functionCalls accessor in @google/genai
        // 2. Search parts array for any part containing functionCall (handles thinking/prelude parts)
        let functionCall: any = null;
        if (response.functionCalls && response.functionCalls.length > 0) {
          functionCall = response.functionCalls[0];
        } else {
          const parts = response.candidates?.[0]?.content?.parts || [];
          const partWithCall = parts.find((p: any) => p && p.functionCall);
          if (partWithCall) {
            functionCall = partWithCall.functionCall;
          }
        }

        if (functionCall && functionCall.name) {
          return {
            action: functionCall.name,
            confidence: 0.95,
            parameters: (functionCall.args as Record<string, any>) || {},
            reasoning: `LLM (${model}) classified intent as ${functionCall.name} based on natural language understanding`,
            originalText: userText
          };
        }

        // If no function call, it's general chat
        const textResponse = response.text?.trim() || "";
        return {
          action: "general_chat",
          confidence: 0.9,
          parameters: { response: textResponse },
          reasoning: `LLM (${model}) responded naturally without tool call - general conversation`,
          originalText: userText
        };
      } catch (error: any) {
        console.warn(`[IntentClassifier] Model ${model} on Key #${allocation.keyIndex + 1} failed, trying next:`, error?.message || error);
        const errMsg = String(error?.message || error);
        if (error?.status === 429 || errMsg.includes("429") || errMsg.includes("RESOURCE_EXHAUSTED")) {
          geminiKeyPoolService.recordRateLimitError(allocation.keyIndex);
        } else {
          geminiKeyPoolService.recordGenericError(allocation.keyIndex);
        }
        // Continue to next model in the chain
      }
    }

    console.warn("[IntentClassifier] All 5 LLM models failed or exhausted, using fallback classification.");
    return this.fallbackClassification(userText, context);
  }

  private buildSystemPrompt(context: IntentContext): string {
    const { platform, isGroup, isOwner, senderName, groupName, timeOfDay, quotedMessage } = context;
    
    return `You are FRIDAY, an intelligent AI assistant for Boss DK (Divakar). Classify the user's intent and call the appropriate function.

CONTEXT:
- Platform: ${platform}
- Chat type: ${isGroup ? `Group: "${groupName}"` : "Private 1-on-1"}
- User: ${senderName} (${isOwner ? "BOSS/OWNER" : "Regular contact"})
- Time: ${timeOfDay} IST
${quotedMessage ? `- Quoted/Replied to: "${quotedMessage}"` : ""}

CRITICAL RULES:
1. **CALL vs MESSAGE**: "call me", "mujhe call karo", "phone lagao" → make_phone_call (real cellular call via Exotel)
   "message me", "msg karo", "bhej do", "whatsapp par bolo" → send_whatsapp_message
   
2. **OWNER PRIVILEGES**: Only the OWNER can: make calls, set reminders, save updates, manage routine, teach/correct Friday, add directives, check session health, unpause bot, admin group actions.

3. **GROUP CONTEXT**: In groups, non-owner commands like @song, @poll, @quiz, safety toggles work for everyone. Admin actions only for owner/admins.

4. **QUOTED MESSAGE**: If user replied to a message, the action likely relates to that content (e.g. "summary" on quoted PDF, "translate" on quoted text, "call" on quoted number).

5. **NATURAL LANGUAGE**: Understand Hindi/Hinglish naturally. "abhi call karo" = call now. "baad me call karna" = schedule call. "isko save karo" = save contact. "ye kiska number" = lookup.

6. **AMBIGUOUS CASES**: 
   - "Ram ko contact karo" → Could be call OR message. Check context: if urgent/immediate → call. If info-sharing → message.
   - "number do" → Could be save contact OR lookup. Check: "save karo" = save, "kiska hai" = lookup.

7. **WHATSAPP STATUS vs BAN HEALTH DISAMBIGUATION**:
   - If user asks about ban risk, account safety, session health, or bot health ("whatsapp ban status", "session health kaisa hai", "whatsapp safe hai na", "account ban risk") → check_session_health.
   - If user asks about their personal WhatsApp Story/Status post ("mera status laga do", "whatsapp par status dalo", "status post karo", "story update") → Personal WhatsApp Story/Status, NOT check_session_health.

8. **ROUTINE / SCHEDULE CONFIRMATION**:
   - If user confirms routine/timetable suggestions or says "haan set kar do", "routine set karo", "photo wala routine save karo", "schedule set kar do", "haan routine bana do", "set routine", "reminders set kar do" → call set_routine!

9. **TEXT / VOICE SCHEDULE DETECTION**:
   - If Boss verbally describes a schedule or timetable (e.g. "somwar ko 9 bje school hai", "monday 9am school, tuesday 7am gym", "mera routine: subah 7 uthna, 9 bje office, raat 10 sona", "mere schedule me likha hai...") → use general_chat BUT format the reply EXACTLY like:

   🗓️ *Schedule / Routine:*
   Monday [9:00 AM] → School
   Tuesday [7:00 AM] → Gym
   Wednesday [10:00 PM] → Sleep
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   🔔 *Boss, kya main yeh schedule set kar doon?*
   Reply karo: _"Haan set kar do"_ ya _"Set routine"_

10. **NO FUNCTION MATCH**: If no function fits, use general_chat with a natural response.

Be decisive. One function call per classification.`;
  }

  private fallbackClassification(userText: string, context: IntentContext): ClassifiedIntent {
    const clean = userText.toLowerCase().trim();

    // 1. Phone Call Intent
    if (
      !/\b(?:remind|alarm|yaad\s*dila)\b/i.test(clean) &&
      (/\b(call\s*(?:me|karo|lagao|karna)|mujhe\s*call|phone\s*(?:karo|lagao)|ring\s*me)\b/i.test(clean) ||
      /(?:ko|par)\s*(?:call|phone)\s*(?:lagao|karo)/i.test(clean) ||
      /\bcall\s+(?:(?:\+?91[\s-]?)?[6-9]\d{9}|[a-zA-Z\u0900-\u097F]+)/i.test(clean))
    ) {
      const phoneMatch = userText.match(/(?:\+91[\s-]?)?[6-9]\d{9}/);
      const nameMatch = userText.match(/([a-zA-Z\u0900-\u097F]+)\s*ko\s*(?:call|phone)/i) ||
                        userText.match(/\bcall\s+([a-zA-Z\u0900-\u097F]+)/i);
      const target = phoneMatch ? phoneMatch[0].replace(/\D/g, "") : (nameMatch ? nameMatch[1].trim() : undefined);
      return {
        action: "make_phone_call",
        confidence: 0.8,
        parameters: { targetPhone: target, reason: userText },
        reasoning: "Fallback offline regex match for call intent",
        originalText: userText
      };
    }

    // 2. Send WhatsApp Message Intent
    if (/\b(?:msg|message|whatsapp|bhej|send)\b/i.test(clean) && (/\b(?:ko|to)\b/i.test(clean) || /:\s*.+/i.test(userText))) {
      const contactMatch = userText.match(/([a-zA-Z0-9+\s]+)\s*(?:ko|to)\s*(?:msg|message|whatsapp|bhejo|karo)/i) ||
                           userText.match(/(?:msg|message|whatsapp)\s*(?:to|karo)\s*([a-zA-Z0-9+\s]+?)(?::|\s+ki\s+|\s+bolo\s+|$)/i);
      const msgMatch = userText.match(/:\s*(.+)$/i) ||
                       userText.match(/\b(?:ki|that|bolo)\s+(.+)$/i) ||
                       userText.match(/(?:msg|message)\s*:\s*(.+)$/i);
      const targetContact = contactMatch ? contactMatch[1].replace(/^(send|bhejo|karo)\s+/i, "").trim() : "contact";
      const messageBody = msgMatch ? msgMatch[1].trim() : userText;

      return {
        action: "send_whatsapp_message",
        confidence: 0.75,
        parameters: { contactNameOrPhone: targetContact, messageText: messageBody },
        reasoning: "Fallback offline regex match for WhatsApp messaging intent",
        originalText: userText
      };
    }

    // 3. Music / Songs Intent
    if (/\b(?:gaana|gana|song|music)\s*(?:bajao|play|chalu|lagao|sunao)\b/i.test(clean) || /\b(?:play|bajao)\s+(?:song|music|gaana)\b/i.test(clean) || /^(?:play|gaana)\s+(.+)/i.test(clean)) {
      const songQuery = userText
        .replace(/^(?:play|gaana\s*bajao|song\s*play\s*karo|music\s*chalu\s*karo|gaana\s*lagao|suno|sunao)\s*/i, "")
        .replace(/\s*(?:ka\s*gaana|ka\s*song|song|gaana|bajao|chalu\s*karo|play\s*karo)$/i, "")
        .trim();
      return {
        action: "play_music",
        confidence: 0.85,
        parameters: { songQuery: songQuery || "Arijit Singh" },
        reasoning: "Fallback offline regex match for music playback intent",
        originalText: userText
      };
    }

    // 4. Weather Forecast Intent
    if (/\b(?:mausam|weather|temperature|barish)\b/i.test(clean)) {
      const placeMatch = userText.match(/([a-zA-Z]+)\s+(?:ka|ki|me|ke)\s+(?:mausam|weather)/i) ||
                        userText.match(/(?:in|of)\s+([a-zA-Z]+)/i) ||
                        userText.match(/([a-zA-Z]+)\s+me\b/i) ||
                        userText.match(/(?:mausam|weather)\s+(?:in|of|ka)?\s*([a-zA-Z]+)/i);
      const rawPlace = placeMatch ? placeMatch[1].trim() : "Patna";
      const place = /\b(aaj|kal|parso|abhi|barish|kya)\b/i.test(rawPlace) ? "Patna" : rawPlace;
      return {
        action: "get_weather",
        confidence: 0.85,
        parameters: { place },
        reasoning: "Fallback offline regex match for weather intent",
        originalText: userText
      };
    }

    // 5. News Headlines Intent
    if (/\b(?:news|khabar|headlines|samachar)\b/i.test(clean) && !/\b(?:google|search\s*karo|browse\s*web|web\s*search)\b/i.test(clean)) {
      let topic = "top 10";
      if (/sports|cricket/i.test(clean)) topic = "sports";
      else if (/tech|technology/i.test(clean)) topic = "tech";
      else if (/politics|rajniti/i.test(clean)) topic = "politics";
      else if (/business|market/i.test(clean)) topic = "business";
      return {
        action: "get_news",
        confidence: 0.85,
        parameters: { topic, count: 5 },
        reasoning: "Fallback offline regex match for news intent",
        originalText: userText
      };
    }

    // 6. Reminder / Alarm Intent
    if (/\b(?:remind|reminder|alarm|yaad\s*dila(?:na|o))\b/i.test(clean)) {
      const timeMatch = userText.match(/(?:at|ko|baje|in|after)\s*([0-9]+(?::[0-9]+)?\s*(?:am|pm|baje|minute|min|hour|ghante)?)/i) ||
                        userText.match(/([0-9]+(?::[0-9]+)?\s*(?:am|pm|baje))/i);
      const timeString = timeMatch ? timeMatch[0].trim() : "in 15 minutes";
      const title = userText.replace(/^(?:remind\s*me|reminder\s*lagao|alarm\s*laga\s*do|yaad\s*dilana)\s*/i, "").trim() || "Reminder";
      return {
        action: "set_reminder",
        confidence: 0.8,
        parameters: { title, timeString },
        reasoning: "Fallback offline regex match for reminder intent",
        originalText: userText
      };
    }

    // 7. Save Daily Update Intent
    if (/\b(?:aaj\s*ka\s*update\s*(?:note|save|likho)|update\s*(?:note|save|log)\s*karo|log\s*karo)\b/i.test(clean)) {
      const updateText = userText.replace(/^.*?(?:note|save|log|likho)\s*(?:karo)?:?\s*/i, "").trim() || userText;
      return {
        action: "save_daily_update",
        confidence: 0.85,
        parameters: { updateText },
        reasoning: "Fallback offline regex match for daily update logging",
        originalText: userText
      };
    }

    // 8. Recall Daily Update Intent
    if (/\b(?:(?:aaj|kal|parso|\d+\s*din\s*pehle)\s*(?:ka\s*)?(?:kya\s*update\s*tha|update\s*kya\s*tha|update\s*(?:batao|dikhao))|update\s*(?:kya\s*tha|batao|dikhao)|(?:kya|koi)\s*update\s*tha)\b/i.test(clean)) {
      let dateWord = "aaj";
      if (/kal/i.test(clean)) dateWord = "kal";
      else if (/parso/i.test(clean)) dateWord = "parso";
      else if (/(\d+)\s*din\s*pehle/i.test(clean)) dateWord = clean.match(/(\d+\s*din\s*pehle)/i)?.[1] || "kal";
      return {
        action: "get_daily_update",
        confidence: 0.85,
        parameters: { dateWord },
        reasoning: "Fallback offline regex match for recalling daily update",
        originalText: userText
      };
    }

    // 0. ⭐ LOCATION / GPS TRACKING INTENT (must be before memory search!)
    if (
      /\b(?:location|live\s*location|gps|track|tracking|address|kahan\s*(?:hai|hoon|ho|hain)|kahan\s*(?:pe|par)\s*(?:hai|hoon)|apna\s*(?:location|address|pata)|mera\s*(?:location|address|pata)|main\s*kahan|mera\s*location|boss\s*location|location\s*batao|location\s*kya\s*hai|abhi\s*kahan|location\s*dhuncho|live\s*track)\b/i.test(clean)
    ) {
      // Extract person name from query
      const personMatch =
        userText.match(/\b(bhai|bhaiya|papa|mummy|maa|wife|biwi|husband|pati|didi|behen|boss|dk|divakar)\b/i)?.[1] ||
        userText.match(/([a-zA-Z\u0900-\u097F]+)\s+(?:ki\s+location|ki\s+location\s+batao|kahan\s+(?:hai|hain))/i)?.[1];
      const label = personMatch?.toLowerCase() || "boss";
      return {
        action: "get_device_location",
        confidence: 0.9,
        parameters: { personNameOrLabel: label },
        reasoning: "Fallback offline regex match for device location/GPS tracking intent",
        originalText: userText
      };
    }

    // 9. Memory Search Intent
    if (/\b(?:purani\s*baat\s*(?:dhundho|batao)|memory\s*me\s*search\s*karo|yaad\s*hai\s*maine\s*(?:kya|kab)|kya\s*discuss\s*kiya\s*tha)\b/i.test(clean)) {
      const searchQuery = userText.replace(/^(?:purani\s*baat\s*dhundho|memory\s*me\s*search\s*karo|yaad\s*hai)\s*:?\s*/i, "").trim();
      return {
        action: "search_memory",
        confidence: 0.8,
        parameters: { searchQuery: searchQuery || userText },
        reasoning: "Fallback offline regex match for memory search intent",
        originalText: userText
      };
    }

    // 10. Remember Permanent Fact Intent
    if (/\b(?:yaad\s*rakhna|note\s*kar\s*lo|don'?t\s*forget|permanent\s*(?:memory\s*)?(?:note|save))\b/i.test(clean)) {
      const factText = userText.replace(/^.*?(?:yaad\s*rakhna|note\s*kar\s*lo|don'?t\s*forget)\s*:?\s*/i, "").trim();
      return {
        action: "remember_fact",
        confidence: 0.85,
        parameters: { factText: factText || userText, category: "general_personal_info" },
        reasoning: "Fallback offline regex match for remembering personal fact",
        originalText: userText
      };
    }

    // 11. Routine Get/Set Intent
    if (/\b(?:mera\s*routine|timetable|schedule\s*dikhao|routine\s*batao|abhi\s*kya\s*(?:karna\s*hai|routine\s*hai))\b/i.test(clean)) {
      return {
        action: "get_routine",
        confidence: 0.85,
        parameters: {},
        reasoning: "Fallback offline regex match for routine query",
        originalText: userText
      };
    }
    if (
      /\b(?:(?:haan\s*)?(?:set\s*kar\s*do|routine\s*(?:me\s*set|set\s*karo|save\s*karo|bana\s*do|banao)|photo\s*(?:ka|wala)?\s*routine|schedule\s*set\s*karo|reminders?\s*set\s*kar\s*do)|save\s*routine|set\s*routine)\b/i.test(clean) ||
      /^(?:haan\s*,?\s*)?(?:set\s*kar\s*do|routine\s*set\s*karo|routine\s*bana\s*do|reminders?\s*set\s*karo|kar\s*do\s*set)$/i.test(clean) ||
      /\b(?:routine\s*(?:me\s*set|update|badlo))\b/i.test(clean)
    ) {
      return {
        action: "set_routine",
        confidence: 0.85,
        parameters: { activity: userText },
        reasoning: "Fallback offline regex match for routine confirmation/update",
        originalText: userText
      };
    }

    // 12. Translation Intent
    if (/\b(?:translate\s*(?:to|karo|into)|is\s*ka\s*(?:hindi|english)\s*matlab)\b/i.test(clean)) {
      const targetLanguage = /hindi/i.test(clean) ? "Hindi" : /spanish/i.test(clean) ? "Spanish" : /french/i.test(clean) ? "French" : "English";
      const textToTranslate = userText.replace(/^.*?translate\s*(?:to\s*[a-zA-Z]+)?\s*:?\s*/i, "").trim() || userText;
      return {
        action: "translate_text",
        confidence: 0.85,
        parameters: { text: textToTranslate, targetLanguage },
        reasoning: "Fallback offline regex match for translation",
        originalText: userText
      };
    }

    // 13. AI Image Generation Intent
    if (/\b(?:(?:photo|image|picture|pic)\s*(?:banao|generate\s*karo)|generate\s*(?:ai\s*)?image)\b/i.test(clean)) {
      const prompt = userText.replace(/^.*?(?:photo\s*banao|image\s*generate\s*karo|generate\s*image)\s*:?\s*/i, "").trim() || userText;
      return {
        action: "generate_ai_image",
        confidence: 0.85,
        parameters: { prompt, aspectRatio: "9:16", sendToWhatsApp: true },
        reasoning: "Fallback offline regex match for AI image generation",
        originalText: userText
      };
    }

    // 14. Cricket Scores Intent
    if (/\b(?:cricket\s*score|match\s*score|india\s*score|live\s*score)\b/i.test(clean)) {
      return {
        action: "get_cricket_scores",
        confidence: 0.85,
        parameters: { team: /india/i.test(clean) ? "India" : undefined },
        reasoning: "Fallback offline regex match for cricket score query",
        originalText: userText
      };
    }

    // 15. Google Web Search Intent
    if (/\b(?:google\s*(?:par|pe)?\s*search\s*karo|web\s*(?:par|pe)?\s*dhundho|search\s*on\s*google)\b/i.test(clean)) {
      const query = userText.replace(/^.*?(?:search\s*karo|dhundho|search\s*on\s*google)\s*:?\s*/i, "").trim() || userText;
      return {
        action: "search_web",
        confidence: 0.8,
        parameters: { query, action: "google_search" },
        reasoning: "Fallback offline regex match for web search",
        originalText: userText
      };
    }

    // 16. Session Health / Ban Risk Status Intent (Guarded against Boss's personal WhatsApp Story/Status)
    if (
      /\b(?:session\s*health|ban\s*(?:risk|status)|whatsapp\s*(?:ban\s*status|safe\s*hai)|account\s*health|bot\s*health)\b/i.test(clean) &&
      !/\b(?:mera\s*status|status\s*(?:lagao|dalo|post|bhejo|update)|story)\b/i.test(clean)
    ) {
      return {
        action: "check_session_health",
        confidence: 0.85,
        parameters: {},
        reasoning: "Fallback offline regex match for session health check",
        originalText: userText
      };
    }

    // 16b. Unpause Bot Intent
    if (/\b(?:unpause|bot\s*(?:chalu|resume|start)|resume\s*bot|start\s*bot)\b/i.test(clean)) {
      return {
        action: "unpause_bot",
        confidence: 0.85,
        parameters: {},
        reasoning: "Fallback offline regex match for unpause bot",
        originalText: userText
      };
    }

    // 17. Website security scan fallback (works even when LLM is down)
    if (/\b(find\s+(vulnerabilit|vuln|weak\s*point|weakness|data\s*leak|leak|bug|error|issue)|vulnerability\s*scan|deep\s*scan|nikto|website\s*security|domain\s*audit|security\s*audit|link\s*scan|scan.*(url|link|website|domain)|audit\s*(website|domain|url|site)|phishing)\b/i.test(clean)) {
      const urlMatch =
        userText.match(/https?:\/\/[^\s"'<>\]\)]+/i) ||
        userText.match(/www\.[^\s"'<>\]\)]+/i) ||
        userText.match(/["'“”]([^"'“”\s]{3,120})["'“”]/) ||
        userText.match(/\b((?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s"'<>\]\)]*)?)/i);
      const scanTarget = (urlMatch?.[1] || urlMatch?.[0] || "").replace(/[.,;:!?'"\])]+$/g, "").trim();
      if (scanTarget) {
        const scanMode = /(?:vulnerabilit|vuln|weak|data\s*leak|bug|error|nikto|deep\s*scan)/i.test(clean)
          ? "deep"
          : /audit|website\s*security|domain|grade|security\s*check/i.test(clean)
            ? "audit"
            : "link";
        return {
          action: "scan_website_security",
          confidence: 0.75,
          parameters: { urlOrDomain: scanTarget, scanMode },
          reasoning: "Fallback regex match for website security scan intent",
          originalText: userText
        };
      }
    }

    // 18. Default natural chat fallback
    return {
      action: "general_chat",
      confidence: 0.5,
      parameters: { response: "Haanji boss, bataiye kya kaam hai?" },
      reasoning: "Fallback: no clear intent detected, responding naturally",
      originalText: userText
    };
  }
}

export const intentClassifierService = new IntentClassifierService();