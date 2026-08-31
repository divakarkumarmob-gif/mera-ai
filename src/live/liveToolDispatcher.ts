/**
 * FRIDAY AI — Gemini Live Tool Dispatcher
 * Bridges and executes tool calls triggered during real-time Gemini Live voice streaming.
 */

import { memoryEngine } from "../services/memoryEngine";
import { toolsEngine } from "../services/toolsEngine";
import { contactsService } from "../services/contactsService";
import { whatsappBotService } from "../services/whatsappBotService";
import { whatsappCloudService } from "../services/whatsappCloudService";
import { sendWhatsAppUnified } from "../services/whatsappService";
import { dailyUpdateService, resolveRelativeDateIST } from "../services/dailyUpdateService";
import { codeAgentService } from "../services/codeAgentService";
import { publicApisService } from "../services/publicApisService";
import { saveMessage, getHistory, clearHistory } from "../services/historyService";
import { visionMemoryService } from "../services/visionMemoryService";
import { voiceBiometricsService } from "../services/voiceBiometricsService";
import { telegramBotService } from "../services/telegramBotService";
import { instagramBotService } from "../services/instagramBotService";
import { cyberSecurityService } from "../services/cyberSecurityService";
import { backgroundTasksService } from "../services/backgroundTasksService";
import { appSecurityService } from "../services/appSecurityService";
import { webCrawlerService } from "../services/webCrawlerService";
import { railRadarService } from "../services/railRadarService";
import { weatherService } from "../services/weatherService";
import { newsService } from "../services/newsService";
import { bossRoutineService } from "../services/bossRoutineService";
import { fridayLearningService } from "../services/fridayLearningService";
import { vectorMemoryService } from "../services/vectorMemoryService";
import { liveScratchService } from "../services/liveScratchService";
import { smartMemoryRetrieverService } from "../services/smartMemoryRetrieverService";
import { memoryBackupService } from "../services/memoryBackupService";
import { telegramSecurityBotService } from "../services/telegramSecurityBotService";
import { networkDeviceScannerService } from "../services/networkDeviceScannerService";
import { jioSaavnService } from "../services/jioSaavnService";
import { youtubeMusicService } from "../services/youtubeMusicService";
import { calendarEventService } from "../services/calendarEventService";
import { productPriceService } from "../services/productPriceService";
import { priceDropTrackerService } from "../services/priceDropTrackerService";
import { ecommerceOrderService } from "../services/ecommerceOrderService";
import { autonomousBuyerService } from "../services/autonomousBuyerService";

export interface ToolDispatchContext {
  sessionId: string;
  clientWs?: any;
  safeSend: (payload: string) => void;
  connectedClients?: Set<any>;
  getBaileysEnabled?: () => boolean;
  setBaileysEnabled?: (enabled: boolean) => void;
}

export async function dispatchLiveToolCall(call: any, context: ToolDispatchContext): Promise<any> {
  const {
    sessionId,
    clientWs,
    safeSend,
    connectedClients = new Set(),
    getBaileysEnabled = () => false,
    setBaileysEnabled = () => {},
  } = context;

  console.log(`[Friday Tools] Calling function: ${call.name}`, call.args);
  let result: any = { error: "Unknown tool call" };

  try {
                if (call.name === "start_background_task") {
                  const { taskName, taskType, targetOrQuery, description } = call.args || {};
                  try {
                    const task = await backgroundTasksService.executeAutonomousTask(
                      String(taskName || "Background Task"),
                      String(taskType || "custom"),
                      String(targetOrQuery || ""),
                      description ? String(description) : undefined
                    );
                    result = {
                      success: true,
                      taskId: task.id,
                      taskName: task.name,
                      status: task.status,
                      message: `Boss, '${task.name}' background me start kar diya hai! Jaise hi complete hoga main aapko bata dungi.`,
                    };
                    clientWs.send(JSON.stringify({ type: "background_task_started", task }));
                  } catch (e: any) {
                    result = { success: false, message: `Could not start background task: ${e?.message || e}` };
                  }
                } else if (call.name === "get_background_tasks_status") {
                  const { query } = call.args || {};
                  try {
                    const statusSummary = backgroundTasksService.getTaskStatusSummary(query ? String(query) : undefined);
                    result = {
                      success: true,
                      ...statusSummary,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Could not retrieve background tasks: ${e?.message || e}` };
                  }
                } else if (call.name === "mark_background_task_notified") {
                  const { taskId } = call.args || {};
                  backgroundTasksService.markTaskNotified(String(taskId || "all"));
                  result = { success: true, message: "Task marked as notified to DK." };
                } else if (call.name === "cancel_background_task") {
                  const { taskIdOrName } = call.args || {};
                  const cancelled = backgroundTasksService.cancelTask(String(taskIdOrName || ""));
                  result = {
                    success: cancelled,
                    message: cancelled ? "Task successfully cancelled." : "No matching running task found to cancel.",
                  };
                } else if (call.name === "request_code_change") {
                  const { instruction } = call.args || {};
                  if (instruction && String(instruction).trim()) {
                    await codeAgentService.createRequest(String(instruction));
                    result = {
                      success: true,
                      message: "Samajh gayi, main repo analyze karke plan bana rahi hoon. Aapko WhatsApp aur dashboard dono pe update milega.",
                    };
                  } else {
                    result = { success: false, message: "No instruction provided." };
                  }
                } else if (call.name === "remember_personal_fact") {
                  const { factText, category } = call.args || {};
                  if (factText && String(factText).trim()) {
                    await memoryEngine.addPersonalVaultFact(category || "general_personal_info", String(factText));
                    result = { success: true, message: "Fact saved to permanent memory." };
                  } else {
                    result = { success: false, message: "No factText provided." };
                  }
                } else if (call.name === "add_custom_skill_or_rule") {
                  const { skillName, ruleInstruction, triggerPhrase } = call.args || {};
                  const fact = `Rule/Skill: "${skillName}" -> ${ruleInstruction}${triggerPhrase ? ` (When: ${triggerPhrase})` : ""}`;
                  await memoryEngine.addPersonalVaultFact("custom_skill", fact);
                  result = { success: true, message: `Skill "${skillName}" successfully integrated into Friday's brain!` };
                  clientWs.send(JSON.stringify({ type: "skill_added", skill: { skillName, ruleInstruction } }));
                } else if (call.name === "save_contact") {
                  const { contactName, phoneNumber, relation } = call.args || {};
                  const entry = await contactsService.saveContact(contactName, phoneNumber, relation);
                  result = { success: true, message: `Contact "${contactName}" (+${entry.phone}) successfully saved to DK's contacts book!` };
                  clientWs.send(JSON.stringify({ type: "contact_saved", contact: entry }));
                } else if (call.name === "delete_contact") {
                  const { contactNameOrPhone } = call.args || {};
                  const delRes = await contactsService.deleteContact(contactNameOrPhone);
                  result = delRes.deleted
                    ? { success: true, message: `Contact "${delRes.name}" (+${delRes.phone}) has been deleted from DK's contacts book.` }
                    : { success: false, message: `No matching contact found for "${contactNameOrPhone}" — nothing was deleted.` };
                  clientWs.send(JSON.stringify({ type: "contact_deleted", ...result }));
                } else if (call.name === "send_whatsapp_to_contact") {
                  const { contactNameOrPhone, messageText } = call.args || {};
                  const contact = await contactsService.findContact(contactNameOrPhone);
                  const targetPhone = contact ? contact.phone : contactNameOrPhone.replace(/[\s\-\(\)\+]/g, "");

                  // Primary: WhatsApp Cloud API (official, ban-safe).
                  // Fallback: Dedicated Baileys bot if linked.
                  const sendRes = await sendWhatsAppUnified(targetPhone, messageText);

                  result = {
                    success: sendRes.success,
                    via: sendRes.via,
                    message: sendRes.success
                      ? `Message successfully delivered to ${contact?.name || targetPhone}: "${messageText}"`
                      : `Delivery failed: ${sendRes.message}`,
                  };
                  clientWs.send(JSON.stringify({ type: "whatsapp_contact_sent", ...result }));
                } else if (call.name === "pair_dedicated_whatsapp_number") {
                  const { phoneNumber } = call.args || {};
                  try {
                    const code = await whatsappBotService.requestPairingCode(phoneNumber);
                    result = { success: true, pairingCode: code, message: `Pairing Code generated: ${code}. Link it in WhatsApp -> Linked Devices.` };
                    clientWs.send(JSON.stringify({ type: "pairing_code_ready", pairingCode: code }));
                  } catch (e: any) {
                    result = { success: false, message: `Failed to generate pairing code: ${e?.message || e}` };
                  }
                } else if (call.name === "set_reminder") {
                  const { title, timeString, durationMinutes } = call.args || {};
                  const reminder = await toolsEngine.addReminder(title, timeString, durationMinutes);
                  result = { success: true, message: `Reminder set: "${title}" for ${timeString || `${durationMinutes}m`}` };
                  clientWs.send(JSON.stringify({ type: "reminder_created", reminder }));
                } else if (call.name === "save_quick_note") {
                  const { title, content } = call.args || {};
                  const note = await toolsEngine.addNote(title, content);
                  result = { success: true, message: `Note "${title}" saved to DK's notebook.` };
                  clientWs.send(JSON.stringify({ type: "note_saved", note }));
                } else if (call.name === "get_whatsapp_latest_media") {
                  const { query } = call.args || {};
                  try {
                    result = await visionMemoryService.getLatestMediaInfo(query ? String(query) : undefined);
                  } catch (e: any) {
                    result = { hasMedia: false, analysis: `Media fetch error: ${e?.message || e}` };
                  }
                } else if (call.name === "get_whatsapp_messages") {
                  const { messageType, senderName, groupName, dateFilter, limit } = call.args || {};
                  try {
                    const msgs = await whatsappBotService.getMessages({
                      messageType: messageType || "all",
                      senderName,
                      groupName,
                      dateFilter,
                      limit: limit ? parseInt(limit) : undefined,
                    });
                    if (msgs.length === 0) {
                      result = { success: true, messages: [], summary: "Koi WhatsApp message nahi mila is filter ke sath." };
                    } else {
                      // ── Smart formatter ──────────────────────────────────────
                      // Helper: classify media type from text label
                      const mediaLabel = (text: string): string | null => {
                        if (text === "[Image]") return "ek photo";
                        if (text === "[Video]") return "ek video";
                        if (text === "[Voice Message]") return "ek voice message";
                        if (text === "[Sticker]") return "ek sticker";
                        if (text.startsWith("[Document]") || text === "[Document]") return "ek document";
                        if (/\.pdf/i.test(text) || text.includes("PDF")) return "ek PDF file";
                        if (text === "[Location]") return "location";
                        if (text.startsWith("[Contact:")) return "ek contact card";
                        if (text.startsWith("[Reaction:")) return null; // skip reactions
                        return null; // regular text
                      };

                      // Group by sender (phone for personal, phone+group for group)
                      const bySender = new Map<string, typeof msgs>();
                      for (const m of msgs) {
                        const key = m.isGroup ? `${m.senderPhone}@${m.groupId}` : m.senderPhone;
                        if (!bySender.has(key)) bySender.set(key, []);
                        bySender.get(key)!.push(m);
                      }

                      const summaryLines: string[] = [];
                      for (const senderMsgs of bySender.values()) {
                        const first = senderMsgs[0]; // newest first
                        const last = senderMsgs[senderMsgs.length - 1]; // oldest
                        const count = senderMsgs.length;

                        // Sender label: unknown vs known vs group
                        const senderLabel = first.isUnknownContact
                          ? `Unknown Number (+${first.senderPhone})`
                          : first.isGroup
                            ? `${first.senderName} in ${first.groupName}`
                            : first.senderName;

                        if (count === 1) {
                          const media = mediaLabel(first.text);
                          const content = media ? `${media} bheja` : `"${first.text}"`;
                          summaryLines.push(
                            `SENDER: ${senderLabel} | UNKNOWN: ${first.isUnknownContact} | TIME: ${first.dateStr} | COUNT: 1 | CONTENT: ${content}`
                          );
                        } else {
                          // Multiple messages — count by type
                          const textMsgs = senderMsgs.filter(m => !m.text.startsWith("["));
                          const mediaMsgs = senderMsgs.filter(m => m.text.startsWith("["));
                          const mediaTypes = [...new Set(mediaMsgs.map(m => mediaLabel(m.text)).filter(Boolean))].join(", ");

                          let countDesc = `${count} messages`;
                          if (textMsgs.length && mediaMsgs.length) {
                            countDesc = `${textMsgs.length} text message${textMsgs.length > 1 ? "s" : ""} aur ${mediaTypes}`;
                          } else if (mediaMsgs.length && !textMsgs.length) {
                            countDesc = `${count} media (${mediaTypes})`;
                          }

                          summaryLines.push(
                            `SENDER: ${senderLabel} | UNKNOWN: ${first.isUnknownContact} | FROM: ${last.dateStr} TO: ${first.dateStr} | COUNT: ${count} | SUMMARY: ${countDesc} | LAST_MSG: "${first.text}" | OLDEST_MSG: "${last.text}"`
                          );
                        }
                      }

                      const totalSenders = bySender.size;
                      result = {
                        success: true,
                        count: msgs.length,
                        senderCount: totalSenders,
                        summary: summaryLines.join("\n"),
                        instruction: "Read summary naturally. For unknown contacts say 'Boss, unknown number hai'. For multiple messages say count and ask if user wants last message or from beginning. For media clearly say what type was sent.",
                      };
                    }
                    clientWs.send(JSON.stringify({ type: "whatsapp_messages_read", count: msgs.length }));
                  } catch (e: any) {
                    result = { success: false, message: `Could not fetch messages: ${e?.message || e}` };
                  }
                } else if (call.name === "set_whatsapp_reply_limit") {
                  const { contactNameOrPhone, newLimit } = call.args || {};
                  try {
                    const limitRes = await whatsappBotService.setContactReplyLimit(
                      String(contactNameOrPhone || ""),
                      Number(newLimit)
                    );
                    result = limitRes;
                    if (limitRes.success) {
                      clientWs.send(JSON.stringify({ type: "whatsapp_reply_limit_set", contact: contactNameOrPhone, newLimit }));
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Could not set reply limit: ${e?.message || e}` };
                  }
                } else if (call.name === "save_daily_update") {
                  const { updateText } = call.args || {};
                  try {
                    if (!updateText || !String(updateText).trim()) {
                      result = { success: false, message: "No update text provided." };
                    } else {
                      const entry = await dailyUpdateService.appendUpdate(String(updateText).trim());
                      result = { success: true, message: "Update saved for today.", dateStr: entry.dateStr };
                      clientWs.send(JSON.stringify({ type: "daily_update_saved", dateStr: entry.dateStr }));
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Could not save update: ${e?.message || e}` };
                  }
                } else if (call.name === "get_daily_update") {
                  const { dateWord } = call.args || {};
                  try {
                    const resolvedDate = resolveRelativeDateIST(String(dateWord || "aaj"));
                    const entry = await dailyUpdateService.getUpdateForDate(resolvedDate);
                    result = entry?.text
                      ? { success: true, dateStr: resolvedDate, updateText: entry.text }
                      : { success: true, dateStr: resolvedDate, updateText: null, message: "Is din ke liye koi update note nahi kiya gaya tha." };
                  } catch (e: any) {
                    result = { success: false, message: `Could not fetch update: ${e?.message || e}` };
                  }
                } else if (call.name === "get_boss_daily_routine") {
                  try {
                    const currentInfo = bossRoutineService.getCurrentHabit();
                    const allSlots = await bossRoutineService.getAllRoutineSlots();
                    result = {
                      success: true,
                      currentTimeIST: currentInfo.istTimeStr,
                      currentHabit: currentInfo.currentSlot,
                      nextHabit: currentInfo.nextSlot,
                      timetable: allSlots.map((s) => ({
                        time: s.timeRangeStr,
                        title: s.title,
                        activity: s.activity,
                      })),
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Could not fetch routine: ${e?.message || e}` };
                  }
                } else if (call.name === "update_boss_daily_routine") {
                  const { slotQuery, startTimeStr, endTimeStr, activity, title } = call.args || {};
                  try {
                    result = await bossRoutineService.updateRoutineSlot(String(slotQuery || ""), {
                      startTimeStr: startTimeStr ? String(startTimeStr) : undefined,
                      endTimeStr: endTimeStr ? String(endTimeStr) : undefined,
                      activity: activity ? String(activity) : undefined,
                      title: title ? String(title) : undefined,
                    });
                  } catch (e: any) {
                    result = { success: false, message: `Could not update routine: ${e?.message || e}` };
                  }
                } else if (call.name === "record_ai_self_correction") {
                  const { whatFridayDidWrong, whatBossTaught, goldenRule, triggerContext } = call.args || {};
                  try {
                    result = await fridayLearningService.recordLesson({
                      whatFridayDidWrong: String(whatFridayDidWrong || ""),
                      whatBossTaught: String(whatBossTaught || ""),
                      goldenRule: String(goldenRule || ""),
                      triggerContext: triggerContext ? String(triggerContext) : undefined,
                    });
                  } catch (e: any) {
                    result = { success: false, message: `Could not save lesson: ${e?.message || e}` };
                  }
                } else if (call.name === "get_ai_learned_lessons") {
                  try {
                    const lessons = await fridayLearningService.getAllLessons();
                    result = {
                      success: true,
                      totalLessons: lessons.length,
                      lessons: lessons.map((l) => ({
                        id: l.id,
                        whatFridayDidWrong: l.whatFridayDidWrong,
                        whatBossTaught: l.whatBossTaught,
                        goldenRule: l.goldenRule,
                        date: l.dateStr,
                      })),
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Could not fetch lessons: ${e?.message || e}` };
                  }
                } else if (call.name === "search_long_term_vector_memory") {
                  const { searchQuery, limit, filterDate } = call.args || {};
                  try {
                    result = await vectorMemoryService.searchSemanticMemory(
                      String(searchQuery || ""),
                      limit ? Number(limit) : 5,
                      0.15,
                      filterDate ? { exactDate: String(filterDate) } : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Vector search failed: ${e?.message || e}` };
                  }
                } else if (call.name === "get_memory_lifecycle_status") {
                  try {
                    const vectorStats = await vectorMemoryService.getVectorStoreStats();
                    const memories = await memoryEngine.getMemories();
                    result = {
                      success: true,
                      lifecycleStatus: {
                        activeSessionsCount: memories.pastSessionsCount,
                        vectorStoreStats: vectorStats,
                        retentionRules: {
                          exactSessions: "4 Days (verbatim word-to-word with timestamps)",
                          comprehensiveSummaries: "4 to 60 Days",
                          permanentVectorArchival: "60+ Days (lifetime)",
                          dailyUpdatesVerbatim: "30 Days (word-to-word)",
                          liveScratchCache: "24 Hours (real-time crash-proof Firestore stream)",
                        },
                      },
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Could not fetch lifecycle status: ${e?.message || e}` };
                  }
                } else if (call.name === "retrieve_smart_multi_tier_context") {
                  const { utterance } = call.args || {};
                  try {
                    result = await smartMemoryRetrieverService.fetchMultiTierMemory(String(utterance || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Multi-tier memory retrieval failed: ${e?.message || e}` };
                  }
                } else if (call.name === "get_weather") {
                  const { place } = call.args || {};
                  try {
                    result = await publicApisService.getWeather(String(place || ""));
                    if (!result || !result.success) {
                      const bgTask = await backgroundTasksService.executeAutonomousTask(
                        `Weather Update (${place || "Local"})`,
                        "weather",
                        String(place || "")
                      );
                      result = {
                        success: false,
                        message: `Boss, ${place || "local"} weather instant connect nahi ho paya. Maine background me update start kar diya hai, jald hi complete karke batati hu!`,
                        backgroundTaskId: bgTask.id,
                      };
                    }
                  } catch (e: any) {
                    const bgTask = await backgroundTasksService.executeAutonomousTask(
                      `Weather Update (${place || "Local"})`,
                      "weather",
                      String(place || "")
                    );
                    result = {
                      success: false,
                      message: `Boss, weather fetch karne me dikkat aayi. Maine background me weather update laga diya hai, main update karke aapko batati hu!`,
                      backgroundTaskId: bgTask.id,
                    };
                  }
                } else if (call.name === "get_air_quality") {
                  const { place } = call.args || {};
                  try {
                    result = await publicApisService.getAirQuality(String(place || ""));
                  } catch (e: any) {
                    result = { success: false, message: `AQI fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_sunrise_sunset") {
                  const { place } = call.args || {};
                  try {
                    result = await publicApisService.getSunriseSunset(String(place || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Sunrise/sunset fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_recent_earthquakes") {
                  try {
                    result = await publicApisService.getRecentEarthquakes();
                  } catch (e: any) {
                    result = { success: false, message: `Earthquake data fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_exchange_rate") {
                  const { fromCurrency, toCurrency } = call.args || {};
                  try {
                    result = await publicApisService.getExchangeRate(String(fromCurrency || ""), String(toCurrency || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Exchange rate fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_crypto_price") {
                  const { coinId, vsCurrency } = call.args || {};
                  try {
                    result = await publicApisService.getCryptoPrice(String(coinId || ""), vsCurrency ? String(vsCurrency) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Crypto price fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_wikipedia_summary") {
                  const { topic } = call.args || {};
                  try {
                    result = await publicApisService.getWikipediaSummary(String(topic || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Wikipedia fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_current_time" || call.name === "get_time" || call.name === "get_live_clock") {
                  const now = new Date();
                  const istTime = now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
                  const istDate = now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", year: "numeric" });
                  result = {
                    success: true,
                    currentTime: istTime,
                    currentDate: istDate,
                    timezone: "Asia/Kolkata (Indian Standard Time)",
                    timestamp: now.getTime(),
                    message: `Boss, abhi theek ${istTime} ho rahe hain, aaj ${istDate} hai.`,
                  };
                } else if (call.name === "get_wikiquote_summary") {
                  const { person } = call.args || {};
                  try {
                    result = await publicApisService.getWikiquote(String(person || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Wikiquote fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_book") {
                  const { title } = call.args || {};
                  try {
                    result = await publicApisService.searchBook(String(title || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Book search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_word_meaning") {
                  const { word } = call.args || {};
                  try {
                    result = await publicApisService.getWordMeaning(String(word || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Word meaning fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_country_info") {
                  const { country } = call.args || {};
                  try {
                    result = await publicApisService.getCountryInfo(String(country || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Country info fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_number_fact") {
                  const { number } = call.args || {};
                  try {
                    result = await publicApisService.getNumberFact(Number(number));
                  } catch (e: any) {
                    result = { success: false, message: `Number fact fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_trivia_question") {
                  try {
                    result = await publicApisService.getTriviaQuestion();
                  } catch (e: any) {
                    result = { success: false, message: `Trivia fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_pincode_info") {
                  const { pincode } = call.args || {};
                  try {
                    result = await publicApisService.getPinCodeInfo(String(pincode || ""));
                  } catch (e: any) {
                    result = { success: false, message: `PIN code fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_nearby_places") {
                  const { place, amenity } = call.args || {};
                  try {
                    result = await publicApisService.getNearbyPlaces(String(place || ""), String(amenity || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Nearby places fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_timezone_info") {
                  const { place } = call.args || {};
                  try {
                    result = await publicApisService.getTimeZoneInfo(String(place || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Timezone fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_covid_stats") {
                  const { country } = call.args || {};
                  try {
                    result = await publicApisService.getCovidStats(country ? String(country) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `COVID stats fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_qr_code") {
                  const { text } = call.args || {};
                  result = publicApisService.getQrCodeUrl(String(text || ""));
                } else if (call.name === "get_random_user") {
                  try {
                    result = await publicApisService.getRandomUser();
                  } catch (e: any) {
                    result = { success: false, message: `Random user generate fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_github_user_info") {
                  const { username } = call.args || {};
                  try {
                    result = await publicApisService.getGithubUserInfo(String(username || ""));
                  } catch (e: any) {
                    result = { success: false, message: `GitHub user fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "compare_product_prices") {
                  const { query } = call.args || {};
                  const searchQuery = String(query || "").trim();
                  try {
                    const compRes = await productPriceService.compareProductAcrossStores(searchQuery);
                    const allProducts = [
                      ...(compRes.stores.flipkart || []),
                      ...(compRes.stores.amazon || []),
                      ...(compRes.stores.meesho || [])
                    ].filter(p => p.price > 0);

                    // Sort so best deals are at the front
                    allProducts.sort((a, b) => a.price - b.price);

                    // Send interactive horizontal carousel deck to frontend UI
                    if (allProducts.length > 0) {
                      safeSend(JSON.stringify({
                        type: "ecommerce_product_deck",
                        products: allProducts,
                        activeIndex: 0,
                        query: searchQuery
                      }));
                    }

                    result = {
                      success: true,
                      query: searchQuery,
                      totalProducts: allProducts.length,
                      bestDeal: compRes.bestDeal,
                      topProduct: allProducts.length > 0 ? allProducts[0] : null,
                      allProducts: allProducts.slice(0, 8),
                      instructionForFriday: allProducts.length > 0
                        ? `Product #1 ("${allProducts[0].title}" on ${allProducts[0].store} for ₹${allProducts[0].price}) is currently HIGHLIGHTED on the user's screen dashboard. Speak its price, store, and discount first. If user says 'pasand nahi aaya', 'dusra dikhao', or asks for next, call highlight_ecommerce_product with index 1.`
                        : `No live products found for "${searchQuery}". Tell Boss politely.`
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Price comparison fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "highlight_ecommerce_product") {
                  const { index } = call.args || {};
                  const targetIdx = Math.max(0, Number(index) || 0);
                  try {
                    safeSend(JSON.stringify({
                      type: "ecommerce_highlight_index",
                      index: targetIdx
                    }));
                    result = {
                      success: true,
                      highlightedIndex: targetIdx,
                      instructionForFriday: `Product at position #${targetIdx + 1} is now HIGHLIGHTED on screen. Speak this product's title, price, and store details clearly to the user.`
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Highlight product fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "place_ecommerce_order") {
                  const { productName, price, paymentMethod, store, productUrl, deliveryAddress, authorizationPin } = call.args || {};
                  try {
                    if (authorizationPin) {
                      const pinCheck = await voiceBiometricsService.verifyVoicePin(String(authorizationPin));
                      if (!pinCheck.valid) {
                        result = {
                          success: false,
                          message: "Boss, diya gaya App Password / Voice PIN galat hai! Security authorization fail ho gaya.",
                          instructionForFriday: "Diya gaya password/PIN galat hai. Boss ko batao ki PIN match nahi hua isliye order hold par hai.",
                        };
                        return result;
                      }
                    }

                    const isCod = String(paymentMethod || "").toUpperCase().includes("COD") ||
                                  String(paymentMethod || "").toLowerCase().includes("cash");
                    const method = isCod ? "COD" : "ONLINE_UPI";

                    const orderRes = await ecommerceOrderService.createOrder({
                      productName: String(productName || "Product"),
                      price: Number(price) || 0,
                      paymentMethod: method,
                      store: store ? String(store) : undefined,
                      productUrl: productUrl ? String(productUrl) : undefined,
                      customAddress: deliveryAddress ? String(deliveryAddress) : undefined,
                    });

                    safeSend(JSON.stringify({
                      type: "ecommerce_order_placed",
                      order: orderRes.order,
                    }));

                    result = {
                      success: true,
                      orderId: orderRes.order.id,
                      paymentMethod: orderRes.order.paymentMethod,
                      speechMessage: orderRes.speechMessage,
                      paymentLinks: orderRes.order.paymentLinks,
                      instructionForFriday: orderRes.speechMessage,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Order placement fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "open_store_login_helper") {
                  const { store } = call.args || {};
                  const targetStore = String(store || "").toLowerCase().includes("amazon") ? "amazon" : "flipkart";
                  try {
                    const loginRes = await autonomousBuyerService.openInteractiveLogin(targetStore);
                    result = {
                      success: true,
                      store: targetStore,
                      message: loginRes.message,
                      instructionForFriday: loginRes.message,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Login window open karne me error: ${e?.message || e}` };
                  }
                } else if (call.name === "send_product_buy_link") {
                  const { productName, price, store, productUrl } = call.args || {};
                  try {
                    const linkRes = await ecommerceOrderService.sendDirectBuyLink({
                      productName: String(productName || "Product"),
                      price: Number(price) || 0,
                      store: String(store || "Store"),
                      productUrl: String(productUrl || ""),
                    });
                    result = {
                      success: true,
                      message: linkRes.speechMessage,
                      instructionForFriday: linkRes.speechMessage,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Buy link dispatch error: ${e?.message || e}` };
                  }
                } else if (call.name === "get_github_repo_info") {
                  const { owner, repo } = call.args || {};
                  try {
                    result = await publicApisService.getGithubRepoInfo(String(owner || ""), String(repo || ""));
                  } catch (e: any) {
                    result = { success: false, message: `GitHub repo fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_ip_lookup") {
                  const { ip } = call.args || {};
                  try {
                    result = await publicApisService.getIpLookup(String(ip || ""));
                  } catch (e: any) {
                    result = { success: false, message: `IP lookup fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_dad_joke") {
                  try {
                    result = await publicApisService.getDadJoke();
                  } catch (e: any) {
                    result = { success: false, message: `Joke fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_chuck_norris_joke") {
                  try {
                    result = await publicApisService.getChuckNorrisJoke();
                  } catch (e: any) {
                    result = { success: false, message: `Joke fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_public_holidays") {
                  const { countryCode, year } = call.args || {};
                  try {
                    result = await publicApisService.getPublicHolidays(countryCode ? String(countryCode) : undefined, year ? Number(year) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Holiday list fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_anime") {
                  const { title } = call.args || {};
                  try {
                    result = await publicApisService.searchAnime(String(title || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Anime search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "translate_text") {
                  const { text, targetLang } = call.args || {};
                  try {
                    result = await publicApisService.translateText(String(text || ""), String(targetLang || "en"));
                  } catch (e: any) {
                    result = { success: false, message: `Translation fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_news") {
                  const { topic, country, count, engine } = call.args || {};
                  try {
                    result = await publicApisService.getNews(
                      topic ? String(topic) : undefined,
                      country ? String(country) : undefined,
                      typeof count === "number" ? count : 10,
                      engine ? (String(engine) as any) : "auto"
                    );
                  } catch (e: any) {
                    result = { success: false, message: `News fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_cricket_scores") {
                  const { team, query } = call.args || {};
                  try {
                    result = await publicApisService.getCricketScores(team || query ? String(team || query) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Cricket scores fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_upcoming_cricket_matches") {
                  const { filter, team } = call.args || {};
                  try {
                    result = await publicApisService.getUpcomingCricketMatches(filter || team ? String(filter || team) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Upcoming cricket matches fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_cricket_player_profile") {
                  const { playerName, player, name, query } = call.args || {};
                  try {
                    result = await publicApisService.getCricketPlayerProfile(String(playerName || player || name || query || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Cricket player profile fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_sports_events") {
                  const { league } = call.args || {};
                  try {
                    result = await publicApisService.getSportsEvents(String(league || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Sports events fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_stock_price") {
                  const { symbol } = call.args || {};
                  try {
                    result = await publicApisService.getStockPrice(String(symbol || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Stock price fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_movie_info") {
                  const { title } = call.args || {};
                  try {
                    result = await publicApisService.getMovieInfo(String(title || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Movie info fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_pexels_image") {
                  const { query } = call.args || {};
                  try {
                    result = await publicApisService.searchPexelsImage(String(query || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Pexels search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_unsplash_image") {
                  const { query } = call.args || {};
                  try {
                    result = await publicApisService.searchUnsplashImage(String(query || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Unsplash search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_directions") {
                  const { fromPlace, toPlace } = call.args || {};
                  try {
                    result = await publicApisService.getDirections(String(fromPlace || ""), String(toPlace || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Directions fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_nutrition_info") {
                  const { foodQuery } = call.args || {};
                  try {
                    result = await publicApisService.getNutritionInfo(String(foodQuery || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Nutrition info fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_recipe") {
                  const { query, cuisine, diet, type, maxCalories, minProtein } = call.args || {};
                  try {
                    result = await publicApisService.searchRecipe(
                      String(query || ""),
                      cuisine ? String(cuisine) : undefined,
                      diet ? String(diet) : undefined,
                      type ? String(type) : undefined,
                      maxCalories ? Number(maxCalories) : undefined,
                      minProtein ? Number(minProtein) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Recipe search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_recipes_by_ingredients") {
                  const { ingredients, count } = call.args || {};
                  try {
                    result = await publicApisService.searchRecipesByIngredients(
                      String(ingredients || ""),
                      count ? Number(count) : 5
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Ingredients recipe search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_recipe_details") {
                  const { recipeIdOrTitle } = call.args || {};
                  try {
                    result = await publicApisService.getRecipeDetails(String(recipeIdOrTitle || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Recipe details fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_random_recipes") {
                  const { tags, count } = call.args || {};
                  try {
                    result = await publicApisService.getRandomRecipes(
                      tags ? String(tags) : undefined,
                      count ? Number(count) : 3
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Random recipes fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_ingredient_substitutes") {
                  const { ingredientName } = call.args || {};
                  try {
                    result = await publicApisService.getIngredientSubstitutes(String(ingredientName || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Substitute lookup fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "generate_meal_plan") {
                  const { targetCalories, timeFrame, diet } = call.args || {};
                  try {
                    result = await publicApisService.generateMealPlan(
                      targetCalories ? Number(targetCalories) : 2000,
                      timeFrame ? (String(timeFrame) as any) : "day",
                      diet ? String(diet) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Meal plan generation fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_flight_status") {
                  const { flightNumber } = call.args || {};
                  try {
                    result = await publicApisService.getFlightStatus(String(flightNumber || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Flight status fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_govt_data") {
                  const { keyword } = call.args || {};
                  try {
                    result = await publicApisService.searchGovtData(String(keyword || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Govt data search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_product_by_barcode") {
                  const { upc } = call.args || {};
                  try {
                    result = await publicApisService.getProductByBarcode(String(upc || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Barcode lookup fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_trains_between_stations") {
                  const { fromPlace, toPlace } = call.args || {};
                  try {
                    result = await publicApisService.getTrainsBetweenStations(String(fromPlace || ""), String(toPlace || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Train list fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_train_schedule") {
                  const { trainNumberOrName, trainNumber, trainName } = call.args || {};
                  try {
                    result = await publicApisService.getTrainSchedule(String(trainNumberOrName || trainNumber || trainName || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Train schedule fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_live_train_status") {
                  const { trainNumberOrName, trainNumber, trainName, startDay } = call.args || {};
                  try {
                    result = await publicApisService.getLiveTrainStatus(
                      String(trainNumberOrName || trainNumber || trainName || ""),
                      typeof startDay === "number" ? startDay : 0
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Live train status fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_train") {
                  const { query, trainName, trainNumber } = call.args || {};
                  try {
                    result = await publicApisService.searchTrain(String(query || trainName || trainNumber || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Train search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_pnr_status") {
                  const { pnrNumber } = call.args || {};
                  try {
                    result = await publicApisService.getPnrStatus(String(pnrNumber || ""));
                  } catch (e: any) {
                    result = { success: false, message: `PNR status fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_product_deals") {
                  const { productName, product, query, platform, store, sortBy, page } = call.args || {};
                  try {
                    result = await publicApisService.searchProductDeals(
                      String(productName || product || query || ""),
                      {
                        platform: platform || store ? String(platform || store) : undefined,
                        sortBy: sortBy ? String(sortBy) : undefined,
                        page: typeof page === "number" ? page : undefined,
                      }
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Product search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_daily_life_suggestion") {
                  const { category, context } = call.args || {};
                  try {
                    result = await publicApisService.getDailyLifeSuggestion(
                      category ? String(category) : undefined,
                      context ? String(context) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Life suggestion fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_website_or_helpline_info") {
                  const { query } = call.args || {};
                  try {
                    result = await publicApisService.getWebsiteOrHelplineInfo(String(query || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Website/Helpline info fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_instagram_user_info") {
                  const { username, usernameOrQuery, query } = call.args || {};
                  try {
                    result = await publicApisService.getInstagramUserInfo(String(username || usernameOrQuery || query || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Instagram user info fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_instagram_user") {
                  const { query, username, name } = call.args || {};
                  try {
                    result = await publicApisService.searchInstagramUser(String(query || username || name || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Instagram search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_x_twitter_info") {
                  const { usernameOrTopic, username, topic, query } = call.args || {};
                  try {
                    result = await publicApisService.getXTwitterInfo(String(usernameOrTopic || username || topic || query || ""));
                  } catch (e: any) {
                    result = { success: false, message: `X (Twitter) info fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_x_twitter") {
                  const { query, username, topic } = call.args || {};
                  try {
                    result = await publicApisService.searchXTwitter(String(query || username || topic || ""));
                  } catch (e: any) {
                    result = { success: false, message: `X (Twitter) search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_location_overview") {
                  const { place, location, city } = call.args || {};
                  try {
                    result = await publicApisService.getLocationOverview(String(place || location || city || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Location overview fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_youtube") {
                  const { query } = call.args || {};
                  try {
                    result = await publicApisService.searchYouTube(String(query || ""));
                  } catch (e: any) {
                    result = { success: false, message: `YouTube search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_reddit") {
                  const { topicOrSubreddit } = call.args || {};
                  try {
                    result = await publicApisService.searchReddit(String(topicOrSubreddit || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Reddit search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "play_youtube_music") {
                  const songQuery = String(
                    call.args?.songName ||
                    call.args?.songOrArtist ||
                    call.args?.song ||
                    call.args?.query ||
                    call.args?.track ||
                    call.args?.title ||
                    call.args?.name ||
                    call.args?.artist ||
                    ""
                  ).trim();

                  try {
                    const ytMusicRes = await publicApisService.searchYouTubeMusic(songQuery || "Chammak Challo");
                    result = ytMusicRes;
                    if (ytMusicRes.success) {
                      const payload = JSON.stringify({
                        type: 'play_youtube_music',
                        track: ytMusicRes,
                      });
                      try { clientWs.send(payload); } catch {}
                      for (const client of connectedClients) {
                        if (client !== clientWs && client.readyState === 1) {
                          try { client.send(payload); } catch {}
                        }
                      }
                    }
                  } catch (e: any) {
                    result = { success: false, message: `YouTube music fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_music" || call.name === "play_music") {
                  const songQuery = String(
                    call.args?.songName ||
                    call.args?.songOrArtist ||
                    call.args?.song ||
                    call.args?.query ||
                    call.args?.track ||
                    call.args?.title ||
                    call.args?.name ||
                    call.args?.artist ||
                    ""
                  ).trim();

                  try {
                    result = await publicApisService.playMusic(songQuery);
                    if (result.success) {
                      const payload = JSON.stringify({
                        type: 'play_music',
                        trackName: result.trackName,
                        artistName: result.artistName,
                        albumArt: result.albumArt,
                        audioUrl: result.audioUrl,
                        directCdnUrl: result.directCdnUrl,
                        isJioSaavn: !!result.isJioSaavn,
                        hasLyrics: !!result.hasLyrics,
                        songId: result.songId,
                        spotifyUrl: result.spotifyUrl,
                        youtubeMusicUrl: result.youtubeMusicUrl,
                        isFullSong: result.isFullSong,
                        quality: result.quality,
                        durationSec: result.durationSec,
                      });
                      try { clientWs.send(payload); } catch {}
                      for (const client of connectedClients) {
                        if (client !== clientWs && client.readyState === 1) {
                          try { client.send(payload); } catch {}
                        }
                      }
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Music play fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "open_hologram_lab") {
                  const { modelId } = call.args || {};
                  const payload = JSON.stringify({
                    type: 'ui_toggle_command',
                    setting: 'hologram_lab',
                    state: true,
                    modelId: modelId ? String(modelId) : 'arc_reactor',
                  });
                  try { clientWs.send(payload); } catch {}
                  for (const client of connectedClients) {
                    if (client !== clientWs && client.readyState === 1) {
                      try { client.send(payload); } catch {}
                    }
                  }
                  result = {
                    success: true,
                    message: `Boss, JARVIS Holographic 3D Lab launch kar diya hai! Spatial hand tracking active hai, aap haath se structure ko rotate, scale, air-draw aur explode kar sakte hain.`,
                  };
                } else if (call.name === "search_song_by_lyrics") {
                  const { lyrics, artistHint } = call.args || {};
                  try {
                    result = await toolsEngine.searchSongByLyrics(String(lyrics || ""), artistHint ? String(artistHint) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Lyrics search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "identify_playing_song") {
                  const { songClue, audioSnippetBase64 } = call.args || {};
                  try {
                    result = await toolsEngine.identifyPlayingSong(
                      audioSnippetBase64 ? String(audioSnippetBase64) : undefined,
                      songClue ? String(songClue) : undefined
                    );
                    if (result.success && result.identifiedSong) {
                      clientWs.send(JSON.stringify({
                        type: 'song_identified',
                        song: result.identifiedSong,
                        mode: 'live_playing_song',
                      }));
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Playing song identify fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "identify_song_by_humming_or_tune") {
                  const { hummingOrTuneClue, artistHint } = call.args || {};
                  try {
                    result = await toolsEngine.identifySongByHummingOrTune(
                      String(hummingOrTuneClue || ""),
                      artistHint ? String(artistHint) : undefined
                    );
                    if (result.success && result.identifiedSong) {
                      clientWs.send(JSON.stringify({
                        type: 'song_identified',
                        song: result.identifiedSong,
                        mode: 'humming_melody',
                      }));
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Humming identify fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_morning_briefing") {
                  const { city } = call.args || {};
                  try {
                    result = await toolsEngine.getMorningBriefing(city ? String(city) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Morning briefing fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_system_health") {
                  try {
                    result = toolsEngine.getSystemHealth();
                  } catch (e: any) {
                    result = { success: false, message: `System health check fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "deep_autonomous_research") {
                  const { topic } = call.args || {};
                  try {
                    result = await toolsEngine.executeDeepResearch(String(topic || ""));
                    clientWs.send(JSON.stringify({
                      type: 'deep_research_result',
                      report: result,
                    }));
                  } catch (e: any) {
                    result = { success: false, message: `Deep research fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "analyze_screen_context") {
                  const { userQuery, imageBase64 } = call.args || {};
                  try {
                    result = await toolsEngine.analyzeScreenContext(
                      imageBase64 ? String(imageBase64) : undefined,
                      userQuery ? String(userQuery) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Screen analysis fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "switch_voice_persona") {
                  const { personaName } = call.args || {};
                  try {
                    result = toolsEngine.switchVoicePersona(String(personaName || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Persona switch fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "organize_directory") {
                  const { directoryPath } = call.args || {};
                  try {
                    result = await toolsEngine.organizeDirectory(directoryPath ? String(directoryPath) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `File organization fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "clean_temp_files") {
                  try {
                    result = await toolsEngine.cleanTempFiles();
                  } catch (e: any) {
                    result = { success: false, message: `Temp file cleanup fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "add_expense") {
                  const { amount, description, categoryHint } = call.args || {};
                  try {
                    result = await toolsEngine.addExpense(
                      Number(amount || 0),
                      String(description || ""),
                      categoryHint ? String(categoryHint) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Expense add fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "get_expense_summary") {
                  const { filterMonth } = call.args || {};
                  try {
                    result = await toolsEngine.getExpenseSummary(filterMonth ? String(filterMonth) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Expense summary check fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "schedule_meeting") {
                  const { title, timeString, durationMinutes, locationOrLink } = call.args || {};
                  try {
                    result = await toolsEngine.scheduleMeeting(
                      String(title || "Meeting"),
                      String(timeString || "Soon"),
                      durationMinutes ? Number(durationMinutes) : 30,
                      locationOrLink ? String(locationOrLink) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Meeting schedule fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_upcoming_meetings") {
                  try {
                    result = await toolsEngine.getUpcomingMeetings();
                  } catch (e: any) {
                    result = { success: false, message: `Upcoming meetings check fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "summarize_inbox") {
                  try {
                    result = await toolsEngine.summarizeInbox();
                  } catch (e: any) {
                    result = { success: false, message: `Inbox summary fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "send_quick_email") {
                  const { toEmail, subject, bodyText } = call.args || {};
                  try {
                    result = await toolsEngine.sendQuickEmail(
                      String(toEmail || ""),
                      String(subject || ""),
                      String(bodyText || "")
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Email send fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "log_water_intake") {
                  const { glasses } = call.args || {};
                  try {
                    result = await toolsEngine.logWaterIntake(glasses ? Number(glasses) : 1);
                  } catch (e: any) {
                    result = { success: false, message: `Water log fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "get_health_status") {
                  try {
                    result = await toolsEngine.getHealthStatus();
                  } catch (e: any) {
                    result = { success: false, message: `Health status check fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "add_to_shopping_list") {
                  const { itemsQuery } = call.args || {};
                  try {
                    result = await toolsEngine.addToShoppingList(String(itemsQuery || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Shopping list add fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_shopping_list") {
                  try {
                    result = await toolsEngine.getShoppingList();
                  } catch (e: any) {
                    result = { success: false, message: `Shopping list get fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "send_shopping_list_on_whatsapp") {
                  const { targetPhone } = call.args || {};
                  try {
                    result = await toolsEngine.sendShoppingListOnWhatsApp(targetPhone ? String(targetPhone) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Shopping list WhatsApp send fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "clear_shopping_list") {
                  try {
                    result = await toolsEngine.clearShoppingList();
                  } catch (e: any) {
                    result = { success: false, message: `Shopping list clear fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "trigger_emergency_sos") {
                  const { customMessage, targetPhone } = call.args || {};
                  try {
                    result = await toolsEngine.triggerEmergencySos(
                      customMessage ? String(customMessage) : undefined,
                      targetPhone ? String(targetPhone) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Emergency SOS trigger fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "generate_daily_podcast") {
                  try {
                    result = await toolsEngine.generateDailyPodcast();
                  } catch (e: any) {
                    result = { success: false, message: `Podcast generation fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "send_fast2sms_message") {
                  const { phoneNumberOrContactName, phoneNumber, contactName, messageText } = call.args || {};
                  const target = String(phoneNumberOrContactName || phoneNumber || contactName || "");
                  try {
                    result = await toolsEngine.sendFast2Sms(target, String(messageText || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Fast2SMS send fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "summarize_voice_note") {
                  const { transcript, senderName } = call.args || {};
                  try {
                    result = await toolsEngine.summarizeVoiceNote(String(transcript || ""), senderName ? String(senderName) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Voice note summary fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "store_vault_secret") {
                  const { keyName, secretValue, category } = call.args || {};
                  try {
                    result = await toolsEngine.storeVaultSecret(
                      String(keyName || ""),
                      String(secretValue || ""),
                      category ? String(category) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Vault save fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "retrieve_vault_secret") {
                  const { keyName } = call.args || {};
                  try {
                    result = await toolsEngine.retrieveVaultSecret(String(keyName || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Vault retrieve fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "list_vault_secrets") {
                  try {
                    result = await toolsEngine.listVaultSecrets();
                  } catch (e: any) {
                    result = { success: false, message: `Vault list fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_train_live_status") {
                  const { trainNumberOrName } = call.args || {};
                  try {
                    result = await toolsEngine.getTrainLiveStatus(String(trainNumberOrName || ""));
                    if (result && result.success) {
                      safeSend(JSON.stringify({ type: 'train_live_status', train: result }));
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Train status check fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "check_pnr_status") {
                  const { pnrNumber } = call.args || {};
                  try {
                    result = await toolsEngine.checkPnrStatus(String(pnrNumber || ""));
                    if (result && result.success) {
                      safeSend(JSON.stringify({ type: 'pnr_live_status', pnr: result }));
                    }
                  } catch (e: any) {
                    result = { success: false, message: `PNR check fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "control_smart_device") {
                  const { deviceNameOrRoom, action, value } = call.args || {};
                  try {
                    result = await toolsEngine.controlSmartDevice(
                      String(deviceNameOrRoom || ""),
                      action,
                      value ? Number(value) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Smart device control fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "get_smart_home_status") {
                  try {
                    result = await toolsEngine.getSmartHomeStatus();
                  } catch (e: any) {
                    result = { success: false, message: `Smart home status check fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "start_focus_mode") {
                  const { durationMinutes, goalTitle } = call.args || {};
                  try {
                    result = await toolsEngine.startFocusMode(
                      durationMinutes ? Number(durationMinutes) : 25,
                      goalTitle ? String(goalTitle) : undefined
                    );
                    if (result.lofiStreamUrl) {
                      clientWs.send(JSON.stringify({
                        type: 'play_music',
                        trackName: `Focus Mode Lo-Fi Beats (${result.goalTitle})`,
                        artistName: "Friday Productivity Lo-Fi",
                        audioUrl: result.lofiStreamUrl,
                        isFullSong: true,
                        quality: "Chill Lo-Fi Radio",
                      }));
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Focus mode start fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "stop_focus_mode") {
                  try {
                    result = toolsEngine.stopFocusMode();
                    safeSend(JSON.stringify({ type: 'stop_music' }));
                  } catch (e: any) {
                    result = { success: false, message: `Focus mode stop fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "track_product_price") {
                  const { productName, currentPrice, targetPrice, productUrl } = call.args || {};
                  try {
                    result = await toolsEngine.trackProductPrice(
                      String(productName || ""),
                      Number(currentPrice || 0),
                      targetPrice ? Number(targetPrice) : undefined,
                      productUrl ? String(productUrl) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Price tracking fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_tracked_prices") {
                  try {
                    result = await toolsEngine.getTrackedProducts();
                  } catch (e: any) {
                    result = { success: false, message: `Tracked prices check fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "analyze_document") {
                  const { documentTextOrSnippet, docTitle } = call.args || {};
                  try {
                    result = await toolsEngine.analyzeDocument(
                      String(documentTextOrSnippet || ""),
                      docTitle ? String(docTitle) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Document analysis fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "query_document") {
                  const { documentText, question } = call.args || {};
                  try {
                    result = await toolsEngine.queryDocument(String(documentText || ""), String(question || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Document query fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_daily_work_digest") {
                  try {
                    result = await toolsEngine.generateDailyWorkDigest();
                  } catch (e: any) {
                    result = { success: false, message: `Daily work digest fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "send_messenger_chat") {
                  const { chatId, text, mediaType, mediaUrl, mediaTitle } = call.args || {};
                  try {
                    result = await toolsEngine.sendMessengerMessage(
                      String(chatId || "boss_dk"),
                      String(text || ""),
                      mediaType || "text",
                      mediaUrl ? String(mediaUrl) : undefined,
                      mediaTitle ? String(mediaTitle) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Messenger send fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "get_messenger_inbox") {
                  try {
                    result = await toolsEngine.getMessengerInbox();
                  } catch (e: any) {
                    result = { success: false, message: `Messenger inbox check fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "set_messenger_contact_role") {
                  const { contactId, role } = call.args || {};
                  try {
                    result = await toolsEngine.setMessengerContactRole(String(contactId || ""), role);
                  } catch (e: any) {
                    result = { success: false, message: `Messenger role update fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "stop_music") {
                  try {
                    result = await publicApisService.stopMusic();
                    safeSend(JSON.stringify({ type: 'stop_music' }));
                  } catch (e: any) {
                    result = { success: false, message: `Music stop fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "pause_music") {
                  try {
                    safeSend(JSON.stringify({ type: 'pause_music' }));
                    result = { success: true, message: "Boss, gana pause kar diya hai! ⏸️" };
                  } catch (e: any) {
                    result = { success: false, message: `Music pause fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "resume_music") {
                  try {
                    safeSend(JSON.stringify({ type: 'resume_music' }));
                    result = { success: true, message: "Boss, gana resume kar diya hai! ▶️" };
                  } catch (e: any) {
                    result = { success: false, message: `Music resume fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "control_music") {
                  const { action, value } = call.args || {};
                  const act = String(action || "").toLowerCase().trim();
                  const val = value !== undefined ? String(value) : undefined;
                  try {
                    const payload = JSON.stringify({
                      type: 'control_music',
                      action: act,
                      value: val,
                    });
                    safeSend(payload);
                    for (const client of connectedClients) {
                      if (client !== clientWs && client.readyState === 1) {
                        try { client.send(payload); } catch {}
                      }
                    }

                    let ackMsg = `Boss, music action '${act}' execute kar diya hai! 🎵`;
                    if (act === "seek_forward") ackMsg = `Boss, gana ${val || '10'} seconds aage kar diya hai! ⏩`;
                    else if (act === "seek_backward") ackMsg = `Boss, gana ${val || '10'} seconds peeche kar diya hai! ⏪`;
                    else if (act === "restart") ackMsg = `Boss, gana shuru se play kar diya hai! 🔁`;
                    else if (act === "volume_up") ackMsg = `Boss, awaz badha di hai! 🔊`;
                    else if (act === "volume_down") ackMsg = `Boss, awaz kam kar di hai! 🔉`;
                    else if (act === "set_volume") ackMsg = `Boss, volume ${val}% par set kar diya hai! 🔊`;
                    else if (act === "next_song") ackMsg = `Boss, agla gana play kar rahe hain! ⏭️`;
                    else if (act === "prev_song") ackMsg = `Boss, pichhla gana play kar rahe hain! ⏮️`;
                    else if (act === "set_bass") ackMsg = `Boss, Bass Boost ${val || 'Ultra'} activate kar diya hai! 🎧🔊`;
                    else if (act === "set_equalizer") ackMsg = `Boss, Equalizer preset '${val || 'Bass Boost'}' set kar diya hai! 🎛️`;
                    else if (act === "toggle_lyrics") ackMsg = `Boss, Lyrics drawer toggle kar diya hai! 📜`;

                    result = { success: true, message: ackMsg, action: act, value: val };
                  } catch (e: any) {
                    result = { success: false, message: `Music control fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "preview_song_options") {
                  const songQuery = String(call.args?.query || "").trim();
                  try {
                    const rawPool: any[] = [];
                    const seenKeys = new Set<string>();

                    // 1. Parallel Ingestion from YouTube, Spotify, and JioSaavn Catalogs
                    const [ytRes, spotifyRes, jioRes] = await Promise.all([
                      youtubeMusicService.searchTracks(songQuery || "Top Hits", 10).catch(() => null),
                      publicApisService.searchMusic(songQuery || "Top Hits").catch(() => null),
                      jioSaavnService.searchSong(songQuery || "Top Hits", 12).catch(() => null),
                    ]);

                    // Add YouTube Pro Candidates
                    if (ytRes?.success && Array.isArray(ytRes.tracks)) {
                      for (const y of ytRes.tracks) {
                        const norm = (y.songName + " " + (y.artistName || "")).toLowerCase().replace(/[^a-z0-9]/g, '');
                        if (!seenKeys.has(norm)) {
                          seenKeys.add(norm);
                          rawPool.push({
                            id: `yt_${y.videoId}`,
                            videoId: y.videoId,
                            songName: y.songName,
                            artistName: y.artistName || "YouTube Music",
                            albumName: "YouTube Pro Safe",
                            albumArt: y.albumArtHighRes || y.albumArt || `https://img.youtube.com/vi/${y.videoId}/hqdefault.jpg`,
                            previewUrl: `/api/youtube/stream-audio?v=${y.videoId}`,
                            embedUrl: y.embedUrl || `https://www.youtube-nocookie.com/embed/${y.videoId}?autoplay=1&enablejsapi=1&controls=0&playsinline=1`,
                            source: 'youtube',
                            durationSec: y.durationSec || 180,
                          });
                        }
                      }
                    }

                    // Add Spotify Candidates
                    if (spotifyRes?.success && Array.isArray(spotifyRes.tracks)) {
                      for (const t of spotifyRes.tracks) {
                        if (t.previewUrl && t.trackName) {
                          const norm = (t.trackName + " " + (t.artistName || "")).toLowerCase().replace(/[^a-z0-9]/g, '');
                          if (!seenKeys.has(norm)) {
                            seenKeys.add(norm);
                            rawPool.push({
                              id: `spotify_${rawPool.length + 1}`,
                              songName: t.trackName,
                              artistName: t.artistName || "Artist",
                              albumName: t.albumName,
                              albumArt: t.albumArt,
                              previewUrl: t.previewUrl,
                              source: 'spotify',
                              durationSec: t.durationSec || 30,
                            });
                          }
                        }
                      }
                    }

                    // Add JioSaavn Candidates
                    if (jioRes?.success && Array.isArray(jioRes.songs)) {
                      for (const s of jioRes.songs) {
                        const norm = (s.songName + " " + (s.artistName || "")).toLowerCase().replace(/[^a-z0-9]/g, '');
                        if (!seenKeys.has(norm)) {
                          seenKeys.add(norm);
                          rawPool.push({
                            id: s.id,
                            songName: s.songName,
                            artistName: s.artistName,
                            albumName: s.albumName,
                            starring: s.starring,
                            label: s.label,
                            playCount: s.playCount,
                            albumArt: s.albumArt500 || s.albumArt150,
                            previewUrl: s.audio320kbps,
                            audio320kbps: s.audio320kbps,
                            fullAudioUrl: s.audio320kbps,
                            source: 'jiosaavn',
                            durationSec: s.durationSec,
                          });
                        }
                      }
                    }

                    // 2. YouTube & Spotify Cognitive Ranking & Intent Scoring
                    const rankedCandidates = jioSaavnService.rankCandidatesMindReader(songQuery, rawPool);

                    if (rankedCandidates.length > 0) {
                      const payload = JSON.stringify({
                        type: 'song_preview_options',
                        query: songQuery,
                        candidates: rankedCandidates,
                      });
                      safeSend(payload);
                      for (const client of connectedClients) {
                        if (client !== clientWs && client.readyState === 1) {
                          try { client.send(payload); } catch {}
                        }
                      }
                      result = {
                        success: true,
                        count: rankedCandidates.length,
                        topMatch: rankedCandidates[0]?.songName,
                        primarySource: rankedCandidates[0]?.source || 'spotify',
                        message: `Ok Boss! Main Spotify & JioSaavn se top ${rankedCandidates.length} matching songs ke 30-sec previews play kar rahi hoon. Sun kar batayein kaun sa wala chahiye! 🎵`,
                        candidates: rankedCandidates,
                      };
                    } else {
                      result = { success: false, message: `"${songQuery}" ke liye preview options nahi mile.` };
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Preview options search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "select_preview_option") {
                  const { action, index, songName } = call.args || {};
                  const act = String(action || "").toLowerCase().trim();
                  try {
                    const payload = JSON.stringify({
                      type: 'control_preview_option',
                      action: act,
                      index: Number(index) || undefined,
                      songName: songName ? String(songName) : undefined,
                    });
                    safeSend(payload);
                    for (const client of connectedClients) {
                      if (client !== clientWs && client.readyState === 1) {
                        try { client.send(payload); } catch {}
                      }
                    }
                    result = { success: true, message: `Preview option '${act}' execute kiya gaya!`, action: act };
                  } catch (e: any) {
                    result = { success: false, message: `Preview action fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "scan_connected_wifi_devices") {
                  const { forceRefresh } = call.args || {};
                  try {
                    const scan = await networkDeviceScannerService.scanConnectedDevices(Boolean(forceRefresh));
                    result = {
                      success: true,
                      totalDevices: scan.totalDevices,
                      summary: scan.summary,
                      subnet: scan.subnet,
                      gatewayIp: scan.gatewayIp,
                      selfIp: scan.selfIp,
                      wifiHealth: scan.wifiHealth,
                      devices: scan.devices.map((d) => ({
                        vendor: d.vendor,
                        hostname: d.hostname,
                        modelName: d.modelName,
                        ip: d.ip,
                        deviceType: d.deviceType,
                        services: d.services,
                        activeStream: d.activeStream,
                        isGateway: d.isGateway,
                        isSelf: d.isSelf,
                      })),
                      speechContext: networkDeviceScannerService.compileVoicePromptContext(scan),
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Wi-Fi devices scan fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "scan_nearby_wifi_recon") {
                  const { forceRefresh } = call.args || {};
                  try {
                    const recon = await networkDeviceScannerService.scanNearbyWifiRecon(Boolean(forceRefresh));
                    result = {
                      success: true,
                      totalNetworks: recon.totalNetworks,
                      securitySummary: recon.securitySummary,
                      channelAnalysis: recon.channelAnalysis,
                      currentConnectedSsid: recon.currentConnectedSsid,
                      networks: recon.networks.slice(0, 10),
                      speechContext: networkDeviceScannerService.compileReconVoicePromptContext(recon),
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Airspace Wi-Fi Recon fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "start_voice_enrollment") {
                  const { pin, name, relationWithDivakar, role } = call.args || {};
                  try {
                    result = await voiceBiometricsService.startVoiceEnrollment(
                      String(pin || ""),
                      String(name || "Guest"),
                      String(relationWithDivakar || "Friend"),
                      role || "friend"
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Voice enrollment start fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "record_voice_calibration_sample") {
                  const { sessionId, spokenPhrase } = call.args || {};
                  try {
                    // Uses dummy/live sample buffer from current turn
                    result = await voiceBiometricsService.recordCalibrationSample(
                      String(sessionId || ""),
                      "",
                      spokenPhrase ? String(spokenPhrase) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Calibration sample record fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "list_voice_profiles") {
                  try {
                    const profiles = await voiceBiometricsService.getProfiles();
                    result = {
                      success: true,
                      totalProfiles: profiles.length,
                      profiles: profiles.map((p) => ({
                        id: p.id,
                        name: p.name,
                        role: p.role,
                        relationWithDivakar: p.relationWithDivakar,
                        isRootAdmin: p.isRootAdmin,
                      })),
                      speechContext: await voiceBiometricsService.compileVoiceProfilesPromptContext(),
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Voice profiles fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "delete_voice_profile") {
                  const { pin, profileId } = call.args || {};
                  try {
                    result = await voiceBiometricsService.deleteVoiceProfile(String(pin || ""), profileId ? String(profileId) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Voice profile delete fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "update_voice_pin") {
                  const { newPin } = call.args || {};
                  try {
                    result = await voiceBiometricsService.updateVoicePin(String(newPin || ""), "Boss (DK)");
                  } catch (e: any) {
                    result = { success: false, message: `Voice PIN update fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "verify_voice_authorization_pin") {
                  const { pin } = call.args || {};
                  try {
                    result = await voiceBiometricsService.verifyVoicePin(String(pin || ""));
                  } catch (e: any) {
                    result = { valid: false, message: `Voice PIN verification fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "send_music_on_whatsapp") {
                  const { songName, targetPhone } = call.args || {};
                  try {
                    // Step 1: Get real YouTube link
                    const ytResult = await publicApisService.getYouTubeMusicLink(String(songName || ""));
                    const ytLink = ytResult?.youtubeShortUrl || ytResult?.youtubeUrl;
                    const songTitle = ytResult?.title || String(songName || "");

                    if (!ytLink) {
                      result = { success: false, message: `Boss, "${songName}" ka YouTube link nahi mila.` };
                    } else {
                      // Step 2: Resolve target phone
                      let sendToPhone = process.env.OWNER_WHATSAPP_NUMBER || "";
                      if (targetPhone && String(targetPhone).trim()) {
                        const contact = await contactsService.findContact(String(targetPhone));
                        sendToPhone = contact ? contact.phone : String(targetPhone).replace(/[\s\-\(\)\+]/g, "");
                      }

                      if (!sendToPhone) {
                        result = {
                          success: false,
                          message: `Boss, OWNER_WHATSAPP_NUMBER .env mein set nahi hai.`,
                          youtubeLink: ytLink, songTitle,
                        };
                      } else {
                        const waMsg = `\uD83C\uDFB5 *${songTitle}*\n\n${ytLink}\n\n_Friday se bheja gaya_ \u2728`;

                        // ── Primary: WhatsApp Cloud API (official, ban-safe) ────────
                        const cloudRes = await whatsappCloudService.sendMessage(sendToPhone, waMsg);

                        if (cloudRes.success) {
                          result = {
                            success: true,
                            via: "cloud_api",
                            message: `Boss, "${songTitle}" ka YouTube link aapke WhatsApp par bhej diya! \uD83C\uDFB5`,
                            youtubeLink: ytLink, songTitle, sentTo: sendToPhone,
                          };
                        } else {
                          // ── Cloud API failed ──────────────────────────────
                          if (getBaileysEnabled()) {
                            // ── Fallback: Baileys (only if boss has enabled it) ─
                            console.warn("[Server] Cloud API failed, falling back to Baileys...");
                            const baileysRes = await whatsappBotService.sendMessage(sendToPhone, waMsg);
                            if (baileysRes.success) {
                              result = {
                                success: true,
                                via: "baileys_fallback",
                                message: `Boss, Cloud API se nahi gaya tha, Baileys se bhej diya "${songTitle}" ka link! \uD83C\uDFB5`,
                                youtubeLink: ytLink, songTitle, sentTo: sendToPhone,
                              };
                            } else {
                              result = {
                                success: false,
                                message: `Boss, Cloud API aur Baileys dono se message nahi gaya. Cloud: ${cloudRes.message} | Baileys: ${baileysRes.message}`,
                                youtubeLink: ytLink, songTitle,
                              };
                            }
                          } else {
                            // Baileys OFF — honest message, offer to enable
                            result = {
                              success: false,
                              cloudError: cloudRes.message,
                              youtubeLink: ytLink,
                              songTitle,
                              baileysEnabled: false,
                              message: `Boss, Cloud API se message nahi gaya (${cloudRes.message}). Baileys system abhi OFF hai. Kya Baileys on karun backup ke liye? Bolo "Baileys on karo".`,
                            };
                          }
                        }
                      }
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Music WhatsApp send fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "toggle_baileys_system") {
                  const { action } = call.args || {};
                  try {
                    const act = String(action || "").toLowerCase().trim();
                    if (act === "on") {
                      setBaileysEnabled(true);
                    } else if (act === "off") {
                      setBaileysEnabled(false);
                    }
                    // "status" just returns current state without changing
                    const stateLabel = getBaileysEnabled() ? "ON (active as fallback)" : "OFF";
                    result = {
                      success: true,
                      action: act,
                      baileysEnabled: getBaileysEnabled(),
                      message: getBaileysEnabled()
                        ? `Boss, Baileys system ON kar diya. Ab agar Cloud API fail ho to Baileys backup pe kaam karega.`
                        : `Boss, Baileys system OFF kar diya. Sirf Cloud API (official Meta) use hogi. Safer hai.`,
                      currentState: stateLabel,
                    };
                    console.log(`[Server] toggle_baileys_system called: action=${act}, baileysEnabled=${getBaileysEnabled()}`);
                  } catch (e: any) {
                    result = { success: false, message: `Baileys toggle fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "dispatch_bug_to_code_agent") {
                  const { problemTitle, serviceName, errorDetails, instruction } = call.args || {};
                  try {
                    const fullInstruction = `[Bug Fix / Self-Healing Request]
Title: ${problemTitle || "Fix broken service"}
Component/Service: ${serviceName || "Unknown"}
Error Details/Logs: ${errorDetails || "Service reported failure"}

Detailed Instruction:
${instruction}

Please review the codebase, diagnose the root cause, fix the issue with proper error handling/fallbacks, and propose the changes.`;

                    const req = await codeAgentService.createRequest(fullInstruction, problemTitle || "Bug Fix Request");
                    const reqId = req.id;
                    if (errorDetails) {
                      await codeAgentService.addLog(reqId, `Bug Report Context: ${errorDetails}`, "warn", "bug_report");
                    }
                    result = {
                      success: true,
                      requestId: reqId,
                      message: `Boss, issue Coding Agent ko bhej diya gaya hai (Task ID: ${reqId}). Agent codebase scan karke solution plan banayega.`,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Coding Agent ko task bhejne me error: ${e?.message || e}` };
                  }
                } else if (call.name === "rollback_last_code_change") {
                  try {
                    const rollbackRes = await codeAgentService.rollback();
                    result = {
                      success: true,
                      message: `Boss, aakhri code change rollback kar diya gaya hai! Origin repo wapas stable commit par reset ho gaya hai.`,
                      details: rollbackRes.message,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Rollback fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "get_pending_code_agent_request") {
                  try {
                    const pending = await codeAgentService.getPendingRequest();
                    if (!pending) {
                      result = { hasPending: false, message: "Abhi koi coding agent task permission ke liye wait nahi kar raha hai boss." };
                    } else {
                      const filesList = pending.plan?.files?.map((f: any) => `${f.path} (${f.action})`).join(", ") || "Files";
                      result = {
                        hasPending: true,
                        requestId: pending.id,
                        instruction: pending.instruction,
                        summary: pending.plan?.summary,
                        affectedFiles: filesList,
                        message: `Boss, Coding Agent permission maang raha hai: "${pending.instruction}". Plan: ${pending.plan?.summary}. Affected files: ${filesList}.`,
                      };
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Pending request check karne me error: ${e?.message || e}` };
                  }
                } else if (call.name === "approve_and_commit_code_agent") {
                  const { requestId } = call.args || {};
                  try {
                    const targetId = requestId || (await codeAgentService.getPendingRequest())?.id;
                    if (!targetId) {
                      result = { success: false, message: "Boss, koi pending coding request nahi mili jise approve kiya ja sake." };
                    } else {
                      await codeAgentService.approveAndPushDirectlyToMain(targetId);
                      result = {
                        success: true,
                        requestId: targetId,
                        message: `Boss, Coding Agent ko command de di hai! Code ko compile aur direct main origin branch me commit & push kiya ja raha hai.`,
                      };
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Approve and commit fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "deny_code_agent_request") {
                  const { requestId } = call.args || {};
                  try {
                    const targetId = requestId || (await codeAgentService.getPendingRequest())?.id;
                    if (!targetId) {
                      result = { success: false, message: "Boss, koi pending coding request nahi mili jise deny kiya ja sake." };
                    } else {
                      await codeAgentService.deny(targetId);
                      result = {
                        success: true,
                        requestId: targetId,
                        message: `Boss, Coding Agent task ko deny aur cancel kar diya gaya hai.`,
                      };
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Deny fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "search_and_explain_codebase") {
                  const { query } = call.args || {};
                  try {
                    const searchRes = await codeAgentService.searchAndExplainCodebase(String(query || ""));
                    result = {
                      success: true,
                      explanation: searchRes.answer,
                      relatedFiles: searchRes.relatedFiles,
                      message: searchRes.answer,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Codebase search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "clean_project_codebase") {
                  try {
                    const cleanRes = await codeAgentService.runCodebaseCleanup();
                    result = {
                      success: true,
                      taskId: cleanRes.taskId,
                      message: `Boss, codebase cleanup ka task Coding Agent ko de diya gaya hai (Task ID: ${cleanRes.taskId}). Unused imports aur debris clean ho rahe hain.`,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Cleanup task start karne me error: ${e?.message || e}` };
                  }
                } else if (call.name === "crawl_and_extract_webpage") {
                  const { url, query } = call.args || {};
                  try {
                    if (!url) {
                      result = { success: false, message: "URL batana zaroori hai boss." };
                    } else {
                      const crawlRes = await webCrawlerService.crawlUrl(String(url));
                      if (crawlRes.error) {
                        result = { success: false, message: `Website crawl nahi ho payi: ${crawlRes.error}` };
                      } else {
                        let aiAnswer = "";
                        if (query && String(query).trim()) {
                          const queryRes = await webCrawlerService.queryCrawledContent(crawlRes.markdown, String(query));
                          aiAnswer = queryRes.answer;
                        } else {
                          const summaryRes = await webCrawlerService.summarizeWebpage(crawlRes.markdown);
                          aiAnswer = summaryRes.executiveSummary;
                        }
                        result = {
                          success: true,
                          title: crawlRes.metadata.title,
                          url: crawlRes.finalUrl,
                          tokens: crawlRes.estimatedTokens,
                          answer: aiAnswer,
                          message: `Boss, maine ${crawlRes.finalUrl} ko crawl kar liya hai (${crawlRes.metadata.title}):\n\n${aiAnswer}`,
                        };
                      }
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Crawling fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "deep_crawl_website") {
                  const { url, maxPages, query } = call.args || {};
                  try {
                    if (!url) {
                      result = { success: false, message: "Root URL batana zaroori hai boss." };
                    } else {
                      const deepRes = await webCrawlerService.deepCrawl(String(url), {
                        maxPages: maxPages ? Number(maxPages) : 4,
                      });
                      const promptGoal = query
                        ? String(query)
                        : "Synthesize a multi-page deep intelligence report from this whole website.";
                      const queryRes = await webCrawlerService.queryCrawledContent(deepRes.combinedMarkdown, promptGoal);
                      result = {
                        success: true,
                        domain: deepRes.domain,
                        pagesCrawled: deepRes.pagesCrawled,
                        totalTokens: deepRes.totalTokens,
                        analysis: queryRes.answer,
                        message: `Boss, maine ${deepRes.domain} ke ${deepRes.pagesCrawled} pages deep crawl kar liye hain (${deepRes.totalTokens} tokens):\n\n${queryRes.answer}`,
                      };
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Deep crawling fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "search_telegram_media_vault") {
                  const { query, mediaType } = call.args || {};
                  try {
                    const { telegramBotService } = await import("../services/telegramBotService");
                    const searchRes = await telegramBotService.searchMediaVault(String(query || ""), {
                      mediaType: mediaType ? String(mediaType) : undefined,
                    });
                    result = {
                      success: searchRes.totalCount > 0,
                      totalFound: searchRes.totalCount,
                      summary: searchRes.summary,
                      message: searchRes.summary,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Telegram media vault search fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "get_telegram_user_or_group_summary") {
                  const { target, isGroup } = call.args || {};
                  try {
                    const { telegramBotService } = await import("../services/telegramBotService");
                    const targetStr = String(target || "");
                    const isGroupTarget = isGroup === true || /group|grp/i.test(targetStr);
                    
                    if (isGroupTarget) {
                      const grpRes = await telegramBotService.getTelegramGroupSummary(targetStr);
                      result = {
                        success: grpRes.found,
                        summary: grpRes.summary,
                        message: grpRes.summary,
                      };
                    } else {
                      const userRes = await telegramBotService.getTelegramUserSummary(targetStr);
                      result = {
                        success: userRes.found,
                        summary: userRes.summary,
                        message: userRes.summary,
                      };
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Telegram summary fetch fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "analyze_youtube_video") {
                  const { url } = call.args || {};
                  try {
                    const { youtubeService } = await import("../services/youtubeService");
                    const analysis = await youtubeService.analyzeVideo(String(url || ""));
                    let msg = `Boss, maine YouTube video "${analysis.title}" analyze kar li hai:\n\n${analysis.summary}`;
                    if (analysis.chapters && analysis.chapters.length > 0) {
                      msg += `\n\nKey Chapters:\n` + analysis.chapters.slice(0, 5).map(c => `• ${c.startFormatted} - ${c.title}`).join("\n");
                    }
                    result = {
                      success: true,
                      title: analysis.title,
                      channel: analysis.channelName,
                      summary: analysis.summary,
                      keyTakeaways: analysis.keyTakeaways,
                      chapters: analysis.chapters,
                      message: msg,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `YouTube video analysis fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "ask_youtube_video_timestamp") {
                  const { url, question } = call.args || {};
                  try {
                    const { youtubeService } = await import("../services/youtubeService");
                    const qRes = await youtubeService.queryVideoTimestamp(String(url || ""), String(question || ""));
                    result = {
                      success: qRes.contextFound,
                      exactTimestamp: qRes.exactTimestamp,
                      timestampUrl: qRes.timestampUrl,
                      answer: qRes.answer,
                      message: qRes.exactTimestamp
                        ? `Boss, ${qRes.exactTimestamp} timestamp par:\n${qRes.answer}`
                        : qRes.answer,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `YouTube timestamp search fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "get_whatsapp_photo_or_doc_info") {
                  const { query } = call.args || {};
                  try {
                    const mediaRes = await visionMemoryService.getLatestMediaInfo(query ? String(query) : undefined);
                    result = {
                      success: mediaRes.hasMedia,
                      analysis: mediaRes.analysis,
                      sender: mediaRes.sender,
                      caption: mediaRes.caption,
                      timeAgo: mediaRes.timeAgo,
                      message: mediaRes.analysis,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `WhatsApp photo/doc analyze karne me error: ${e?.message || e}` };
                  }
                } else if (call.name === "save_person_visual_memory") {
                  const { name, relation, notes } = call.args || {};
                  try {
                    const saveRes = await visionMemoryService.savePersonMemory(
                      String(name || "Contact"),
                      relation ? String(relation) : undefined,
                      notes ? String(notes) : undefined
                    );
                    result = {
                      success: true,
                      personId: saveRes.personId,
                      message: saveRes.summary,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Person memory save karne me error: ${e?.message || e}` };
                  }
                } else if (call.name === "identify_person_in_whatsapp_photo") {
                  try {
                    const idRes = await visionMemoryService.identifyPersonInPhoto();
                    result = {
                      success: idRes.identified,
                      personName: idRes.personName,
                      relation: idRes.relation,
                      explanation: idRes.explanation,
                      message: idRes.explanation,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Person identify karne me error: ${e?.message || e}` };
                  }
                } else if (call.name === "toggle_ui_setting") {
                  const { settingName, state } = call.args || {};
                  try {
                    const norm = String(settingName || "").toLowerCase().trim();
                    let finalState: boolean | undefined = typeof state === "boolean" ? state : undefined;

                    if (norm.includes("baileys") || norm === "baileys_whatsapp") {
                      if (finalState === undefined) setBaileysEnabled(!getBaileysEnabled());
                      else setBaileysEnabled(finalState);
                      finalState = getBaileysEnabled();
                    }

                    const normalizedSetting = norm.includes("caption") || norm.includes("subtitle")
                      ? "captions"
                      : norm.includes("accurate")
                      ? "accurate_mode"
                      : norm.includes("google") || norm.includes("search")
                      ? "google_search"
                      : norm.includes("wake") || norm.includes("hello")
                      ? "wake_word"
                      : norm.includes("chat") || norm.includes("history")
                      ? "chat_history"
                      : norm.includes("code") || norm.includes("agent")
                      ? "code_agent"
                      : norm.includes("modal") || norm.includes("link")
                      ? "whatsapp_modal"
                      : norm.includes("setting")
                      ? "settings"
                      : norm;

                    const payload = JSON.stringify({
                      type: "ui_toggle_command",
                      setting: normalizedSetting,
                      state: finalState,
                    });

                    for (const client of connectedClients) {
                      if (client.readyState === 1) {
                        try { client.send(payload); } catch {}
                      }
                    }

                    result = {
                      success: true,
                      setting: normalizedSetting,
                      state: finalState,
                      message: `Boss, ${settingName} ko ${finalState === false ? "OFF" : "ON"} kar diya hai!`,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Toggle fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "setup_boss_voice_recognition") {
                  const { pin, name, spokenPhrase } = call.args || {};
                  try {
                    const enrollRes = await voiceBiometricsService.enrollVoice(
                      String(pin || ""),
                      name ? String(name) : "Boss (Divakar)",
                      undefined,
                      spokenPhrase ? String(spokenPhrase) : undefined
                    );
                    result = {
                      success: enrollRes.success,
                      message: enrollRes.message,
                      count: enrollRes.count,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Voice recognition setup fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "delete_boss_voice_recognition") {
                  const { pin, profileId } = call.args || {};
                  try {
                    const delRes = await voiceBiometricsService.deleteProfile(
                      String(pin || ""),
                      profileId ? String(profileId) : undefined
                    );
                    result = {
                      success: delRes.success,
                      message: delRes.message,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Voice profile delete fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "send_telegram_message") {
                  const { text, chatId } = call.args || {};
                  try {
                    const targetChat = chatId || (await telegramBotService.getOwnerOrLatestChatId()) || process.env.TELEGRAM_OWNER_CHAT_ID;
                    if (!targetChat) {
                      const botName = telegramBotService.getStatus().botUsername || "dk_Friday_bot";
                      result = { success: false, message: `Boss, Telegram bot (@${botName}) par pehle /start dabayein taaki aapka Chat ID detect ho sake.` };
                    } else {
                      const sendRes = await telegramBotService.sendMessage(targetChat, String(text || ""));
                      result = {
                        success: sendRes.success,
                        message: sendRes.success
                          ? `Boss, Telegram par message successfully bhej diya gaya hai! ✅`
                          : `Telegram send failed: ${sendRes.error}`,
                      };
                    }
                  } catch (e: any) {
                    result = { success: false, message: `Telegram message fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "send_telegram_to_contact") {
                  const { recipient, message } = call.args || {};
                  try {
                    const sendRes = await telegramBotService.sendMessageToTarget(
                      String(recipient || ""),
                      String(message || "")
                    );
                    result = {
                      success: sendRes.success,
                      message: sendRes.message,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Telegram message fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "get_telegram_bot_data") {
                  try {
                    const [users, groups, customBusy] = await Promise.all([
                      telegramBotService.getAllTelegramUsers(),
                      telegramBotService.getAllTelegramGroups(),
                      telegramBotService.getCustomBusyReply(),
                    ]);
                    result = {
                      success: true,
                      totalUsers: users.length,
                      totalGroups: groups.length,
                      customBusyStatus: customBusy || "Default (DK Boss is busy)",
                      users: users.map((u) => ({
                        id: u.chatId || u.userId,
                        name: u.fullName,
                        username: u.username ? `@${u.username}` : "none",
                        alias: u.customAlias || "none",
                        notes: u.customNotes || "none",
                        lastSeen: new Date(u.lastSeenAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
                        lastMessage: u.lastMessage || "",
                        groups: u.groups || [],
                      })),
                      groups: groups.map((g) => ({
                        groupId: g.groupId,
                        title: g.title,
                        username: g.username ? `@${g.username}` : "none",
                        memberCount: g.activeMembers?.length || 0,
                        members: g.activeMembers?.map((m) => m.name || m.username) || [],
                        lastSeen: new Date(g.lastSeenAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
                        lastMessage: g.lastMessage || "",
                      })),
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Telegram data retrieve karne me error: ${e?.message || e}` };
                  }
                } else if (call.name === "get_telegram_chat_history") {
                  const { target, limit } = call.args || {};
                  try {
                    result = await telegramBotService.getChatHistory(
                      target ? String(target) : "all",
                      limit ? Number(limit) : 20
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Telegram chat history error: ${e?.message || e}` };
                  }
                } else if (call.name === "modify_telegram_user") {
                  const { target, customAlias, customNotes } = call.args || {};
                  try {
                    result = await telegramBotService.modifyTelegramUser(
                      String(target || ""),
                      { customAlias, customNotes }
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Telegram user modify fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "set_telegram_busy_message") {
                  const { message } = call.args || {};
                  try {
                    result = await telegramBotService.setCustomBusyReply(String(message || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Telegram busy reply set karne me error: ${e?.message || e}` };
                  }
                } else if (call.name === "send_instagram_dm") {
                  const { recipient, message } = call.args || {};
                  try {
                    const sendRes = await instagramBotService.sendMessageToTarget(
                      String(recipient || ""),
                      String(message || "")
                    );
                    result = {
                      success: sendRes.success,
                      message: sendRes.message,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Instagram DM send fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "scan_link_safety") {
                  const { url } = call.args || {};
                  try {
                    const scanRes = await cyberSecurityService.scanUrlSafety(String(url || ""));
                    result = {
                      success: true,
                      isSafe: scanRes.isSafe,
                      riskScore: scanRes.riskScore,
                      riskLevel: scanRes.riskLevel,
                      threats: scanRes.threatsDetected,
                      message: scanRes.explanation,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `URL scan fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "check_email_data_breach") {
                  const { emailOrUsername } = call.args || {};
                  try {
                    const breachRes = await cyberSecurityService.checkDataBreach(String(emailOrUsername || ""));
                    result = {
                      success: true,
                      isCompromised: breachRes.isCompromised,
                      breachCount: breachRes.breachCount,
                      breaches: breachRes.breaches,
                      message: breachRes.recommendation,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Breach check fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "audit_website_security") {
                  const { domain } = call.args || {};
                  try {
                    const auditRes = await cyberSecurityService.auditWebsiteSecurity(String(domain || ""));
                    result = {
                      success: true,
                      grade: auditRes.grade,
                      score: auditRes.score,
                      httpsEnforced: auditRes.httpsEnforced,
                      serverTechnology: auditRes.serverTechnology,
                      vulnerabilities: auditRes.vulnerabilities,
                      message: auditRes.summary,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Website audit fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "lookup_ip_intelligence") {
                  const { ipOrDomain } = call.args || {};
                  try {
                    const ipRes = await cyberSecurityService.lookupIpIntelligence(String(ipOrDomain || ""));
                    result = {
                      success: true,
                      ip: ipRes.ip,
                      country: ipRes.country,
                      city: ipRes.city,
                      isp: ipRes.isp,
                      asn: ipRes.asn,
                      isHosting: ipRes.isHostingOrCloud,
                      message: ipRes.summary,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `IP intelligence lookup fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "run_code_security_audit") {
                  try {
                    const codeRes = await cyberSecurityService.scanCodeSecurityAudit();
                    result = {
                      success: true,
                      healthScore: codeRes.overallScore,
                      scannedFiles: codeRes.scannedFilesCount,
                      criticalIssues: codeRes.criticalIssuesCount,
                      warnings: codeRes.warningCount,
                      findings: codeRes.findings,
                      message: codeRes.summary,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Code audit fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "get_linkedin_insights") {
                  const { query } = call.args || {};
                  try {
                    result = await publicApisService.getLinkedInInsights(String(query || ""));
                  } catch (e: any) {
                    result = { success: false, message: `LinkedIn search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_community_links") {
                  const { platform, topic } = call.args || {};
                  try {
                    result = await publicApisService.getCommunityLinks(String(platform || "telegram"), String(topic || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Community search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_pinterest_ideas") {
                  const { query } = call.args || {};
                  try {
                    result = await publicApisService.getPinterestIdeas(String(query || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Pinterest search fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_medicine_and_generic_info") {
                  const { medicineName } = call.args || {};
                  try {
                    result = await publicApisService.getMedicineAndGenericInfo(String(medicineName || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Medicine lookup fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_daily_commodity_rates") {
                  const { commodity, city } = call.args || {};
                  try {
                    result = await publicApisService.getDailyCommodityRates(String(commodity || "all"), city ? String(city) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Commodity rates lookup fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_emergency_helplines") {
                  const { serviceType } = call.args || {};
                  try {
                    result = await publicApisService.getEmergencyHelplines(serviceType ? String(serviceType) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Emergency helpline lookup fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_vehicle_and_challan_services") {
                  const { service, vehicleNumber } = call.args || {};
                  try {
                    result = await publicApisService.getVehicleAndChallanServices(
                      service ? String(service) : undefined,
                      vehicleNumber ? String(vehicleNumber) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Vehicle services lookup fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_utility_and_bill_services") {
                  const { serviceType, providerOrState } = call.args || {};
                  try {
                    result = await publicApisService.getUtilityAndBillServices(
                      String(serviceType || "all"),
                      providerOrState ? String(providerOrState) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Utility services lookup fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_govt_scheme_info") {
                  const { schemeName } = call.args || {};
                  try {
                    result = await publicApisService.getGovtSchemeInfo(String(schemeName || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Govt scheme lookup fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "track_expense_entry") {
                  const { amount, category, note } = call.args || {};
                  try {
                    result = await publicApisService.trackExpenseEntry(
                      Number(amount),
                      String(category || "General"),
                      note ? String(note) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Expense logging fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_daily_expense_summary") {
                  try {
                    result = await publicApisService.getExpenseSummary();
                  } catch (e: any) {
                    result = { success: false, message: `Expense summary fetch fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_bus_travel_info") {
                  const { fromCity, toCity } = call.args || {};
                  try {
                    result = await publicApisService.getBusTravelInfo(String(fromCity || ""), String(toCity || ""));
                  } catch (e: any) {
                    result = { success: false, message: `Bus info lookup fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "scan_wifi_networks") {
                  try {
                    result = await publicApisService.scanWifiNetworks();
                  } catch (e: any) {
                    result = { success: false, message: `WiFi scan fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "get_wifi_status") {
                  try {
                    result = await publicApisService.getCurrentWifiStatus();
                  } catch (e: any) {
                    result = { success: false, message: `WiFi status check fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "connect_to_wifi") {
                  const { ssid, password } = call.args || {};
                  try {
                    result = await publicApisService.connectToWifi(String(ssid || ""), password ? String(password) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `WiFi connect fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "disconnect_wifi") {
                  try {
                    result = await publicApisService.disconnectWifi();
                  } catch (e: any) {
                    result = { success: false, message: `WiFi disconnect fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "setup_boss_voice_recognition") {
                  const { pin, name, relationWithDivakar, spokenPhrase } = call.args || {};
                  try {
                    result = await voiceBiometricsService.enrollVoice(
                      String(pin || ""),
                      String(name || "Boss (Divakar)"),
                      String(relationWithDivakar || "Boss (DK)"),
                      undefined,
                      spokenPhrase ? String(spokenPhrase) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Voice calibration fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "delete_boss_voice_recognition") {
                  const { pin, profileId } = call.args || {};
                  try {
                    result = await voiceBiometricsService.deleteVoiceProfile(
                      String(pin || ""),
                      profileId ? String(profileId) : undefined
                    );
                  } catch (e: any) {
                    result = { success: false, message: `Voice deletion fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "get_coding_agent_status") {
                  try {
                    result = await codeAgentService.getLiveStatusSummary();
                  } catch (e: any) {
                    result = { success: false, message: `Coding Agent status check fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "approve_coding_agent_plan") {
                  const { requestId } = call.args || {};
                  try {
                    result = await codeAgentService.approve(requestId ? String(requestId) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Coding Agent approval fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "approve_and_commit_to_master") {
                  const { requestId } = call.args || {};
                  try {
                    result = await codeAgentService.approveAndPushDirectlyToMain(requestId ? String(requestId) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Master commit command fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "reject_coding_agent_plan") {
                  const { requestId } = call.args || {};
                  try {
                    result = await codeAgentService.deny(requestId ? String(requestId) : undefined);
                  } catch (e: any) {
                    result = { success: false, message: `Reject command fail hua: ${e?.message || e}` };
                  }
                } else if (call.name === "send_command_to_coding_agent") {
                  const { instruction, problemTitle } = call.args || {};
                  try {
                    const req = await codeAgentService.createRequest(
                      String(problemTitle || "Boss Voice Command Task"),
                      String(instruction || ""),
                      "feature",
                      "DK (Voice)"
                    );
                    result = {
                      success: true,
                      requestId: req.id,
                      message: `Boss, Coding Agent ko naya task de diya gaya hai! Task ID: ${req.id}. Agent codebase analyze karke plan bana raha hai.`,
                    };
                  } catch (e: any) {
                    result = { success: false, message: `Coding Agent command fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "execute_service" || call.name === "get_live_train_status" || call.name === "get_pnr_status" || call.name === "get_live_station_board" || call.name === "get_train_fares" || call.name === "get_coach_position") {
                  const action = String(call.args?.action || call.name);
                  const query = String(call.args?.query || call.args?.trainQuery || call.args?.pnr || call.args?.station || "");
                  const targetStation = String(call.args?.targetStation || call.args?.station || "");
                  const fromStation = String(call.args?.fromStation || call.args?.from || "");
                  const toStation = String(call.args?.toStation || call.args?.to || "");
                  
                  try {
                    if (action.includes("schedule") || action.includes("timetable")) {
                      result = await railRadarService.getTrainSchedule(query);
                    } else if (action.includes("refund") || action.includes("cancel")) {
                      result = railRadarService.calculateCancellationRefund("3A", "CNF", 48);
                    } else if (action.includes("seat") || action.includes("availab") || action.includes("tatkal") || action.includes("quota")) {
                      result = await railRadarService.getSeatAvailability(query, fromStation, toStation);
                    } else if (action.includes("coach") || action.includes("layout") || action.includes("general") || action.includes("composition")) {
                      result = await railRadarService.getCoachPosition(query);
                    } else if (action.includes("stop") || action.includes("halt") || action.includes("route_check")) {
                      result = await railRadarService.checkTrainStoppage(query, targetStation || "PNBE");
                                       } else if (action.includes("fare") || action.includes("price") || action.includes("ticket") || action.includes("kiraya")) {
                      const fareRes = await railRadarService.getTrainFares(query, fromStation, toStation);
                      result = fareRes;
                      if (fareRes.success) {
                        safeSend(JSON.stringify({ type: "train_fare_info", fare: fareRes }));
                      }
                    } else if (action.includes("pnr") || /^\d{10}$/.test(query)) {
                      const pnrRes = await railRadarService.getPnrStatus(query);
                      result = pnrRes;
                      if (pnrRes.success) {
                        safeSend(JSON.stringify({ type: "pnr_live_status", pnr: pnrRes }));
                      }
                    } else if (action.includes("station") || action.includes("board")) {
                      const stnRes = await railRadarService.getLiveStationBoard(query);
                      result = stnRes;
                      if (stnRes.success) {
                        safeSend(JSON.stringify({ type: "station_live_board", station: stnRes }));
                      }
                    } else {
                      const statusRes = await railRadarService.getLiveTrainStatus(query);
                      result = statusRes;
                      if (statusRes.success) {
                        safeSend(JSON.stringify({ type: "train_live_status", train: statusRes }));
                      }
                    }
                  } catch (e: any) {
                    result = { success: false, message: `RailRadar service execution fail hui: ${e?.message || e}` };
                  }
                } else if (call.name === "change_voice") {
                  try {
                    const MALE_VOICES = ["Puck","Charon","Fenrir","Orus","Umbriel","Achird","Enceladus","Algieba","Algenib","Gacrux","Zubenelgenubi","Sadaltager","Iapetus","Rasalgethi","Alnilam"];
                    const FEMALE_VOICES = ["Aoede","Kore","Zephyr","Autonoe","Erinome","Laomedeia","Schedar","Achernar","Leda","Callirrhoe","Despina","Vindemiatrix","Sulafat","Pulcherrima","Sadachbia"];
                    const { gender, voiceName, style } = call.args || {};

                    let picked = voiceName as string | undefined;

                    if (!picked) {
                      const pool = gender === "male" ? MALE_VOICES : gender === "female" ? FEMALE_VOICES : [...MALE_VOICES, ...FEMALE_VOICES];
                      picked = pool[Math.floor(Math.random() * pool.length)];
                    }

                    const pickedGender = MALE_VOICES.includes(picked || "") ? "male" : "female";

                    // ✅ Firebase mein save karo — device independent!
                    const { voicePersonaService } = await import("../services/voicePersonaService");
                    await voicePersonaService.setVoice(picked!);

                    // Send signal to frontend to switch voice
                    safeSend(JSON.stringify({
                      type: "voice_change",
                      voiceName: picked,
                      gender: pickedGender,
                    }));

                    result = {
                      success: true,
                      voiceName: picked,
                      gender: pickedGender,
                      message: `Voice "${picked}" Firebase mein save ho gayi! Ab kisi bhi device pe same awaaz rahegi. 🎙️`,
                    };
                  } catch (e: any) {
                    result = { success: false, error: e?.message };
                  }
                }

  } catch (err: any) {
    console.error(`[Friday Tool Dispatcher] Error executing ${call.name}:`, err);
    result = { success: false, error: err?.message || String(err) };
  }

  return result;
}

