import { circadianEnergyEngine } from "./circadianEnergyEngine";

export type SpeechEmotion =
  | "warm_caring"
  | "playful_cheerful"
  | "sleepy_soothing"
  | "laser_focus"
  | "empathetic_consoling"
  | "excited_celebration"
  | "natural_conversational";

export interface ProsodyParameters {
  emotion: SpeechEmotion;
  edgeProsody: {
    pitch?: string; // e.g. "+0Hz", "-2Hz", "+2Hz"
    rate?: string | number; // e.g. "0.94", "1.0", "1.05"
    volume?: string;
  };
  sarvamProsody: {
    pitch: number; // e.g. -1, 0, 1
    pace: number; // e.g. 0.92, 1.0, 1.06
    loudness: number;
  };
  vibeDescription: string;
}

export class HumanSpeechProsodyEngine {
  /**
   * Cleans text and infuses natural human acoustic cadence, micro-pauses, and pronunciation
   * so the neural TTS engine sounds like an authentic living human voice note.
   */
  public humanizeTextForSpeech(
    rawText: string,
    options?: {
      isBoss?: boolean;
      userPrompt?: string;
      emotionOverride?: SpeechEmotion;
    }
  ): { cleanSpokenText: string; prosody: ProsodyParameters } {
    if (!rawText || !rawText.trim()) {
      return {
        cleanSpokenText: "",
        prosody: this.getProsodyParameters("natural_conversational"),
      };
    }

    const emotion = options?.emotionOverride || this.detectSpeechEmotion(rawText, options?.userPrompt);
    const prosody = this.getProsodyParameters(emotion);

    let text = rawText.trim();

    // 1. Strip technical code blocks and inline code
    text = text.replace(/```[\s\S]*?```/g, "Code aapke screen par bhej diya hai.");
    text = text.replace(/`([^`]+)`/g, "$1");

    // 2. Strip URLs (convert to spoken "link")
    text = text.replace(/https?:\/\/\S+/g, "link");

    // 3. Remove markdown headers, blockquotes, bullets, dividers
    text = text.replace(/^#+\s+/gm, "");
    text = text.replace(/^>\s+/gm, "");
    text = text.replace(/^[-*+]\s+/gm, "");
    text = text.replace(/^\d+\.\s+/gm, "");
    text = text.replace(/^[━─=-]{3,}/gm, "");

    // 4. Remove markdown styling symbols (*, _, ~, |)
    text = text.replace(/\*\*(.*?)\*\*/g, "$1");
    text = text.replace(/\*(.*?)\*/g, "$1");
    text = text.replace(/_(.*?)_/g, "$1");
    text = text.replace(/~(.*?)~/g, "$1");
    text = text.replace(/\|/g, " ");

    // 5. Convert technical symbols to spoken Hindi words
    text = text.replace(/\s*%\s*/g, " percent ");
    text = text.replace(/\s*&\s*/g, " aur ");
    text = text.replace(/\s*\+\s*/g, " plus ");
    text = text.replace(/\s*\/\s*/g, " ya ");
    text = text.replace(/\bvs\b/gi, " versus ");
    text = text.replace(/₹\s*(\d+)/g, "$1 rupaye");
    text = text.replace(/\$\s*(\d+)/g, "$1 dollars");

    // 6. Strip emojis (TTS engines often awkwardly read emoji names out loud)
    text = text.replace(
      /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1FA70}-\u{1FAFF}]/gu,
      ""
    );

    // 7. Humanized Breath & Micro-Pause Infusion (Acoustic Punctuation)
    // Add natural breath commas and ellipses where humans naturally pause to breathe
    text = text.replace(/([.!?])\s+/g, "$1... ");
    text = text.replace(/\s*-\s*/g, " — ");
    text = text.replace(/\s{2,}/g, " ");

    // 8. Affective Human Opening Infusion (Disfluency & Conversational Touch)
    // Only if not already present and text is conversational
    const lower = text.toLowerCase();
    const hasOpening = /^(haan|haanji|ji boss|boss|arey|suno|hmm|achha|dekhiye)/i.test(lower);
    if (!hasOpening && options?.isBoss !== false) {
      if (emotion === "sleepy_soothing") {
        text = `Haanji Boss... ${text}`;
      } else if (emotion === "excited_celebration") {
        text = `Arey wah Boss! ${text}`;
      } else if (emotion === "empathetic_consoling") {
        text = `Boss... suniye na, ${text}`;
      } else if (emotion === "warm_caring") {
        text = `Haanji Boss, ${text}`;
      }
    }

    return {
      cleanSpokenText: text.trim(),
      prosody,
    };
  }

  /**
   * Detects conversational emotion from the incoming Boss message, Friday's reply, and time of day
   */
  public detectSpeechEmotion(replyText: string, userPrompt?: string): SpeechEmotion {
    const replyLower = replyText.toLowerCase();
    const promptLower = (userPrompt || "").toLowerCase();
    const { hours } = circadianEnergyEngine.getISTTime();

    // 1. Late Night / Sleepy / Whisper vibe (10:30 PM - 5:30 AM)
    if (hours >= 22.5 || hours < 5.5) {
      if (/neend|sona|sleep|thak|late|night|subah|thakan|rest|goodnight|shubh|so jao/i.test(replyLower + " " + promptLower)) {
        return "sleepy_soothing";
      }
    }

    // 2. Empathetic / Consoling (when Boss is sad, anxious, stressed, or sick)
    if (
      /sad|dard|chinta|tension|stress|bura|pareshaan|pareshan|mood kharab|tabiyat|sick|doctor|heartbreak|rona|akela/i.test(
        promptLower + " " + replyLower
      )
    ) {
      return "empathetic_consoling";
    }

    // 3. Excited / Celebration / Victory (wins, high scores, celebrations, good news)
    if (
      /kamaal|congrats|mubarak|congratulations|jeet|win|winner|booyah|headshot|party|badiya|shandar|zabardast|rock/i.test(
        promptLower + " " + replyLower
      )
    ) {
      return "excited_celebration";
    }

    // 4. Playful / Cheerful / Teasing
    if (/joke|haso|masti|pagal|chhed|tease|roast|funny|haha|hehe|smile|romantic|pyar/i.test(promptLower + " " + replyLower)) {
      return "playful_cheerful";
    }

    // 5. Laser Focus / Deep Work (Morning & Afternoon Coding, Business, Studies)
    if (hours >= 9 && hours <= 18) {
      if (/code|bug|api|deploy|error|database|timetable|cron|server|task|work|study|exam/i.test(promptLower)) {
        return "laser_focus";
      }
    }

    // 6. Warm Caring (Evening & General)
    if (hours >= 18 && hours < 22.5) {
      return "warm_caring";
    }

    return "natural_conversational";
  }

  /**
   * Maps human emotion to acoustic parameters across Edge TTS and Sarvam AI
   */
  public getProsodyParameters(emotion: SpeechEmotion): ProsodyParameters {
    switch (emotion) {
      case "sleepy_soothing":
        return {
          emotion,
          edgeProsody: {
            pitch: "-2Hz", // Deeper, calm vocal cords
            rate: "0.92", // Slower, relaxed cadence
            volume: "soft",
          },
          sarvamProsody: {
            pitch: -1,
            pace: 0.90,
            loudness: 1.0,
          },
          vibeDescription: "Soft, intimate, gentle night whisper 🌙",
        };

      case "empathetic_consoling":
        return {
          emotion,
          edgeProsody: {
            pitch: "-1Hz",
            rate: "0.95",
            volume: "medium",
          },
          sarvamProsody: {
            pitch: -0.5,
            pace: 0.94,
            loudness: 1.2,
          },
          vibeDescription: "Tender, warm, comforting human empathy ❤️",
        };

      case "excited_celebration":
        return {
          emotion,
          edgeProsody: {
            pitch: "+2Hz", // Brighter, smiling vocal tone
            rate: "1.06", // Brisk, energetic pace
            volume: "loud",
          },
          sarvamProsody: {
            pitch: 1.5,
            pace: 1.06,
            loudness: 1.6,
          },
          vibeDescription: "High energy, celebratory, vibrant joy 🎉",
        };

      case "playful_cheerful":
        return {
          emotion,
          edgeProsody: {
            pitch: "+1Hz",
            rate: "1.02",
            volume: "medium",
          },
          sarvamProsody: {
            pitch: 0.8,
            pace: 1.02,
            loudness: 1.4,
          },
          vibeDescription: "Playful, lighthearted, cheerful companion ✨",
        };

      case "laser_focus":
        return {
          emotion,
          edgeProsody: {
            pitch: "+0Hz",
            rate: "1.00",
            volume: "medium",
          },
          sarvamProsody: {
            pitch: 0,
            pace: 1.00,
            loudness: 1.4,
          },
          vibeDescription: "Crisp, razor-sharp, productive intelligence ⚡",
        };

      case "warm_caring":
      case "natural_conversational":
      default:
        return {
          emotion: "warm_caring",
          edgeProsody: {
            pitch: "+0Hz",
            rate: "0.98",
            volume: "medium",
          },
          sarvamProsody: {
            pitch: 0,
            pace: 0.98,
            loudness: 1.4,
          },
          vibeDescription: "Natural human warmth, loyal and lifelike 🎙️",
        };
    }
  }
}

export const humanSpeechProsodyEngine = new HumanSpeechProsodyEngine();
