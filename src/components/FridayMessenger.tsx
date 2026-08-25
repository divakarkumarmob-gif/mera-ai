import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare,
  Send,
  Paperclip,
  Image,
  FileText,
  Video,
  Mic,
  Smile,
  Search,
  MoreVertical,
  X,
  Shield,
  Heart,
  Users,
  Bot,
  Crown,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { MessengerContact, MessengerMessage, MessengerRole, MediaType } from "../services/fridayMessengerService";

interface FridayMessengerProps {
  onClose: () => void;
}

export const FridayMessenger: React.FC<FridayMessengerProps> = ({ onClose }) => {
  const [contacts, setContacts] = useState<MessengerContact[]>([
    {
      id: "boss_dk",
      name: "DK (Boss 👑)",
      role: "boss",
      avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
      bio: "Creator & Master of FRIDAY",
      unreadCount: 0,
      lastMessage: "Friday, system ready hai?",
      lastTimestamp: Date.now() - 60000,
    },
    {
      id: "special_gf",
      name: "Special Someone 💖",
      role: "girlfriend",
      avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80",
      bio: "VIP Priority Contact",
      unreadCount: 0,
      lastMessage: "DK kahan hai Friday?",
      lastTimestamp: Date.now() - 300000,
    },
    {
      id: "best_friend_aman",
      name: "Aman (Bhai 🤝)",
      role: "friend",
      avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80",
      bio: "College Bro & Gamer",
      unreadCount: 0,
      lastMessage: "Bhai weekend par gaming session?",
      lastTimestamp: Date.now() - 900000,
    },
    {
      id: "unknown_client",
      name: "Alex (New Inquirer 🤖)",
      role: "unknown",
      avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80",
      bio: "External Contact",
      unreadCount: 0,
      lastMessage: "Hi, I have a project inquiry for DK.",
      lastTimestamp: Date.now() - 1800000,
    },
  ]);

  const [activeContactId, setActiveContactId] = useState<string>("boss_dk");
  const [messages, setMessages] = useState<Record<string, MessengerMessage[]>>({
    boss_dk: [
      {
        id: "m1",
        chatId: "boss_dk",
        senderId: "boss_dk",
        senderName: "DK",
        senderRole: "boss",
        text: "Friday, aaj ka system status kaisa hai?",
        mediaType: "text",
        timestamp: Date.now() - 3600000,
        aiGenerated: false,
      },
      {
        id: "m2",
        chatId: "boss_dk",
        senderId: "friday_ai",
        senderName: "FRIDAY AI",
        senderRole: "friday_ai",
        text: "Boss, saare 23 superpowers active hain! System health 100% optimal hai, RAM aur CPU stable hain. Main aapke har command ke liye ready hu! 🚀",
        mediaType: "text",
        timestamp: Date.now() - 3500000,
        aiGenerated: true,
      },
    ],
    special_gf: [
      {
        id: "g1",
        chatId: "special_gf",
        senderId: "special_gf",
        senderName: "Special Someone",
        senderRole: "girlfriend",
        text: "Friday, DK abhi kya kar rahe hain? Subah se baat nahi hui.",
        mediaType: "text",
        timestamp: Date.now() - 1800000,
        aiGenerated: false,
      },
      {
        id: "g2",
        chatId: "special_gf",
        senderId: "friday_ai",
        senderName: "FRIDAY AI",
        senderRole: "friday_ai",
        text: "Bhabhi ji, namaste! 🌸 Boss abhi ek critical project module complete kar rahe hain aur unhone kaha tha ki wo jald hi aapko call karenge. Main unhe turant aapka message alert de deti hu! ✨",
        mediaType: "text",
        timestamp: Date.now() - 1700000,
        aiGenerated: true,
      },
    ],
    best_friend_aman: [
      {
        id: "f1",
        chatId: "best_friend_aman",
        senderId: "best_friend_aman",
        senderName: "Aman",
        senderRole: "friend",
        text: "Yo Friday, DK ko bol shaam ko Valorant khelega kya?",
        mediaType: "text",
        timestamp: Date.now() - 1200000,
        aiGenerated: false,
      },
      {
        id: "f2",
        chatId: "best_friend_aman",
        senderId: "friday_ai",
        senderName: "FRIDAY AI",
        senderRole: "friday_ai",
        text: "Arre Aman bhai! 😂 DK abhi coding grind me busy hai, but shaam ko match ke liye main unko reminder daal deti hu. Setup ready rakhna! 🎮",
        mediaType: "text",
        timestamp: Date.now() - 1100000,
        aiGenerated: true,
      },
    ],
    unknown_client: [
      {
        id: "u1",
        chatId: "unknown_client",
        senderId: "unknown_client",
        senderName: "Alex",
        senderRole: "unknown",
        text: "Hello, I want to discuss a software project with DK. Is he available?",
        mediaType: "text",
        timestamp: Date.now() - 900000,
        aiGenerated: false,
      },
      {
        id: "u2",
        chatId: "unknown_client",
        senderId: "friday_ai",
        senderName: "FRIDAY AI",
        senderRole: "friday_ai",
        text: "Hello Alex! I am FRIDAY, DK's autonomous AI assistant. DK is currently occupied with development. Please share your project scope, budget, and contact email, and I will forward an executive briefing directly to his priority dashboard.",
        mediaType: "text",
        timestamp: Date.now() - 800000,
        aiGenerated: true,
      },
    ],
  });

  const [inputText, setInputText] = useState("");
  const [showMediaModal, setShowMediaModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeContact = contacts.find((c) => c.id === activeContactId) || contacts[0];
  const activeMessages = messages[activeContactId] || [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeContactId]);

  const handleSendMessage = async (
    textToSend: string,
    mediaType: MediaType = "text",
    mediaUrl?: string,
    mediaTitle?: string
  ) => {
    if (!textToSend.trim() && !mediaUrl) return;

    const userMsg: MessengerMessage = {
      id: Math.random().toString(36).substring(2, 9),
      chatId: activeContactId,
      senderId: activeContact.id,
      senderName: activeContact.name,
      senderRole: activeContact.role,
      text: textToSend,
      mediaType,
      mediaUrl,
      mediaTitle,
      timestamp: Date.now(),
      aiGenerated: false,
    };

    setMessages((prev) => ({
      ...prev,
      [activeContactId]: [...(prev[activeContactId] || []), userMsg],
    }));
    setInputText("");
    setIsTyping(true);

    // Call API / Friday persona engine
    setTimeout(() => {
      let aiText = "";
      if (activeContact.role === "boss") {
        aiText = `Boss, command acknowledged: "${textToSend}". Sabhi autonomous protocols background me smoothly execute ho rahe hain! ⚡`;
      } else if (activeContact.role === "girlfriend") {
        aiText = `Bhabhi ji, bilkul! Main Boss ko turant aapka message convey kar rahi hu. Aap bilkul fikar mat kijiye, main yahan sab manage kar rahi hu! 🌸💖`;
      } else if (activeContact.role === "friend") {
        aiText = `Sahi hai bhai! Main DK ko bolta hu, abhi kaam nipta raha hai. Baaki plan done hai! 😎👊`;
      } else {
        aiText = `Thank you for the message. Your query has been categorized and logged into DK's executive schedule. We will get back to you shortly.`;
      }

      const aiMsg: MessengerMessage = {
        id: Math.random().toString(36).substring(2, 9),
        chatId: activeContactId,
        senderId: "friday_ai",
        senderName: "FRIDAY AI",
        senderRole: "friday_ai",
        text: aiText,
        mediaType: "text",
        timestamp: Date.now(),
        aiGenerated: true,
      };

      setMessages((prev) => ({
        ...prev,
        [activeContactId]: [...(prev[activeContactId] || []), aiMsg],
      }));
      setIsTyping(false);
    }, 1200);
  };

  const cycleContactRole = (contactId: string) => {
    const roles: MessengerRole[] = ["boss", "girlfriend", "friend", "unknown"];
    setContacts((prev) =>
      prev.map((c) => {
        if (c.id === contactId) {
          const nextIdx = (roles.indexOf(c.role) + 1) % roles.length;
          return { ...c, role: roles[nextIdx] };
        }
        return c;
      })
    );
  };

  const getRoleBadge = (role: MessengerRole) => {
    switch (role) {
      case "boss":
        return {
          label: "Boss 👑",
          bg: "bg-amber-500/20 text-amber-300 border-amber-500/40",
          icon: Crown,
        };
      case "girlfriend":
        return {
          label: "Special VIP 💖",
          bg: "bg-pink-500/20 text-pink-300 border-pink-500/40",
          icon: Heart,
        };
      case "friend":
        return {
          label: "Friend 🤝",
          bg: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40",
          icon: Users,
        };
      default:
        return {
          label: "Unknown / Gatekeeper 🤖",
          bg: "bg-slate-500/20 text-slate-300 border-slate-500/40",
          icon: Shield,
        };
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xl flex items-center justify-center p-2 sm:p-6"
    >
      <div className="w-full max-w-6xl h-[90vh] bg-slate-900/90 border border-purple-500/40 rounded-3xl shadow-[0_0_80px_rgba(168,85,247,0.25)] flex overflow-hidden">
        {/* Left Sidebar: Contacts */}
        <div className="w-80 sm:w-96 border-r border-slate-800 flex flex-col bg-slate-950/50">
          {/* Sidebar Header */}
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-purple-600 to-cyan-500 flex items-center justify-center text-white font-bold shadow-lg shadow-purple-500/30">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-bold text-white text-base leading-tight">FRIDAY Messenger</h2>
                <p className="text-[11px] text-purple-400 font-medium">Multi-Role Autonomous AI</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Search Box */}
          <div className="p-3 border-b border-slate-800/60">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search chats or roles..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700/60 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>

          {/* Contacts List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/40">
            {contacts
              .filter((c) => c.name.toLowerCase().includes(searchQuery.toLowerCase()) || c.role.includes(searchQuery.toLowerCase()))
              .map((c) => {
                const badge = getRoleBadge(c.role);
                const isSelected = c.id === activeContactId;
                return (
                  <div
                    key={c.id}
                    onClick={() => setActiveContactId(c.id)}
                    className={`p-3.5 flex items-center gap-3 cursor-pointer transition-all ${
                      isSelected
                        ? "bg-purple-950/40 border-l-4 border-purple-500"
                        : "hover:bg-slate-800/40"
                    }`}
                  >
                    <div className="relative">
                      <img
                        src={c.avatar}
                        alt={c.name}
                        className="w-12 h-12 rounded-2xl object-cover border border-slate-700"
                      />
                      <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-slate-900" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="font-semibold text-white text-sm truncate">{c.name}</h4>
                        <span className="text-[10px] text-slate-400">Now</span>
                      </div>

                      <div className="flex items-center justify-between gap-1">
                        <p className="text-xs text-slate-400 truncate max-w-[140px]">{c.lastMessage || c.bio}</p>
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            cycleContactRole(c.id);
                          }}
                          title="Click to switch role"
                          className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${badge.bg}`}
                        >
                          {badge.label}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        {/* Right Chat Window */}
        <div className="flex-1 flex flex-col bg-slate-900/60">
          {/* Chat Header */}
          <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
            <div className="flex items-center gap-3">
              <img
                src={activeContact.avatar}
                alt={activeContact.name}
                className="w-11 h-11 rounded-2xl object-cover border border-purple-500/30 shadow-md"
              />
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-white text-base">{activeContact.name}</h3>
                  <button
                    onClick={() => cycleContactRole(activeContact.id)}
                    className={`text-[11px] px-2.5 py-0.5 rounded-full border font-medium flex items-center gap-1 ${getRoleBadge(activeContact.role).bg}`}
                  >
                    <Sparkles className="w-3 h-3" />
                    {getRoleBadge(activeContact.role).label}
                  </button>
                </div>
                <p className="text-xs text-emerald-400 flex items-center gap-1.5 mt-0.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Friday Autonomous Agent Active
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  handleSendMessage(
                    `Friday, ${activeContact.name} ko latest project status update share karo.`,
                    "text"
                  )
                }
                className="px-3 py-1.5 rounded-xl bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/40 text-purple-200 text-xs font-medium flex items-center gap-1.5 transition-colors"
              >
                <Bot className="w-3.5 h-3.5" />
                AI Prompt Relay
              </button>
            </div>
          </div>

          {/* Messages Stream */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {activeMessages.map((msg) => {
              const isAi = msg.senderRole === "friday_ai";
              return (
                <div
                  key={msg.id}
                  className={`flex items-start gap-2.5 ${isAi ? "justify-start" : "justify-end"}`}
                >
                  {isAi && (
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shadow-md shadow-purple-500/20">
                      ⚡
                    </div>
                  )}

                  <div
                    className={`max-w-[75%] rounded-2xl p-3.5 text-sm ${
                      isAi
                        ? "bg-slate-800/90 text-slate-100 border border-purple-500/30 shadow-lg"
                        : "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-600/20"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 mb-1">
                      <span className="text-[11px] font-semibold text-purple-300">
                        {isAi ? "FRIDAY (Autonomous AI)" : msg.senderName}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>

                    {/* Media Attachments */}
                    {msg.mediaType === "image" && msg.mediaUrl && (
                      <div className="my-2 rounded-xl overflow-hidden border border-slate-700">
                        <img src={msg.mediaUrl} alt="Attached" className="max-h-60 w-full object-cover" />
                      </div>
                    )}

                    {msg.mediaType === "pdf" && (
                      <div className="my-2 p-3 rounded-xl bg-slate-900/60 border border-slate-700 flex items-center gap-2.5">
                        <FileText className="w-6 h-6 text-red-400" />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-xs text-white truncate">{msg.mediaTitle || "Document.pdf"}</p>
                          <span className="text-[10px] text-slate-400">Verified by Friday PDF Copilot</span>
                        </div>
                      </div>
                    )}

                    {msg.mediaType === "link" && msg.mediaUrl && (
                      <a
                        href={msg.mediaUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="my-2 p-2.5 rounded-xl bg-slate-900/60 border border-cyan-500/30 flex items-center justify-between text-xs text-cyan-300 hover:underline"
                      >
                        <span className="truncate">{msg.mediaUrl}</span>
                        <ExternalLink className="w-4 h-4 ml-1 flex-shrink-0" />
                      </a>
                    )}

                    <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                  </div>
                </div>
              );
            })}

            {isTyping && (
              <div className="flex items-center gap-2 text-xs text-purple-400 p-2">
                <div className="w-6 h-6 rounded-lg bg-purple-600/30 flex items-center justify-center">⚡</div>
                <span>Friday is analyzing and typing according to {activeContact.role.toUpperCase()} persona...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Footer */}
          <div className="p-3 border-t border-slate-800 bg-slate-950/60">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage(inputText);
              }}
              className="flex items-center gap-2"
            >
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowMediaModal(!showMediaModal)}
                  className="p-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  <Paperclip className="w-5 h-5" />
                </button>

                {/* Media Attachment Selector Popup */}
                {showMediaModal && (
                  <div className="absolute bottom-full mb-2 left-0 w-48 bg-slate-900 border border-slate-700 rounded-2xl p-2 shadow-2xl space-y-1 z-20">
                    <button
                      type="button"
                      onClick={() => {
                        setShowMediaModal(false);
                        handleSendMessage(
                          "Here is the project architecture mockup image.",
                          "image",
                          "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=500&auto=format&fit=crop&q=80"
                        );
                      }}
                      className="w-full flex items-center gap-2.5 p-2 rounded-xl text-xs text-white hover:bg-slate-800 transition-colors"
                    >
                      <Image className="w-4 h-4 text-purple-400" />
                      Send Image / Photo
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowMediaModal(false);
                        handleSendMessage("Attached technical report PDF document.", "pdf", undefined, "Friday_System_Report.pdf");
                      }}
                      className="w-full flex items-center gap-2.5 p-2 rounded-xl text-xs text-white hover:bg-slate-800 transition-colors"
                    >
                      <FileText className="w-4 h-4 text-red-400" />
                      Send PDF / Doc
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowMediaModal(false);
                        handleSendMessage("Check out this live demo link:", "link", "https://github.com/divakar/mera-ai");
                      }}
                      className="w-full flex items-center gap-2.5 p-2 rounded-xl text-xs text-white hover:bg-slate-800 transition-colors"
                    >
                      <ExternalLink className="w-4 h-4 text-cyan-400" />
                      Send Smart Link
                    </button>
                  </div>
                )}
              </div>

              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={`Message ${activeContact.name} (Friday will auto-respond in ${activeContact.role} persona)...`}
                className="flex-1 bg-slate-900 border border-slate-700/80 rounded-2xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />

              <button
                type="submit"
                disabled={!inputText.trim()}
                className="p-3 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-purple-600/30 transition-all"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
