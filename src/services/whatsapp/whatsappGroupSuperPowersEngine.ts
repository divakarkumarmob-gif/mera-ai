import { GoogleGenAI } from "@google/genai";
import { db } from "../firebaseAdmin";
import { QuotedMessageContext } from "./whatsappTypes";
import { whatsappHistoryEngine } from "./whatsappHistoryEngine";

export interface QuizQuestion {
  question: string;
  options: { [key: string]: string }; // A, B, C, D
  correctAnswer: string; // 'A' | 'B' | 'C' | 'D'
  explanation: string;
}

export interface ActiveGroupQuiz {
  groupId: string;
  topic: string;
  round: number;
  maxRounds: number;
  currentQuestion?: QuizQuestion;
  scores: Map<string, { name: string; points: number }>;
  startTime: number;
  answeredUsers: Set<string>;
}

export interface GroupBirthday {
  groupId: string;
  memberPhone: string;
  memberName: string;
  day: number;
  month: number;
  addedBy: string;
  addedAt: number;
  lastWishedYear?: number;
}

const bdayCol = () => db.collection("whatsapp_group_birthdays");
const decisionCol = () => db.collection("whatsapp_group_decisions");
const expenseCol = () => db.collection("whatsapp_group_expenses");

export class WhatsAppGroupSuperPowersEngine {
  private activeQuizzes: Map<string, ActiveGroupQuiz> = new Map();
  private birthdayCache: Map<string, GroupBirthday[]> = new Map();
  private loadedBirthdays = false;

  constructor() {
    this.preloadBirthdays().catch(() => {});
  }

  private async preloadBirthdays() {
    if (this.loadedBirthdays) return;
    try {
      const snap = await bdayCol().get();
      this.birthdayCache.clear();
      snap.forEach((doc) => {
        const data = doc.data() as GroupBirthday;
        if (data && data.groupId) {
          const list = this.birthdayCache.get(data.groupId) || [];
          list.push(data);
          this.birthdayCache.set(data.groupId, list);
        }
      });
      this.loadedBirthdays = true;
    } catch (e) {
      console.warn("[GroupSuperPowers] Failed to preload birthdays:", e);
    }
  }

  // ── Trigger Matcher ────────────────────────────────────────────────────────

  public isSuperPowerCommand(text: string): boolean {
    const clean = (text || "").toLowerCase().trim();
    return (
      clean.startsWith("@tagall") ||
      clean.startsWith("/tagall") ||
      clean.startsWith("@everyone") ||
      clean.startsWith("/everyone") ||
      clean.startsWith("@judge") ||
      clean.startsWith("/judge") ||
      clean.startsWith("@factcheck") ||
      clean.startsWith("/factcheck") ||
      clean.startsWith("@debate") ||
      clean.startsWith("/debate") ||
      clean.startsWith("@roast") ||
      clean.startsWith("/roast") ||
      clean.startsWith("@praise") ||
      clean.startsWith("/praise") ||
      clean.startsWith("@hypeman") ||
      clean.startsWith("/hypeman") ||
      clean.startsWith("@quiz") ||
      clean.startsWith("/quiz") ||
      clean.startsWith("@trivia") ||
      clean.startsWith("/trivia") ||
      clean.startsWith("@split") ||
      clean.startsWith("/split") ||
      clean.startsWith("@bill") ||
      clean.startsWith("/bill") ||
      clean.startsWith("@hisab") ||
      clean.startsWith("/hisab") ||
      clean.startsWith("@decision") ||
      clean.startsWith("/decision") ||
      clean.startsWith("@todo") ||
      clean.startsWith("/todo") ||
      clean.startsWith("@notes") ||
      clean.startsWith("/notes") ||
      clean.startsWith("@birthday") ||
      clean.startsWith("/birthday") ||
      clean.startsWith("@bday") ||
      clean.startsWith("/bday") ||
      clean.startsWith("@meme") ||
      clean.startsWith("/meme") ||
      clean.startsWith("@poll") ||
      clean.startsWith("/poll") ||
      clean.startsWith("@translate") ||
      clean.startsWith("/translate") ||
      clean.startsWith("@vibe") ||
      clean.startsWith("/vibe") ||
      clean.startsWith("@icebreaker") ||
      clean.startsWith("/icebreaker") ||
      clean.startsWith("@joke") ||
      clean.startsWith("/joke") ||
      clean.startsWith("@liedetector") ||
      clean.startsWith("/liedetector") ||
      clean.startsWith("@lie") ||
      clean.startsWith("/lie") ||
      clean.startsWith("@psychology") ||
      clean.startsWith("@rap") ||
      clean.startsWith("/rap") ||
      clean.startsWith("@future") ||
      clean.startsWith("/future") ||
      clean.startsWith("@oracle") ||
      clean.startsWith("/oracle") ||
      clean.startsWith("@kismat") ||
      clean.startsWith("@srk") ||
      clean.startsWith("/srk") ||
      clean.startsWith("@tonystark") ||
      clean.startsWith("/tonystark") ||
      clean.startsWith("@amitabh") ||
      clean.startsWith("@modi") ||
      clean.startsWith("@speakas") ||
      clean.startsWith("/speakas") ||
      clean.startsWith("@mimic") ||
      clean.startsWith("/mimic") ||
      clean.startsWith("@clone") ||
      clean.startsWith("/clone") ||
      clean.startsWith("@movie") ||
      clean.startsWith("/movie") ||
      clean.startsWith("@poster") ||
      clean.startsWith("/poster") ||
      clean.startsWith("@commentary") ||
      clean.startsWith("/commentary") ||
      /^(?:tag\s*all|everyone|fact\s*check|ai\s*judge|roast\s*me|start\s*quiz|split\s*bill|group\s*decision|group\s*birthday|make\s*meme|create\s*poll|translate\s*to|group\s*vibe|tell\s*joke|lie\s*detector|rap\s*banao|future\s*prediction|movie\s*cast|match\s*commentary)/i.test(clean)
    );
  }

  // ── Main Super Power Dispatcher ───────────────────────────────────────────

  public async handleSuperPowerCommand(
    sock: any,
    groupJid: string,
    groupName: string,
    rawText: string,
    senderName: string,
    senderPhone: string,
    senderJid: string,
    messageKey: any,
    quotedMessage?: QuotedMessageContext | null,
    isOwner = false
  ): Promise<{ handled: boolean; replyText?: string; mentions?: string[] }> {
    const clean = (rawText || "").toLowerCase().trim();

    // 1. @tagall / @everyone Announcement Broadcast
    if (
      clean.startsWith("@tagall") ||
      clean.startsWith("/tagall") ||
      clean.startsWith("@everyone") ||
      clean.startsWith("/everyone") ||
      clean === "tag all" ||
      clean === "everyone"
    ) {
      return await this.handleTagAll(sock, groupJid, groupName, rawText, senderName);
    }

    // 2. @judge / @factcheck AI Courtroom & Fact-Checker
    if (
      clean.startsWith("@judge") ||
      clean.startsWith("/judge") ||
      clean.startsWith("@factcheck") ||
      clean.startsWith("/factcheck") ||
      clean.startsWith("@debate") ||
      clean.startsWith("/debate")
    ) {
      return await this.handleJudgeFactCheck(rawText, quotedMessage, senderName);
    }

    // 3. @roast / @praise Entertainment Engine
    if (
      clean.startsWith("@roast") ||
      clean.startsWith("/roast") ||
      clean.startsWith("@praise") ||
      clean.startsWith("/praise") ||
      clean.startsWith("@hypeman")
    ) {
      return await this.handleRoastAndPraise(rawText, quotedMessage, senderName);
    }

    // 4. @quiz / @trivia Live Group Game Arena
    if (clean.startsWith("@quiz") || clean.startsWith("/quiz") || clean.startsWith("@trivia") || clean.startsWith("/trivia")) {
      return await this.handleGroupQuiz(groupJid, rawText, senderName, senderPhone);
    }

    // 5. @split / @bill / @hisab Expense Splitter
    if (clean.startsWith("@split") || clean.startsWith("/split") || clean.startsWith("@bill") || clean.startsWith("/bill") || clean.startsWith("@hisab")) {
      return await this.handleBillSplit(rawText, groupName, senderName);
    }

    // 6. @decision / @todo / @notes Action-Item Tracker
    if (clean.startsWith("@decision") || clean.startsWith("/decision") || clean.startsWith("@todo") || clean.startsWith("/todo") || clean.startsWith("@notes")) {
      return await this.handleDecisionTracker(groupJid, groupName, rawText, quotedMessage);
    }

    // 7. @birthday / @bday Auto-Celebrator
    if (clean.startsWith("@birthday") || clean.startsWith("/birthday") || clean.startsWith("@bday") || clean.startsWith("/bday")) {
      return await this.handleBirthdayManager(groupJid, groupName, rawText, senderName, senderPhone, quotedMessage);
    }

    // 8. @meme AI Meme & Sticker Generator
    if (clean.startsWith("@meme") || clean.startsWith("/meme") || clean.startsWith("meme")) {
      return await this.handleMemeGenerator(sock, groupJid, rawText, senderName, quotedMessage);
    }

    // 9. @poll WhatsApp Interactive Poll Creator
    if (clean.startsWith("@poll") || clean.startsWith("/poll") || clean.startsWith("poll")) {
      return await this.handlePollCreator(sock, groupJid, rawText, senderName);
    }

    // 10. @translate Multi-Language Live Translator
    if (clean.startsWith("@translate") || clean.startsWith("/translate") || clean.startsWith("translate")) {
      return await this.handleLiveTranslator(rawText, quotedMessage, senderName);
    }

    // 11. @vibe / @icebreaker / @joke Group Mood & Icebreaker
    if (
      clean.startsWith("@vibe") ||
      clean.startsWith("/vibe") ||
      clean.startsWith("@icebreaker") ||
      clean.startsWith("/icebreaker") ||
      clean.startsWith("@joke") ||
      clean.startsWith("/joke")
    ) {
      return await this.handleVibeRadarAndIcebreaker(groupJid, groupName, rawText, senderName);
    }

    // 12. @liedetector / @psychology Polygraph & Lie Detector
    if (
      clean.startsWith("@liedetector") ||
      clean.startsWith("/liedetector") ||
      clean.startsWith("@lie") ||
      clean.startsWith("/lie") ||
      clean.startsWith("@psychology")
    ) {
      return await this.handleLieDetector(rawText, quotedMessage, senderName);
    }

    // 13. @rap Desi Hip-Hop Rap Generator
    if (clean.startsWith("@rap") || clean.startsWith("/rap") || clean.startsWith("rap")) {
      return await this.handleDesiRapGenerator(rawText, quotedMessage, senderName);
    }

    // 14. @future / @oracle Time-Machine Future Prediction
    if (
      clean.startsWith("@future") ||
      clean.startsWith("/future") ||
      clean.startsWith("@oracle") ||
      clean.startsWith("/oracle") ||
      clean.startsWith("@kismat")
    ) {
      return await this.handleFutureOracle(rawText, quotedMessage, senderName);
    }

    // 15. @srk / @tonystark / @amitabh / @modi / @speakas Celebrity Clone
    if (
      clean.startsWith("@srk") ||
      clean.startsWith("/srk") ||
      clean.startsWith("@tonystark") ||
      clean.startsWith("/tonystark") ||
      clean.startsWith("@amitabh") ||
      clean.startsWith("@modi") ||
      clean.startsWith("@speakas") ||
      clean.startsWith("/speakas")
    ) {
      return await this.handleCelebrityClone(rawText, quotedMessage, senderName);
    }

    // 16. @mimic / @clone Member Doppelgänger
    if (clean.startsWith("@mimic") || clean.startsWith("/mimic") || clean.startsWith("@clone") || clean.startsWith("/clone")) {
      return await this.handleMemberMimic(rawText, quotedMessage, senderName);
    }

    // 17. @movie / @poster Movie Cast & Poster Generator
    if (clean.startsWith("@movie") || clean.startsWith("/movie") || clean.startsWith("@poster") || clean.startsWith("/poster")) {
      return await this.handleMovieCastPoster(sock, groupJid, rawText, senderName);
    }

    // 18. @commentary Bhojpuri & Sidhu Sports Commentary
    if (clean.startsWith("@commentary") || clean.startsWith("/commentary") || clean.startsWith("commentary")) {
      return await this.handleSportsCommentary(rawText, senderName);
    }

    return { handled: false };
  }

  // ── 1. @tagall / @everyone Engine ──────────────────────────────────────────

  private async handleTagAll(
    sock: any,
    groupJid: string,
    groupName: string,
    rawText: string,
    senderName: string
  ): Promise<{ handled: boolean; replyText?: string; mentions?: string[] }> {
    if (!sock) return { handled: true, replyText: "⚠️ Friday WhatsApp connection error." };

    try {
      const meta = await sock.groupMetadata(groupJid);
      if (!meta || !Array.isArray(meta.participants)) {
        return { handled: true, replyText: "⚠️ Group participants list fetch nahi ho saki." };
      }

      const botJid = sock.user?.id || "";
      const participants = meta.participants.filter((p: any) => !p.id.includes(botJid.split(":")[0]));
      const mentions = participants.map((p: any) => p.id);

      const noticeContent = rawText
        .replace(/^(?:@tagall|@everyone|\/tagall|\/everyone|tag\s*all|everyone)\s*[:=-]?\s*/i, "")
        .trim();

      const announcementMsg = noticeContent || "Zaroori suchna / Dhyan dein sabhi members!";

      const memberTagsList = participants
        .slice(0, 35)
        .map((p: any) => `@${p.id.split("@")[0].split(":")[0].replace(/\D/g, "")}`)
        .join(" ");

      const extraCount = participants.length > 35 ? ` ...aur ${participants.length - 35} log` : "";

      const card = `📢 *GROUP ANNOUNCEMENT (@everyone)* ⚡
━━━━━━━━━━━━━━━━━━━━━━━━━━
👥 *Group:* ${groupName}
👤 *Announced By:* ${senderName}
💬 *Message:*
"${announcementMsg}"
━━━━━━━━━━━━━━━━━━━━━━━━━━
🔔 *Attention Members (${participants.length}):*
${memberTagsList}${extraCount}`;

      return {
        handled: true,
        replyText: card,
        mentions,
      };
    } catch (err: any) {
      console.error("[GroupSuperPowers] TagAll error:", err);
      return { handled: true, replyText: `⚠️ Tag All failed: ${err?.message || err}` };
    }
  }

  // ── 2. @judge / @factcheck AI Courtroom Engine ──────────────────────────────

  private async handleJudgeFactCheck(
    rawText: string,
    quotedMessage?: QuotedMessageContext | null,
    senderName = "Member"
  ): Promise<{ handled: boolean; replyText?: string }> {
    const claim = rawText
      .replace(/^(?:@judge|@factcheck|@debate|\/judge|\/factcheck|\/debate)\s*[:=-]?\s*/i, "")
      .trim();

    const quotedContent = quotedMessage ? `[Quoted Statement by ${quotedMessage.sender}]: "${quotedMessage.text}"` : "";
    const fullTopic = claim || quotedContent || "Kya ye baat sach hai?";

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        handled: true,
        replyText: `⚖️ *AI Courtroom:* Statement verify karne ke liye GEMINI_API_KEY configure hona zaroori hai.`,
      };
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are Friday AI acting as the Chief Supreme Court Judge & High-Accuracy Fact-Checker in a lively WhatsApp Group.
Members are having a debate.
Claim / Argument to verify:
"""
${fullTopic}
"""
Requested by: ${senderName}

YOUR TASK:
Analyze the claim thoroughly, check factual history, science, sports, tech, or truth, and deliver a fair, objective, witty, and crystal-clear courtroom verdict in energetic natural Hinglish.

Structure your response EXACTLY like this:
⚖️ *FRIDAY AI COURTROOM & FACT-CHECK VERDICT* 🏛️
━━━━━━━━━━━━━━━━━━━━━━━━━━
📜 *Contested Statement:* "[One line summary of the claim]"
🔍 *Fact Analysis:* [2-3 crisp lines explaining the real facts with dates/numbers]
🏆 *The Verdict / Truth:* [Declare who is right or whether the claim is TRUE / FALSE / MISLEADING]
💡 *Final Advice:* [A witty, humorous 1-line settlement for the group members]
━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 *Accuracy Confidence:* 99% Verified`;

      for (const model of ["gemini-2.5-flash", "gemini-3.6-flash", "gemini-3.1-flash-lite"]) {
        try {
          const resp = await ai.models.generateContent({ model, contents: prompt });
          const text = resp.text?.trim();
          if (text) return { handled: true, replyText: text };
        } catch {}
      }

      return {
        handled: true,
        replyText: `⚖️ *AI Judge:* Arguments analyze kiye gaye hain. Kripya apna dawa specific numbers aur dates ke sath likhein!`,
      };
    } catch (e: any) {
      return { handled: true, replyText: `⚠️ Fact check error: ${e?.message || e}` };
    }
  }

  // ── 3. @roast / @praise Entertainment Engine ───────────────────────────────

  private async handleRoastAndPraise(
    rawText: string,
    quotedMessage?: QuotedMessageContext | null,
    senderName = "Member"
  ): Promise<{ handled: boolean; replyText?: string }> {
    const isPraise = /^(?:@praise|\/praise|@hypeman|\/hypeman)/i.test(rawText.trim());
    const target = rawText
      .replace(/^(?:@roast|@praise|@hypeman|\/roast|\/praise|\/hypeman)\s*[:=-]?\s*/i, "")
      .trim();

    const targetPerson = target || (quotedMessage ? quotedMessage.sender : senderName);
    const targetContext = quotedMessage ? `Quoted Message from ${quotedMessage.sender}: "${quotedMessage.text}"` : "";

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        handled: true,
        replyText: isPraise
          ? `🌟 *Hype Card:* ${targetPerson} is simply legendary! 🚀🔥`
          : `🔥 *Roast:* ${targetPerson} bhai ka swag hi alag hai! 😂`,
      };
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = isPraise
        ? `You are Friday AI, the ultimate hype-man in a WhatsApp group.
Write a wildly enthusiastic, hilarious, superhero-style appreciation praise for "${targetPerson}" in rich, modern Hinglish.
Context: ${targetContext}
Make them feel like an absolute boss/rockstar with funny exaggerations, Bollywood punchlines, and 100% positive vibes.
Use emojis and keep it within 4-5 lines.`
        : `You are Friday AI, doing a witty, lighthearted, savage stand-up roast of "${targetPerson}" in a WhatsApp group.
Context: ${targetContext}
CRITICAL SAFETY RULE: NEVER use vulgar, sexual, abusive slurs (no MC/BC/slurs). Keep it classy, extremely clever, funny, sarcastic college/hostel-style friendly leg-pulling in natural Hinglish.
Use playful punchlines and keep it within 4-5 lines.`;

      for (const model of ["gemini-2.5-flash", "gemini-3.6-flash", "gemini-3.1-flash-lite"]) {
        try {
          const resp = await ai.models.generateContent({ model, contents: prompt });
          const text = resp.text?.trim();
          if (text) {
            const header = isPraise ? `🔥 *FRIDAY HYPE-MAN APPRECIATION* 👑` : `🔥 *FRIDAY ROAST ARENA* 🎤`;
            return {
              handled: true,
              replyText: `${header}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n🎯 *Target:* ${targetPerson}\n\n${text}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n_P.S. Sirf group ke maze ke liye hai, dil par mat lena! 😄_`,
            };
          }
        } catch {}
      }

      return { handled: true, replyText: `🔥 ${targetPerson} ke baare me sab jaante hain! 😂` };
    } catch (e: any) {
      return { handled: true, replyText: `⚠️ Entertainment engine error: ${e?.message || e}` };
    }
  }

  // ── 4. @quiz Live Group Game Arena ────────────────────────────────────────

  private async handleGroupQuiz(
    groupJid: string,
    rawText: string,
    senderName: string,
    senderPhone: string
  ): Promise<{ handled: boolean; replyText?: string }> {
    const clean = rawText.toLowerCase().trim();
    const active = this.activeQuizzes.get(groupJid);

    // Stop Quiz
    if (clean.includes("stop") || clean.includes("end") || clean.includes("band")) {
      if (!active) return { handled: true, replyText: "⚠️ Abhi koi active quiz nahi chal rahi hai. Shuru karne ke liye `@quiz start` likhein!" };
      const scoreboard = this.getLeaderboardText(active);
      this.activeQuizzes.delete(groupJid);
      return {
        handled: true,
        replyText: `🛑 *QUIZ ENDED!* 🏁\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n${scoreboard}\n\nKhelne ke liye sabhi ko shukriya! 🎉`,
      };
    }

    // Leaderboard
    if (clean.includes("leaderboard") || clean.includes("score") || clean.includes("points")) {
      if (!active) return { handled: true, replyText: "⚠️ Koi active quiz nahi hai. `@quiz start [topic]` se nayi quiz shuru karein!" };
      return { handled: true, replyText: this.getLeaderboardText(active) };
    }

    // Answer Checking (A / B / C / D)
    const ansMatch = clean.match(/^(?:@quiz|\/quiz|@trivia)?\s*([a-d])\b/i);
    if (ansMatch && active && active.currentQuestion) {
      const userAns = ansMatch[1].toUpperCase();
      const userKey = senderPhone || senderName;

      if (active.answeredUsers.has(userKey)) {
        return { handled: true, replyText: `⚠️ @${senderPhone || senderName}, aapne is question ka answer pehle hi de diya hai!` };
      }
      active.answeredUsers.add(userKey);

      const isCorrect = userAns === active.currentQuestion.correctAnswer;
      if (isCorrect) {
        const userScore = active.scores.get(userKey) || { name: senderName, points: 0 };
        userScore.points += 10;
        active.scores.set(userKey, userScore);

        const ansCard = `🎉 *RIGHT ANSWER!* ⚡
━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 *Winner:* @${senderPhone || senderName} (+10 Points! 🏆)
✅ *Correct Option:* ${active.currentQuestion.correctAnswer} - ${active.currentQuestion.options[active.currentQuestion.correctAnswer]}
💡 *Fact:* ${active.currentQuestion.explanation}
━━━━━━━━━━━━━━━━━━━━━━━━━━`;

        // Check if more rounds
        if (active.round < active.maxRounds) {
          active.round++;
          active.answeredUsers.clear();
          const nextQ = await this.generateQuizQuestion(active.topic);
          active.currentQuestion = nextQ;

          const nextCard = `\n\n🎯 *ROUND ${active.round}/${active.maxRounds}* 🚀\n📝 *Question:* ${nextQ.question}\n\n🅰️ ${nextQ.options.A}\n🅱️ ${nextQ.options.B}\n🅲 ${nextQ.options.C}\n🅳 ${nextQ.options.D}\n\n_(Reply with A, B, C ya D)_`;
          return { handled: true, replyText: `${ansCard}${nextCard}` };
        } else {
          const finalScoreboard = this.getLeaderboardText(active);
          this.activeQuizzes.delete(groupJid);
          return {
            handled: true,
            replyText: `${ansCard}\n\n🏆 *QUIZ COMPLETED! GRAND FINALE* 🎊\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n${finalScoreboard}`,
          };
        }
      } else {
        return {
          handled: true,
          replyText: `❌ *Galat Jawab!* @${senderPhone || senderName} (Option ${userAns} galat hai). Koi aur try karein!`,
        };
      }
    }

    // Start New Quiz
    const topic = rawText.replace(/^(?:@quiz|\/quiz|@trivia|\/trivia|\s*start)*\s*/i, "").trim() || "General Knowledge & Bollywood & Cricket";

    const question = await this.generateQuizQuestion(topic);
    const newQuiz: ActiveGroupQuiz = {
      groupId: groupJid,
      topic,
      round: 1,
      maxRounds: 5,
      currentQuestion: question,
      scores: new Map(),
      startTime: Date.now(),
      answeredUsers: new Set(),
    };
    this.activeQuizzes.set(groupJid, newQuiz);

    const card = `🎮 *FRIDAY LIVE GROUP QUIZ SHOWDOWN* ⚡
━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 *Topic:* ${topic}
🔢 *Round:* 1/5 | *Points:* 10 pts per fastest correct answer!
━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 *Question 1:*
${question.question}

🅰️ ${question.options.A}
🅱️ ${question.options.B}
🅲 ${question.options.C}
🅳 ${question.options.D}
━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 _Jawab dene ke liye \`A\`, \`B\`, \`C\` ya \`D\` likhein!_`;

    return { handled: true, replyText: card };
  }

  private async generateQuizQuestion(topic: string): Promise<QuizQuestion> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const prompt = `Generate 1 unique, fun, high-energy multiple choice trivia question for an Indian WhatsApp group.
Topic: "${topic}".
Output MUST be strict JSON only in this schema:
{
  "question": "Question in natural Hinglish or English",
  "options": {
    "A": "Option A text",
    "B": "Option B text",
    "C": "Option C text",
    "D": "Option D text"
  },
  "correctAnswer": "A",
  "explanation": "1-line interesting fun fact why this is correct"
}`;
        const resp = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
          config: { responseMimeType: "application/json" },
        });

        const json = JSON.parse(resp.text?.trim() || "{}");
        if (json.question && json.options && json.correctAnswer) {
          return {
            question: json.question,
            options: json.options,
            correctAnswer: (json.correctAnswer || "A").toUpperCase(),
            explanation: json.explanation || "Correct answer!",
          };
        }
      } catch (e) {
        console.warn("[GroupSuperPowers] Quiz AI generation error:", e);
      }
    }

    return {
      question: "Cricket World Cup 2011 Final me Dhoni ne kitne runs banaye the?",
      options: { A: "85 Runs", B: "91* Runs", C: "97 Runs", D: "102 Runs" },
      correctAnswer: "B",
      explanation: "MS Dhoni scored 91 not out off 79 balls with that iconic final six!",
    };
  }

  private getLeaderboardText(quiz: ActiveGroupQuiz): string {
    const sorted = Array.from(quiz.scores.values()).sort((a, b) => b.points - a.points);
    if (sorted.length === 0) return "📊 *Leaderboard:* Abhi tak kisi ne koi points nahi jeete.";
    const lines = sorted.map((s, idx) => `${idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : "👤"} *${s.name}:* ${s.points} Points`);
    return `📊 *LIVE QUIZ LEADERBOARD* 🏆\n${lines.join("\n")}`;
  }

  // ── 5. @split / @bill Expense Splitter ─────────────────────────────────────

  private async handleBillSplit(
    rawText: string,
    groupName: string,
    senderName: string
  ): Promise<{ handled: boolean; replyText?: string }> {
    const clean = rawText.replace(/^(?:@split|@bill|@hisab|\/split|\/bill|\/hisab)\s*[:=-]?\s*/i, "").trim();

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        handled: true,
        replyText: `💳 *Group Expense Splitter:* Please provide amount and members (e.g. \`@split 1500 Pizza Rohan Aman DK\`).`,
      };
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are Friday AI, an intelligent group expense and Splitwise manager.
Input text from user: "${clean}"
Payer / Requested By: "${senderName}"

Task:
Extract:
- totalAmount (number)
- description / item (e.g. Dinner, Pizza, Trip, Petrol)
- payerName
- participantsList (array of names involved, if none specified default to 3-4 standard friends or mention 'equal share among all members')
- perPersonShare (totalAmount / participants count)

Format a clean, crystal-clear WhatsApp Expense Card in natural Hinglish:
💳 *FRIDAY EXPENSE & SPLITWISE CARD* 🧾
━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 *Total Bill:* ₹[Amount] ([Description])
👤 *Paid By:* [Payer Name]
👥 *Split Among:* [List of Names] ([Count] members)
💵 *Per Person Share:* ₹[Per Person]
━━━━━━━━━━━━━━━━━━━━━━━━━━
📲 *Payment Action:*
• [Name 1] ➔ [Payer] ko ₹[Per Person] bhejenge
• [Name 2] ➔ [Payer] ko ₹[Per Person] bhejenge
━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ _Hisaab cleared by Friday AI!_`;

      const resp = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt });
      const text = resp.text?.trim();
      if (text) {
        expenseCol().add({ groupName, rawText: clean, createdAt: Date.now() }).catch(() => {});
        return { handled: true, replyText: text };
      }
    } catch (e: any) {
      return { handled: true, replyText: `⚠️ Expense calculation error: ${e?.message || e}` };
    }

    return { handled: true, replyText: `💳 *Hisaab:* Kripya bill amount aur members batayein (Jaise: \`@split 2000 Dinner by Rohan with Aman DK Rahul\`).` };
  }

  // ── 6. @decision / @todo Action Tracker ───────────────────────────────────

  private async handleDecisionTracker(
    groupJid: string,
    groupName: string,
    rawText: string,
    quotedMessage?: QuotedMessageContext | null
  ): Promise<{ handled: boolean; replyText?: string }> {
    let recentMessagesText = "";
    if (quotedMessage) {
      recentMessagesText = `Quoted Message from ${quotedMessage.sender}: "${quotedMessage.text}"`;
    } else {
      try {
        const history = await whatsappHistoryEngine.getGroupMessagesWithSummary(groupName, 25);
        recentMessagesText = history;
      } catch {}
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        handled: true,
        replyText: `📌 *Decisions & Notes:* GEMINI_API_KEY is required to analyze group conversation.`,
      };
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are Friday AI, acting as the Executive Meeting Secretary for a WhatsApp Group.
Here is the recent group conversation history:
"""
${recentMessagesText || rawText}
"""

YOUR TASK:
Scan the conversation and extract:
1. Key Decisions Made (What did the group finally agree on?)
2. Action Items & Assigned Tasks (Who is responsible for doing what?)
3. Important Dates / Deadlines / Timings (If any).

Format your output EXACTLY as a pinned executive checklist:
📌 *FRIDAY GROUP DECISION & ACTION TRACKER* ⚡
━━━━━━━━━━━━━━━━━━━━━━━━━━
👥 *Group:* ${groupName}
🎯 *Final Agreed Decisions:*
• [Decision 1]
• [Decision 2]

📋 *Action Items & To-Dos:*
• 🔲 [Task 1] ➔ Assigned: @[Person]
• 🔲 [Task 2] ➔ Assigned: @[Person]

⏰ *Timings / Deadlines:*
• [Date / Time]
━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 _Friday ne decisions note kar liye hain. Sabhi log apne tasks time par complete karein!_`;

      const resp = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt });
      const text = resp.text?.trim();
      if (text) {
        decisionCol().add({ groupId: groupJid, groupName, text, createdAt: Date.now() }).catch(() => {});
        return { handled: true, replyText: text };
      }
    } catch (e: any) {
      return { handled: true, replyText: `⚠️ Decision extraction error: ${e?.message || e}` };
    }

    return { handled: true, replyText: `📌 *Decision Tracker:* Group me abhi tak koi specific plan ya decision confirm nahi hua hai.` };
  }

  // ── 7. @birthday Auto-Celebrator ──────────────────────────────────────────

  private async handleBirthdayManager(
    groupJid: string,
    groupName: string,
    rawText: string,
    senderName: string,
    senderPhone: string,
    quotedMessage?: QuotedMessageContext | null
  ): Promise<{ handled: boolean; replyText?: string }> {
    const clean = rawText.toLowerCase().trim();

    // List Birthdays
    if (clean.includes("list") || clean.includes("upcoming") || clean.includes("kab hai")) {
      const bdays = this.birthdayCache.get(groupJid) || [];
      if (bdays.length === 0) {
        return {
          handled: true,
          replyText: `🎂 *GROUP BIRTHDAYS REGISTRY* 📅\n━━━━━━━━━━━━━━━━━━━━━━━━━━\nAbhi is group me koi birthday save nahi hai.\n\n💡 *Save karne ke liye likhein:*\n\`@birthday add @Name 15-08\``,
        };
      }

      const listStr = bdays
        .map((b) => `• 🎈 *${b.memberName}* (@${b.memberPhone}): ${String(b.day).padStart(2, "0")}/${String(b.month).padStart(2, "0")}`)
        .join("\n");

      return {
        handled: true,
        replyText: `🎂 *GROUP BIRTHDAYS CALENDAR* 📅\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n${listStr}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n_Friday 12:00 AM midnight par automatically celebrate karegi! 🎉_`,
      };
    }

    // Add Birthday (@birthday add @Member DD-MM or @birthday add 15 Oct)
    if (clean.includes("add") || clean.includes("save") || clean.includes("set")) {
      const targetPhone = quotedMessage?.senderPhone || (rawText.match(/\d{10,14}/)?.[0] || senderPhone).replace(/\D/g, "");
      const targetName = quotedMessage?.sender || senderName;

      // Extract day and month
      const dateMatch = rawText.match(/\b(\d{1,2})[\/\-\s]([0-1]?\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i);
      if (!dateMatch) {
        return {
          handled: true,
          replyText: `⚠️ Kripya sahi date format me likhein. Example: \`@birthday add @Rohan 25-10\` ya \`@birthday add 15 Aug\``,
        };
      }

      const day = parseInt(dateMatch[1], 10);
      let month = 1;
      const monthRaw = dateMatch[2].toLowerCase();

      const monthMap: { [k: string]: number } = {
        jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
        jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
      };

      if (monthMap[monthRaw]) {
        month = monthMap[monthRaw];
      } else {
        month = parseInt(monthRaw, 10);
      }

      if (day < 1 || day > 31 || month < 1 || month > 12) {
        return { handled: true, replyText: `⚠️ Invalid date: ${day}/${month}. Kripya valid date dein.` };
      }

      const newBday: GroupBirthday = {
        groupId: groupJid,
        memberPhone: targetPhone,
        memberName: targetName,
        day,
        month,
        addedBy: senderName,
        addedAt: Date.now(),
      };

      const existing = this.birthdayCache.get(groupJid) || [];
      const updated = existing.filter((b) => b.memberPhone !== targetPhone);
      updated.push(newBday);
      this.birthdayCache.set(groupJid, updated);

      const docId = `${groupJid}_${targetPhone}`;
      await bdayCol().doc(docId).set(newBday, { merge: true });

      return {
        handled: true,
        replyText: `🎂 *BIRTHDAY SAVED SUCCESSFULLY!* 🎉\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *Member:* ${targetName} (@${targetPhone})\n📅 *Date:* ${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\nFriday theek 12:00 AM par group me custom celebration poster aur sweet wish post karegi! 🥳✨`,
      };
    }

    // Instant Wish Generator (@birthday wish @Member)
    const targetPerson = quotedMessage ? quotedMessage.sender : senderName;
    const apiKey = process.env.GEMINI_API_KEY;
    let customPoem = `Aapko janamdin ki dheron shubhkaamnayein! Har din khushiyon se bhara rahe! 🎂✨`;

    if (apiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const prompt = `Write a super sweet, warm, high-energy, 4-line Birthday Celebration Poem + funny blessing in natural Hinglish for "${targetPerson}" in a WhatsApp group. Use emojis.`;
        const resp = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt });
        if (resp.text) customPoem = resp.text.trim();
      } catch {}
    }

    return {
      handled: true,
      replyText: `🎂🎉 *HAPPY BIRTHDAY ${targetPerson.toUpperCase()}!* 🥳🎈
━━━━━━━━━━━━━━━━━━━━━━━━━━
${customPoem}
━━━━━━━━━━━━━━━━━━━━━━━━━━
👑 _Treat kab mil rahi hai sabko? Party toh banti hai!_ 🍕🍻`,
    };
  }

  // ── 8. @meme AI Meme & Sticker Generator ──────────────────────────────────

  public async handleMemeGenerator(
    sock: any,
    groupJid: string,
    rawText: string,
    senderName: string,
    quotedMessage?: QuotedMessageContext | null
  ): Promise<{ handled: boolean; replyText?: string }> {
    const topic = rawText
      .replace(/^(?:@meme|\/meme|meme\s*banao|meme)\s*[:=-]?\s*/i, "")
      .trim();

    const target = topic || (quotedMessage ? quotedMessage.text : "Indian College Friends & Relatable Life");
    const apiKey = process.env.GEMINI_API_KEY;

    let memePrompt = `Funny Indian relatable meme about ${target}`;
    let memeCaption = `😂 *FRIDAY AI MEME CORNER* 🎭\n\n"${target}"`;

    if (apiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const res = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: `Create a super funny, relatable Indian Hinglish meme punchline about: "${target}".
Format:
Caption: [1-2 line funny punchline]
ImagePrompt: [Visual description for 3D animated or photorealistic funny meme scene]`,
        });
        const full = res.text?.trim() || "";
        const capMatch = full.match(/Caption:\s*([\s\S]*?)(?:ImagePrompt:|$)/i);
        const promptMatch = full.match(/ImagePrompt:\s*([\s\S]*)/i);
        if (capMatch) memeCaption = `😂 *FRIDAY AI MEME CORNER* 🎭\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n${capMatch[1].trim()}\n━━━━━━━━━━━━━━━━━━━━━━━━━━`;
        if (promptMatch) memePrompt = promptMatch[1].trim();
      } catch {}
    }

    try {
      const { imageGenerationService } = await import("../imageGenerationService");
      const genRes = await imageGenerationService.generateImage(memePrompt, { aspectRatio: "1:1" });
      if (genRes.success && genRes.buffer && sock) {
        await sock.sendMessage(groupJid, {
          image: genRes.buffer,
          caption: memeCaption,
        });
        return { handled: true };
      }
    } catch (imgErr) {
      console.warn("[GroupSuperPowers] Meme image generation fallback:", imgErr);
    }

    return {
      handled: true,
      replyText: `${memeCaption}\n\n🖼️ _(Meme Scene: ${memePrompt})_`,
    };
  }

  // ── 9. @poll WhatsApp Native Interactive Poll Creator ─────────────────────

  public async handlePollCreator(
    sock: any,
    groupJid: string,
    rawText: string,
    senderName: string
  ): Promise<{ handled: boolean; replyText?: string }> {
    const clean = rawText.replace(/^(?:@poll|\/poll|poll\s*banao|poll)\s*[:=-]?\s*/i, "").trim();

    let question = "Aapka kya vote hai?";
    let options: string[] = ["Haan / Yes 👍", "Nahi / No 👎", "Dekhte hain 🤔"];

    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const prompt = `Extract a clear poll question and 2 to 6 crisp poll options from this user request for a WhatsApp group poll.
Input: "${clean || "Sunday Cricket match"}"

Output STRICT JSON ONLY:
{
  "question": "Clear poll title / question",
  "options": ["Option 1", "Option 2", "Option 3"]
}`;
        const resp = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
          config: { responseMimeType: "application/json" },
        });
        const json = JSON.parse(resp.text?.trim() || "{}");
        if (json.question && Array.isArray(json.options) && json.options.length >= 2) {
          question = json.question.slice(0, 250);
          options = json.options.map((o: any) => String(o).slice(0, 100)).slice(0, 12);
        }
      } catch (e) {
        console.warn("[GroupSuperPowers] Poll AI parse error:", e);
      }
    }

    if (sock) {
      try {
        await sock.sendMessage(groupJid, {
          poll: {
            name: `📊 ${question}`,
            values: options,
            selectableCount: 1,
          },
        });
        return { handled: true };
      } catch (pollErr: any) {
        console.warn("[GroupSuperPowers] WhatsApp native poll send failed:", pollErr);
      }
    }

    const optionsList = options.map((opt, i) => `${i + 1}️⃣ ${opt}`).join("\n");
    return {
      handled: true,
      replyText: `📊 *GROUP LIVE POLL: ${question}* 🗳️\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n${optionsList}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n_Apna option chunein!_`,
    };
  }

  // ── 10. @translate Multi-Language Live Translator ─────────────────────────

  public async handleLiveTranslator(
    rawText: string,
    quotedMessage?: QuotedMessageContext | null,
    senderName = "Member"
  ): Promise<{ handled: boolean; replyText?: string }> {
    const clean = rawText.replace(/^(?:@translate|\/translate|@tarjuma|translate|anuvad)\s*[:=-]?\s*/i, "").trim();

    const targetLangMatch = clean.match(/\b(?:in|to|me|mein|language)?\s*(hindi|english|bengali|bangla|marathi|gujarati|punjabi|urdu|tamil|telugu|kannada|malayalam|french|spanish|german|japanese|russian|arabic|chinese|italian|portuguese|korean)\b/i);
    const targetLanguage = targetLangMatch ? targetLangMatch[1].trim() : "Hindi";

    const textToTranslate = quotedMessage ? quotedMessage.text : clean.replace(/\b(?:in|to|me|mein|language)?\s*(hindi|english|bengali|bangla|marathi|gujarati|punjabi|urdu|tamil|telugu|kannada|malayalam|french|spanish|german|japanese|russian|arabic|chinese|italian|portuguese|korean)\b/gi, "").trim();

    if (!textToTranslate) {
      return {
        handled: true,
        replyText: `🌐 *Language Translator:* Kripya kisi message par swipe karke \`@translate [Language]\` likhein ya text ke sath language batayein (Jaise: \`@translate in Bengali "Hello how are you"\`).`,
      };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const prompt = `Translate the following message into ${targetLanguage} accurately and naturally.
Original Text: "${textToTranslate}"
Requested by: ${senderName}

Format Output:
🌐 *FRIDAY LANGUAGE TRANSLATOR* ⚡
━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 *Original:* "${textToTranslate}"
🎯 *${targetLanguage} Translation:*
"[Accurate, natural translation in ${targetLanguage}]"
━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 _Translation accurate and context-aware!_`;

        const resp = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt });
        const text = resp.text?.trim();
        if (text) return { handled: true, replyText: text };
      } catch (e: any) {
        return { handled: true, replyText: `⚠️ Translation error: ${e?.message || e}` };
      }
    }

    return {
      handled: true,
      replyText: `🌐 *Translation (${targetLanguage}):*\n"${textToTranslate}"`,
    };
  }

  // ── 11. @vibe / @icebreaker Group Mood & Fight Cooler ─────────────────────

  public async handleVibeRadarAndIcebreaker(
    groupJid: string,
    groupName: string,
    rawText: string,
    senderName: string
  ): Promise<{ handled: boolean; replyText?: string }> {
    const isJoke = /\b(joke|chutkula|hasao|funny)\b/i.test(rawText);
    const isFightCooler = /\b(ladai|fight|gussa|shant|cool|jhagda)\b/i.test(rawText);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        handled: true,
        replyText: `🌟 *Group Vibe Check:* Group ka mahaul 100% positive and energetic hai! Sab log chill karein! 😎✨`,
      };
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = isJoke
        ? `Tell 1 super fresh, hilarious, modern Indian stand-up style Hindi/Hinglish comedy joke for a WhatsApp group. Keep it clean, clever, and extremely funny. 3-4 lines.`
        : isFightCooler
        ? `Two people or members are arguing in this WhatsApp group. Write a hilarious, witty, lighthearted intervention that immediately diffuses the tension and makes everyone laugh. Use Bollywood punchlines or relatable banter.`
        : `You are Friday AI, checking the vibe of WhatsApp group "${groupName}".
Drop an irresistible, hilarious, ultra-engaging icebreaker question or "Would You Rather" scenario that forces all silent group members to reply and start chatting! Use emojis.`;

      const resp = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt });
      const text = resp.text?.trim();
      if (text) {
        const title = isJoke ? `😂 *FRIDAY JOKE OF THE DAY* 🎤` : isFightCooler ? `🕊️ *FRIDAY PEACE & CHILL RADAR* 🧊` : `⚡ *FRIDAY GROUP VIBE CHECK & ICEBREAKER* 🎯`;
        return {
          handled: true,
          replyText: `${title}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n${text}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n_Mahaul set hai, sab log participate karein!_ 🔥`,
        };
      }
    } catch (e: any) {
      return { handled: true, replyText: `⚠️ Vibe check error: ${e?.message || e}` };
    }

    return { handled: true, replyText: `✨ Group vibe is awesome today! 🚀` };
  }

  // ── 12. @liedetector / @psychology Polygraph & Lie Detector ───────────────

  public async handleLieDetector(
    rawText: string,
    quotedMessage?: QuotedMessageContext | null,
    senderName = "Member"
  ): Promise<{ handled: boolean; replyText?: string }> {
    const claim = rawText
      .replace(/^(?:@liedetector|@lie|@psychology|\/liedetector|\/lie|\/psychology|sach\s*ya\s*jhooth)\s*[:=-]?\s*/i, "")
      .trim();

    const targetText = quotedMessage ? quotedMessage.text : claim;
    const targetSender = quotedMessage ? quotedMessage.sender : senderName;

    if (!targetText) {
      return {
        handled: true,
        replyText: `🕵️‍♂️ *AI Lie Detector:* Kripya kisi member ke message par swipe karke \`@liedetector\` likhein ya apna statement dein!`,
      };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        handled: true,
        replyText: `🕵️‍♂️ *Polygraph Scan on ${targetSender}:* Statement appears 75% suspicious! 😂`,
      };
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are Friday AI running an ultra-cool, high-tech, cinematic Psychological Lie Detector & Polygraph scan on a statement in a WhatsApp group.
Statement by ${targetSender}: "${targetText}"

Your task:
Analyze linguistic hedging, stress indicators, excessive justification, excuses, and psychological micro-cues with funny, witty, playful Indian detective humor.

Structure output EXACTLY like this:
🕵️‍♂️ *FRIDAY AI POLYGRAPH & LIE DETECTOR SCAN* 🔬
━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 *Target Subject:* ${targetSender}
📜 *Analyzed Statement:* "${targetText}"
📈 *Linguistic Stress Index:* [Random 75% to 96%] (HIGH)
🧠 *Psychological Micro-Cue:* [Funny analysis of over-explanation or excuse pattern in Hinglish]
🚨 *VERDICT:* [Declare whether it is 92% JHOOTH/CAP or 100% TRUTH with a hilarious, savage reality check]
━━━━━━━━━━━━━━━━━━━━━━━━━━
⚖️ _Polygraph analysis completed by Friday AI!_`;

      const resp = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt });
      const text = resp.text?.trim();
      if (text) return { handled: true, replyText: text };
    } catch (e: any) {
      return { handled: true, replyText: `⚠️ Lie detector scan error: ${e?.message || e}` };
    }

    return { handled: true, replyText: `🕵️‍♂️ *Lie Detector:* Statement analyzed! High cap detected! 😂` };
  }

  // ── 13. @rap Desi Hip-Hop Rap Generator ───────────────────────────────────

  public async handleDesiRapGenerator(
    rawText: string,
    quotedMessage?: QuotedMessageContext | null,
    senderName = "Member"
  ): Promise<{ handled: boolean; replyText?: string }> {
    const target = rawText
      .replace(/^(?:@rap|\/rap|rap\s*banao|rap)\s*[:=-]?\s*/i, "")
      .trim();

    const targetPerson = target || (quotedMessage ? quotedMessage.sender : senderName);
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return {
        handled: true,
        replyText: `🎤 *Gully Cypher:* ${targetPerson} bhai ka swag hard hai, baaki sab bantai card hai! 🔥`,
      };
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Write a super fiery, hilarious, energetic 6 to 8-line Desi Hip-Hop / Gully Boy style Rap Cypher about "${targetPerson}" in a WhatsApp group.
Include funny Indian references (chai, bike, late aana, excuses, swag, gaming, dosti).
Rhymes must be tight and catchy in authentic Hinglish slang (hard, bantai, scene, boss).
CRITICAL: No vulgar/abusive words. Keep it high vibe and purely for friendly laughter.`;

      const resp = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt });
      const text = resp.text?.trim();
      if (text) {
        return {
          handled: true,
          replyText: `🎤 *FRIDAY DESI CYPHER & RAP ARENA* 🔥🎵\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n👑 *Featuring:* ${targetPerson}\n\n${text}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n🎧 _Drop the mic! Yo!_ 💥`,
        };
      }
    } catch (e: any) {
      return { handled: true, replyText: `⚠️ Rap generation error: ${e?.message || e}` };
    }

    return { handled: true, replyText: `🎤 Mic drop for ${targetPerson}! 🔥` };
  }

  // ── 14. @future / @oracle Time-Machine Future Prediction ──────────────────

  public async handleFutureOracle(
    rawText: string,
    quotedMessage?: QuotedMessageContext | null,
    senderName = "Member"
  ): Promise<{ handled: boolean; replyText?: string }> {
    const target = rawText
      .replace(/^(?:@future|@oracle|@kismat|\/future|\/oracle|\/kismat)\s*[:=-]?\s*/i, "")
      .trim();

    const targetPerson = target || (quotedMessage ? quotedMessage.sender : senderName);
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return {
        handled: true,
        replyText: `⏳ *Year 2031 Prediction:* ${targetPerson} will be a billionaire drinking coconut water on a private yacht! 🚀`,
      };
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are Friday AI, looking through the cosmic time-machine 5 to 10 years into the future (Year 2031-2035).
Create a hilarious, ultra-detailed, witty "Future Biography & Destiny Card" for "${targetPerson}" in their WhatsApp group.
Predict their future career, hilarious habits (that never changed), relationship status, and wealth in funny Hinglish.
Keep it positive, clever, and laugh-out-loud funny.`;

      const resp = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt });
      const text = resp.text?.trim();
      if (text) {
        return {
          handled: true,
          replyText: `⏳ *FRIDAY TIME-MACHINE: YEAR 2031 DESTINY* 🔮✨\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *Subject:* ${targetPerson}\n\n${text}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n🌌 _Kismat locked in the blockchain of destiny!_ 🚀`,
        };
      }
    } catch (e: any) {
      return { handled: true, replyText: `⚠️ Future oracle error: ${e?.message || e}` };
    }

    return { handled: true, replyText: `🔮 Future looks legendary for ${targetPerson}! ✨` };
  }

  // ── 15. @srk / @tonystark / @amitabh / @speakas Celebrity Clone ────────────

  public async handleCelebrityClone(
    rawText: string,
    quotedMessage?: QuotedMessageContext | null,
    senderName = "Member"
  ): Promise<{ handled: boolean; replyText?: string }> {
    let celeb = "Shah Rukh Khan";
    const clean = rawText.toLowerCase();

    if (clean.includes("tony") || clean.includes("stark") || clean.includes("ironman")) celeb = "Tony Stark (Iron Man)";
    else if (clean.includes("amitabh") || clean.includes("bachchan") || clean.includes("bigb")) celeb = "Amitabh Bachchan";
    else if (clean.includes("modi") || clean.includes("narendra")) celeb = "Narendra Modi";
    else if (clean.includes("salman") || clean.includes("bhai")) celeb = "Salman Khan";
    else if (clean.includes("babu") || clean.includes("rao") || clean.includes("baburao")) celeb = "Babu Rao (Hera Pheri)";
    else if (clean.includes("munna") || clean.includes("circuit")) celeb = "Munna Bhai & Circuit";
    else if (clean.includes("srk") || clean.includes("shahrukh")) celeb = "Shah Rukh Khan";

    const promptText = rawText
      .replace(/^(?:@srk|@tonystark|@amitabh|@modi|@speakas|\/srk|\/tonystark|\/amitabh|\/modi|\/speakas)\s*[:=-]?\s*/i, "")
      .trim();

    const topic = promptText || (quotedMessage ? quotedMessage.text : "Sab log dhyan se suno");
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return {
        handled: true,
        replyText: `👑 *${celeb} Style:* Picture abhi baaki hai mere dost! ✨`,
      };
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are a legendary voice and persona impersonator of "${celeb}".
Respond to this WhatsApp group topic: "${topic}".
User speaking: ${senderName}.
Use iconic catchphrases, dramatic pauses, signature dialogues, and authentic charisma of ${celeb} in natural Hindi/Hinglish.
Keep it entertaining, 4-5 lines.`;

      const resp = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt });
      const text = resp.text?.trim();
      if (text) {
        return {
          handled: true,
          replyText: `👑 *CELEBRITY PERSONA CLONE: ${celeb.toUpperCase()}* 🎬✨\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n${text}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n🌟 _Official Cinematic Voice Simulation!_ 🍿`,
        };
      }
    } catch (e: any) {
      return { handled: true, replyText: `⚠️ Celebrity clone error: ${e?.message || e}` };
    }

    return { handled: true, replyText: `🎬 Action! ${celeb} is in the house! ✨` };
  }

  // ── 16. @mimic / @clone Member Doppelgänger ───────────────────────────────

  public async handleMemberMimic(
    rawText: string,
    quotedMessage?: QuotedMessageContext | null,
    senderName = "Member"
  ): Promise<{ handled: boolean; replyText?: string }> {
    const target = rawText
      .replace(/^(?:@mimic|@clone|\/mimic|\/clone)\s*[:=-]?\s*/i, "")
      .trim();

    const targetPerson = target || (quotedMessage ? quotedMessage.sender : senderName);
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return {
        handled: true,
        replyText: `🤖 *Simulating @${targetPerson}:* "Haan bhai 2 min me aata hoon..." 😅`,
      };
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are Friday AI doing a funny, hyper-accurate impersonation of a typical college/friend group member named "${targetPerson}".
Context message / query: "${quotedMessage ? quotedMessage.text : rawText}".

Task:
Simulate EXACTLY how ${targetPerson} would reply in WhatsApp:
- Their classic excuses ("so raha tha", "mummy ne kaam bol diya", "battery 2% hai", "traffic me hoon")
- Overuse of their favorite emojis (😅, 😂, 🙏, 👍, 🔥)
- Punctuation quirks and casual, lazy typing.
Keep it 2-3 lines and wildly relatable.`;

      const resp = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt });
      const text = resp.text?.trim();
      if (text) {
        return {
          handled: true,
          replyText: `🤖 *SIMULATING @${targetPerson.toUpperCase()}'S EXACT BRAIN* 👥⚡\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n${text}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n🤣 _(Pakka yehi bolte na? Sach batao!)_`,
        };
      }
    } catch (e: any) {
      return { handled: true, replyText: `⚠️ Mimic error: ${e?.message || e}` };
    }

    return { handled: true, replyText: `🤖 @${targetPerson} mode active! 😅` };
  }

  // ── 17. @movie / @poster Movie Cast & Poster Generator ────────────────────

  public async handleMovieCastPoster(
    sock: any,
    groupJid: string,
    rawText: string,
    senderName: string
  ): Promise<{ handled: boolean; replyText?: string }> {
    const clean = rawText
      .replace(/^(?:@movie|@poster|\/movie|\/poster|movie\s*cast)\s*[:=-]?\s*/i, "")
      .trim();

    const topic = clean || "Avengers Desi Edition with Group Members";
    const apiKey = process.env.GEMINI_API_KEY;
    let synopsisText = `🎬 *BLOCKBUSTER CASTING:* ${topic}`;
    let imagePrompt = `Epic cinematic blockbuster movie poster of ${topic}, Bollywood Hollywood crossover, 8k resolution, dramatic lighting`;

    if (apiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const res = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: `Create an epic Bollywood/Hollywood crossover blockbuster movie cast and plot synopsis for: "${topic}".
Assign funny dramatic character roles (e.g. Mastermind Hero, Sarcastic Tech Guy, Emotional Friend, Main Villain).
Format:
Synopsis: [3-4 lines dramatic trailer script]
PosterPrompt: [Visual description for Hollywood-grade cinematic movie poster]`,
        });
        const full = res.text?.trim() || "";
        const synMatch = full.match(/Synopsis:\s*([\s\S]*?)(?:PosterPrompt:|$)/i);
        const pMatch = full.match(/PosterPrompt:\s*([\s\S]*)/i);
        if (synMatch) synopsisText = `🎬 *FRIDAY BLOCKBUSTER MOVIE CASTING* 🍿⚡\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n${synMatch[1].trim()}\n━━━━━━━━━━━━━━━━━━━━━━━━━━`;
        if (pMatch) imagePrompt = pMatch[1].trim();
      } catch {}
    }

    try {
      const { imageGenerationService } = await import("../imageGenerationService");
      const genRes = await imageGenerationService.generateImage(imagePrompt, { aspectRatio: "16:9" });
      if (genRes.success && genRes.buffer && sock) {
        await sock.sendMessage(groupJid, {
          image: genRes.buffer,
          caption: synopsisText,
        });
        return { handled: true };
      }
    } catch (imgErr) {
      console.warn("[GroupSuperPowers] Movie poster image error:", imgErr);
    }

    return {
      handled: true,
      replyText: `${synopsisText}\n\n🎟️ _In Cinemas Worldwide This Friday!_ 🌟`,
    };
  }

  // ── 18. @commentary Bhojpuri & Sidhu Sports Commentary ────────────────────

  public async handleSportsCommentary(
    rawText: string,
    senderName: string
  ): Promise<{ handled: boolean; replyText?: string }> {
    const clean = rawText
      .replace(/^(?:@commentary|\/commentary|commentary)\s*[:=-]?\s*/i, "")
      .trim();

    const topic = clean || "Virat Kohli hitting iconic cover drive in death overs";
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return {
        handled: true,
        replyText: `🎙️ *Bhojpuri Commentary:* Ee dekhi bhaiya, ball gail boundary ke paar! Chauka! 💥🏏`,
      };
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Write a high-voltage, laugh-out-loud funny cricket/sports live commentary for: "${topic}".
Use authentic high-energy Bhojpuri & Sidhuisms punchlines ("Eee dekhi babua", "Thoko taali", "Dhuaan nikaal diye", "Gagan-chumbi chhakka").
3-4 lines of pure adrenaline and entertainment.`;

      const resp = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt });
      const text = resp.text?.trim();
      if (text) {
        return {
          handled: true,
          replyText: `🎙️ *FRIDAY LIVE DHAMAKA COMMENTARY* 🏏🔥\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n${text}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ _Thoko taali! Boundary paar!_ 💥`,
        };
      }
    } catch (e: any) {
      return { handled: true, replyText: `⚠️ Commentary error: ${e?.message || e}` };
    }

    return { handled: true, replyText: `🏏 Sixer! Ball stadium ke bahar! 💥` };
  }

  // ── 19. Midnight Birthday Cron Worker ─────────────────────────────────────

  public async checkAndTriggerMidnightBirthdays(sock: any): Promise<number> {
    if (!sock) return 0;
    const nowIST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const currentDay = nowIST.getDate();
    const currentMonth = nowIST.getMonth() + 1;
    const currentYear = nowIST.getFullYear();
    const currentHour = nowIST.getHours();

    // Trigger only at midnight (0:00 - 0:30 AM)
    if (currentHour !== 0) return 0;

    let wishedCount = 0;
    if (!this.loadedBirthdays) await this.preloadBirthdays();

    for (const [groupId, bdays] of this.birthdayCache.entries()) {
      for (const b of bdays) {
        if (b.day === currentDay && b.month === currentMonth && b.lastWishedYear !== currentYear) {
          b.lastWishedYear = currentYear;
          const docId = `${groupId}_${b.memberPhone}`;
          bdayCol().doc(docId).set({ lastWishedYear: currentYear }, { merge: true }).catch(() => {});

          const greetingCard = `🎂🎉 *HAPPY BIRTHDAY @${b.memberPhone}!* 🥳🎈
━━━━━━━━━━━━━━━━━━━━━━━━━━
✨ *12:00 AM MIDNIGHT CELEBRATION!* ✨
Aaj hamare pyare dost *${b.memberName}* ka janamdin hai! 👑

Janamdin ki bohot bohot shubhkaamnayein! 🌟
Bhagwan aapko lambi umar, beshumar khushiyan, aur bohot saari success de! 🚀💖
━━━━━━━━━━━━━━━━━━━━━━━━━━
🍕 *Sabhi log birthday boy/girl ko wish karein aur treat ki demand karein!* 😄🎁`;

          try {
            await sock.sendMessage(groupId, {
              text: greetingCard,
              mentions: [`${b.memberPhone}@s.whatsapp.net`],
            });
            wishedCount++;
            console.log(`[GroupSuperPowers] Sent midnight birthday wish to @${b.memberPhone} in ${groupId}`);
          } catch (sendErr) {
            console.warn(`[GroupSuperPowers] Failed to send birthday wish:`, sendErr);
          }
        }
      }
    }
    return wishedCount;
  }

  // ── 9. Natural Language Command Intent Resolver & Smart Suggestion Engine ──

  public async detectAndResolveNaturalCommand(
    sock: any,
    groupJid: string,
    groupName: string,
    rawText: string,
    senderName: string,
    senderPhone: string,
    senderJid: string,
    messageKey: any,
    quotedMessage?: QuotedMessageContext | null,
    isOwner = false
  ): Promise<{ handled: boolean; replyText?: string; mentions?: string[] }> {
    const clean = (rawText || "").toLowerCase().trim();
    if (!clean || clean.length < 4) return { handled: false };

    const { whatsappGroupSafetyEngine } = await import("./whatsappGroupSafetyEngine");

    // ── Phase 1: High-Confidence Rule Matchers (Instant 0-Latency Execution) ──

    // 1. Tag All / Everyone Intent
    if (
      /(?:sabko|sabhi\s*(?:ko|members?|logon?\s*ko)|everyone|all\s*members?)\s*(?:tag|mention|bata|bol|suchna|message|notif)/i.test(clean) ||
      /(?:tag|mention)\s*(?:all|everyone|sabko|sabhi)/i.test(clean)
    ) {
      const msg = rawText.replace(/^(?:friday|hey\s*friday|hi\s*friday)?\s*(?:sabko|sabhi\s*(?:ko|members?)|tag|mention|everyone|all\s*members?)\s*(?:tag|mention|karke|bol\s*do|batao|bolo)?\s*[:=-]?\s*/i, "").trim();
      return await this.handleTagAll(sock, groupJid, groupName, msg || rawText, senderName);
    }

    // 2. Roast Intent
    if (/(?:roast|khilli|beizzati|taang\s*khincho|mazaak\s*udao)\s*(?:karo|kar\s*do|karna)?/i.test(clean)) {
      const target = rawText.replace(/^(?:friday|hey\s*friday)?\s*(?:roast|khilli|beizzati|mazaak)\s*(?:karo|kar\s*do|karna)?\s*(?:ka|ki|ko)?\s*/i, "").trim();
      return await this.handleRoastAndPraise(`@roast ${target}`, quotedMessage, senderName);
    }

    // 3. Praise / Hype-man Intent
    if (/(?:praise|tareef|hype|appreciate|badaai)\s*(?:karo|kar\s*do|karna)?/i.test(clean)) {
      const target = rawText.replace(/^(?:friday|hey\s*friday)?\s*(?:praise|tareef|hype|appreciate)\s*(?:karo|kar\s*do|karna)?\s*(?:ka|ki|ko)?\s*/i, "").trim();
      return await this.handleRoastAndPraise(`@praise ${target}`, quotedMessage, senderName);
    }

    // 4. Group Quiz Intent
    if (/(?:quiz|trivia|game|sawal\s*jawab)\s*(?:shuru|start|khelo|chalao|karo|lagao)/i.test(clean)) {
      const topic = rawText.replace(/^(?:friday|hey\s*friday)?\s*(?:quiz|trivia|game)\s*(?:shuru|start|chalao|karo|lagao)?\s*(?:par|topic)?\s*/i, "").trim();
      return await this.handleGroupQuiz(groupJid, `@quiz start ${topic}`, senderName, senderPhone);
    }

    // 5. Bill Split / Hisaab Intent
    if (/(?:hisaab|hisab|bill|kharcha|paisa|rupees?|split)\s*(?:split|baant|calculate|karo|batao|divide)/i.test(clean) || /(?:split|divide)\s*(?:karo|kar\s*do)?\s*\d+/i.test(clean)) {
      return await this.handleBillSplit(rawText, groupName, senderName);
    }

    // 6. Fact Check / Judge Intent
    if (/(?:fact\s*check|sach\s*kya\s*hai|sahi\s*bol\s*raha|faisla|asliyat\s*batao|kya\s*ye\s*sach)/i.test(clean)) {
      return await this.handleJudgeFactCheck(rawText, quotedMessage, senderName);
    }

    // 7. Decisions / Notes Intent
    if (/(?:kya\s*decide\s*hua|decision|meeting\s*notes|to-?do|tasks?|final\s*kya\s*hua|kya\s*faisla)/i.test(clean)) {
      return await this.handleDecisionTracker(groupJid, groupName, rawText, quotedMessage);
    }

    // 8. Birthday Add / List Intent
    if (/(?:birthday|bday|janamdin)\s*(?:add|save|note|set)\s*(?:karo|kar\s*do)?/i.test(clean) || /(?:ka\s*birthday|ka\s*janamdin)\s*(?:hai|aata|padta)/i.test(clean)) {
      return await this.handleBirthdayManager(groupJid, groupName, `@birthday add ${rawText}`, senderName, senderPhone, quotedMessage);
    }
    if (/(?:birthdays?|janamdin)\s*(?:list|kab\s*hai|upcoming|batao)/i.test(clean)) {
      return await this.handleBirthdayManager(groupJid, groupName, "@birthday list", senderName, senderPhone, quotedMessage);
    }

    // 9. Safety @block safe / @allow all Intent
    if (/(?:gaali|abuse|profanity|gandi\s*photo|nsfw|spam)\s*(?:filter|rok|band|delete|hata|guard|block|security)/i.test(clean) || /(?:safety|guard|security)\s*(?:on|chalu|enable|lagao|start)/i.test(clean)) {
      const res = await whatsappGroupSafetyEngine.enableGroupSafety(groupJid, groupName);
      return { handled: true, replyText: res.message };
    }
    if (/(?:saare|sab|sabhi)\s*(?:filter|warnings?|restriction)\s*(?:hatao|band|off|disable|allow)/i.test(clean) || /(?:allow\s*all|sab\s*allow|free\s*chat)/i.test(clean)) {
      const res = await whatsappGroupSafetyEngine.disableGroupSafety(groupJid);
      return { handled: true, replyText: res.message };
    }

    // 10. Voice Note Auto-Transcribe Intent
    if (/(?:voice\s*notes?|aawaz|audio)\s*(?:ko\s*)?(?:text|transcribe|likh\s*ke|padh\s*ke)\s*(?:bhejo|on|chalu|enable)/i.test(clean)) {
      const msg = await whatsappGroupSafetyEngine.toggleAutoTranscribeVoice(groupJid, true);
      return { handled: true, replyText: msg };
    }
    if (/(?:voice\s*notes?|audio)\s*(?:transcription?)\s*(?:band|off|disable)/i.test(clean)) {
      const msg = await whatsappGroupSafetyEngine.toggleAutoTranscribeVoice(groupJid, false);
      return { handled: true, replyText: msg };
    }

    // 11. Meme & Sticker Generator Intent
    if (/(?:meme\s*banao|koi\s*meme|funny\s*meme|meme\s*create|roast\s*meme|meme\s*dikhao)/i.test(clean)) {
      return await this.handleMemeGenerator(sock, groupJid, rawText, senderName, quotedMessage);
    }

    // 12. Poll Creator Intent
    if (/(?:poll\s*banao|voting\s*start|kisi\s*baat\s*ka\s*poll|poll\s*create|poll\s*dalo)/i.test(clean)) {
      return await this.handlePollCreator(sock, groupJid, rawText, senderName);
    }

    // 13. Live Translator Intent
    if (/(?:translate\s*karo|anuvad\s*karo|isko\s*hindi\s*me|isko\s*english\s*me|isko\s*bengali\s*me|isko\s*marathi\s*me|isko\s*tamil\s*me|isko\s*telugu\s*me)/i.test(clean)) {
      return await this.handleLiveTranslator(rawText, quotedMessage, senderName);
    }


    // 14. Vibe Radar, Icebreaker & Joke Intent
    if (/(?:vibe\s*check|icebreaker|joke\s*sunao|chutkula\s*sunao|group\s*ka\s*mahaul|ladai\s*rok|jhagda\s*rok|bore\s*ho\s*raha)/i.test(clean)) {
      return await this.handleVibeRadarAndIcebreaker(groupJid, groupName, rawText, senderName);
    }

    // 15. AI Lie Detector & Cinematic Polygraph Intent
    if (/(?:sach\s*ya\s*jhooth|jhooth\s*pakdo|jhooth\s*bol\s*raha|lie\s*detector|polygraph|psychology\s*test|stress\s*analysis)/i.test(clean)) {
      return await this.handleLieDetector(rawText, quotedMessage, senderName);
    }

    // 16. AI Desi Hip-Hop / Gully Boy Rap Intent
    if (/(?:rap\s*banao|desi\s*rap|gully\s*rap|cypher\s*banao|rap\s*sunao|diss\s*track)/i.test(clean)) {
      return await this.handleDesiRapGenerator(rawText, quotedMessage, senderName);
    }

    // 17. Time-Machine Future Prediction / Oracle Intent
    if (/(?:future\s*batao|5\s*saal\s*baad|kismat\s*batao|bhavishya\s*batao|future\s*prediction|oracle|kismat\s*khol)/i.test(clean)) {
      return await this.handleFutureOracle(rawText, quotedMessage, senderName);
    }

    // 18. Celebrity Clone & SpeakAs Intent
    if (/(?:srk\s*style|shahrukh\s*style|tony\s*stark\s*style|amitabh\s*style|modi\s*style|speakas|celebrity\s*style)/i.test(clean)) {
      return await this.handleCelebrityClone(rawText, quotedMessage, senderName);
    }

    // 19. Member Doppelganger / Ghost Mimic Intent
    if (/(?:mimic\s*karo|copy\s*karo|iski\s*tarah\s*bolo|clone\s*karo|acting\s*karo|doppelganger)/i.test(clean)) {
      return await this.handleMemberMimic(rawText, quotedMessage, senderName);
    }

    // 20. Movie Cast, Script & Poster Intent
    if (/(?:movie\s*cast|poster\s*banao|filmi\s*poster|film\s*banao|trailer\s*banao|blockbuster\s*movie)/i.test(clean)) {
      return await this.handleMovieCastPoster(sock, groupJid, rawText, senderName);
    }

    // 21. High-Energy Cricket / Sports Commentary Intent
    if (/(?:commentary\s*sunao|bhojpuri\s*commentary|cricket\s*commentary|sidhu\s*commentary|ipl\s*commentary)/i.test(clean)) {
      return await this.handleSportsCommentary(rawText, senderName);
    }

    // ── Phase 2: Suspicious / Ambiguous Intent Classifier (Gemini AI Powered) ─
    const isPotentiallyCommandRelated =
      /(?:tag|mention|roast|tareef|quiz|khel|game|bill|hisab|split|sach|fact|faisla|decision|birthday|janamdin|filter|gaali|safety|voice|audio|quiet|welcome|commands?|rule|rules|lie|jhooth|rap|future|kismat|srk|tony|amitabh|modi|mimic|clone|movie|poster|commentary)/i.test(clean);

    if (isPotentiallyCommandRelated && clean.includes("friday")) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey) {
        try {
          const ai = new GoogleGenAI({ apiKey });
          const prompt = `You are Friday AI, analyzing whether a user's natural language group message was attempting to trigger one of the available group features/commands.

User message in group: "${rawText}"
Speaker: ${senderName}

Available Group Capabilities:
1. "@everyone [message]" / "@tagall" -> Mentions and notifies all group members for important announcements.
2. "@block safe" -> Enables anti-profanity (gaali filter), anti-NSFW media, anti-spam, and 3-strike kick guard.
3. "@allow all" -> Disables all safety filters and warnings for completely free chat.
4. "@voicenote on/off" -> Automatically transcribes all group voice notes into text cards.
5. "@quiz start [topic]" -> Starts an interactive 5-round group live trivia showdown.
6. "@roast [name]" -> Playful, witty, funny stand-up comedy roast of a member.
7. "@praise [name]" -> High-energy superhero hype-man appreciation card.
8. "@split [amount] [item] [names]" -> Group bill expense & UPI Splitwise calculator.
9. "@judge [claim]" / "@factcheck" -> Verifies claims with real facts and delivers an AI courtroom verdict.
10. "@decision" -> Scans recent conversation to extract agreed plans and assigned tasks.
11. "@birthday add [name] [date]" -> Saves member birthdays for 12:00 AM midnight celebration.
12. "@quiet mode on/off" -> Night quiet mode between 11 PM and 6:30 AM.
13. "@welcome on/off" -> Welcome greeting cards for new members.
14. "@liedetector [claim]" -> AI Polygraph stress analyzer & truth rating.
15. "@rap [name/topic]" -> Hardcore Desi Hip-Hop Gully Boy 8-bar rap.
16. "@future [name]" -> Time machine 2031 hilarious destiny & lifestyle prophecy.
17. "@srk" / "@tonystark" / "@amitabh" / "@modi" [dialogue] -> Celebrity dialogue & style generator.
18. "@mimic [name]" -> Imitates the speaking style & catchphrases of a group member.
19. "@movie [title]" -> Casts group members in a blockbuster film trailer and generates poster.
20. "@commentary [scenario]" -> High-voltage Bhojpuri or Sidhu style live match commentary.

Determine:
1. "CONFIDENT_EXECUTE": If user clearly asked for one of these capabilities. Output: { "action": "EXECUTE", "command": "...", "args": "..." }
2. "SUSPICIOUS_SUGGEST": If user's message is ambiguous, confused, or inquiring about capabilities. Output: { "action": "SUGGEST", "matchedCommands": [ { "cmd": "@...", "desc": "..." } ] }
3. "NORMAL_CHAT": If it is just normal chat. Output: { "action": "IGNORE" }

Output STRICT JSON only:
{
  "action": "EXECUTE" | "SUGGEST" | "IGNORE",
  "command": "@everyone",
  "args": "message text",
  "matchedCommands": [
    { "cmd": "@tagall [Message]", "desc": "Group ke sabhi members ko urgent notice ke liye tag karega." },
    { "cmd": "@quiz start [Topic]", "desc": "Group me live trivia quiz shuru karega." }
  ]
}`;

          const resp = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: { responseMimeType: "application/json" },
          });

          const json = JSON.parse(resp.text?.trim() || "{}");

          if (json.action === "EXECUTE" && json.command) {
            const execCmd = `${json.command} ${json.args || ""}`.trim();
            if (this.isSuperPowerCommand(execCmd)) {
              return await this.handleSuperPowerCommand(
                sock,
                groupJid,
                groupName,
                execCmd,
                senderName,
                senderPhone,
                senderJid,
                messageKey,
                quotedMessage,
                isOwner
              );
            }
          } else if (json.action === "SUGGEST" && Array.isArray(json.matchedCommands) && json.matchedCommands.length > 0) {
            const cmdItems = json.matchedCommands
              .slice(0, 3)
              .map((c: any, idx: number) => `${idx + 1}️⃣ \`${c.cmd}\`:\n   👉 ${c.desc}`)
              .join("\n\n");

            const suggestionCard = `💡 *Aap ye command chalana chahte hain kya?*
━━━━━━━━━━━━━━━━━━━━━━━━━━
${cmdItems}
━━━━━━━━━━━━━━━━━━━━━━━━━━
💬 _(Aap command par reply karke ya directly type karke chala sakte hain!)_`;

            return { handled: true, replyText: suggestionCard };
          }
        } catch (aiErr) {
          console.warn("[GroupSuperPowers] Intent classification AI error:", aiErr);
        }
      }
    }

    return { handled: false };
  }
}

export const whatsappGroupSuperPowersEngine = new WhatsAppGroupSuperPowersEngine();

