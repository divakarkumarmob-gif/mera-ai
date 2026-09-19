import { GoogleGenAI, Type } from "@google/genai";

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
        targetPhone: { type: Type.STRING, description: "10-digit phone number to call. If not specified, call the owner/boss." },
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
    name: "search_memory",
    description: "Search long-term memory/vector database for past conversations, decisions, facts. Examples: 'pichle mahine kya discuss kiya tha', 'purani baat dhundho', '25 August ko kya bola tha'.",
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
    description: "Set/update daily routine. Examples: 'mera routine note karo: 7 bje uthna', 'gym ka time 7 bje kar do', 'routine me lunch 2 bje set karo'.",
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
    description: "Check WhatsApp session health/ban risk. Examples: 'session health kaisa hai', 'ban risk check karo', 'whatsapp safe hai kya', 'account health'.",
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
  private ai: GoogleGenAI | null = null;
  private model = "gemini-3.5-flash-lite";

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (apiKey) {
      this.ai = new GoogleGenAI({ apiKey });
    }
  }

  async classifyIntent(userText: string, context: IntentContext): Promise<ClassifiedIntent> {
    if (!this.ai) {
      return this.fallbackClassification(userText, context);
    }

    const systemPrompt = this.buildSystemPrompt(context);
    
    try {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: [{ role: "user", parts: [{ text: userText }] }],
        config: {
          systemInstruction: systemPrompt,
          tools: [{ functionDeclarations: INTENT_FUNCTION_DECLARATIONS as any }],
          toolConfig: { functionCallingConfig: { mode: "ANY" as any } },
          temperature: 0.1,
          maxOutputTokens: 1024,
        },
      });

      const functionCall = response.candidates?.[0]?.content?.parts?.[0]?.functionCall;
      
      if (functionCall) {
        return {
          action: functionCall.name,
          confidence: 0.95,
          parameters: functionCall.args as Record<string, any>,
          reasoning: `LLM classified intent as ${functionCall.name} based on natural language understanding`,
          originalText: userText
        };
      }

      // If no function call, it's general chat
      const textResponse = response.text?.trim() || "";
      return {
        action: "general_chat",
        confidence: 0.9,
        parameters: { response: textResponse },
        reasoning: "LLM responded naturally without tool call - general conversation",
        originalText: userText
      };

    } catch (error: any) {
      console.warn("[IntentClassifier] LLM classification failed, using fallback:", error?.message);
      return this.fallbackClassification(userText, context);
    }
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

7. **NO FUNCTION MATCH**: If no function fits, use general_chat with a natural response.

Be decisive. One function call per classification.`;
  }

  private fallbackClassification(userText: string, context: IntentContext): ClassifiedIntent {
    const clean = userText.toLowerCase().trim();
    
    // Minimal fallback patterns only for critical functions when LLM fails
    if (/\b(call\s*(?:me|karo|lagao)|mujhe\s*call|phone\s*(?:karo|lagao)|ring\s*me)\b/i.test(clean)) {
      const phoneMatch = userText.match(/(?:\+91[\s-]?)?[6-9]\d{9}/);
      return {
        action: "make_phone_call",
        confidence: 0.7,
        parameters: { targetPhone: phoneMatch ? phoneMatch[0].replace(/\D/g, "") : undefined, reason: userText },
        reasoning: "Fallback regex match for call intent",
        originalText: userText
      };
    }

    if (/\b(?:msg|message|whatsapp|bhej|send)\b/i.test(clean) && /\b(?:ko|to)\b/i.test(clean)) {
      return {
        action: "general_chat",
        confidence: 0.6,
        parameters: { response: "Samajh gayi boss. Kaun ko message karna hai aur kya likhna hai, bataiye?" },
        reasoning: "Fallback: detected message intent but need clarification",
        originalText: userText
      };
    }

    // Website security scan fallback (works even when LLM is down)
    if (/\b(find\s+(vulnerabilit|vuln|weak\s*point|weakness|data\s*leak|leak|bug|error|issue)|vulnerability\s*scan|deep\s*scan|nikto|website\s*security|domain\s*audit|security\s*audit|link\s*scan|scan.*(url|link|website|domain)|audit\s*(website|domain|url|site)|phishing)\b/i.test(clean)) {
      const urlMatch =
        userText.match(/https?:\/\/[^\s"'<>\]\)]+/i) ||
        userText.match(/www\.[^\s"'<>\]\)]+/i) ||
        userText.match(/["'“”]([^"'“”\s]{3,120})["'“”]/) ||
        userText.match(/\b((?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s"'<>\]\)]*)?)/i);
      const scanTarget = (urlMatch?.[1] || urlMatch?.[0] || "").replace(/[.,;:!?'"\])]+$/g, "").trim();
      if (scanTarget) {
        const scanMode = /find\s+(vulnerabilit|vuln|weak|data\s*leak|bug|error)|nikto|deep\s*scan|vulnerability\s*scan/i.test(clean)
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