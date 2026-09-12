import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, Send, Plus, Sparkles, Image, FileText, Music, Video, 
  Trash2, Copy, Check, RefreshCw, Cpu, Layers, AlertCircle, 
  ChevronDown, Search, Paperclip, Clock, Gauge, Zap
} from 'lucide-react';
import { getApiUrl } from '@/utils/api';

export interface ModelCategory {
  category: string;
  badge: string;
  models: Array<{
    id: string;
    name: string;
    type: string;
    rateLimit: string;
    description: string;
    icon?: string;
  }>;
}

export const AI_STUDIO_MODELS: ModelCategory[] = [
  {
    category: "⚡ 1. Text-Out Models (Core Reasoning & Generation)",
    badge: "Reasoning",
    models: [
      {
        id: "gemini-3.5-flash",
        name: "Gemini 3.5 Flash",
        type: "Text-out models",
        rateLimit: "RPM: 1/5 | TPM: 338/250K | RPD: 1/20",
        description: "Next-gen flagship high-speed reasoning, coding & multimodal model.",
        icon: "⚡",
      },
      {
        id: "gemini-3.5-flash-lite",
        name: "Gemini 3.5 Flash Lite",
        type: "Text-out models",
        rateLimit: "RPM: 3/15 | TPM: 18.97K/250K | RPD: 23/500",
        description: "Ultra-low latency lightweight model optimized for high-throughput live apps.",
        icon: "🚀",
      },
      {
        id: "gemini-3.6-flash",
        name: "Gemini 3.6 Flash",
        type: "Text-out models",
        rateLimit: "RPM: 1/5 | TPM: 44.32K/250K | RPD: 3/20",
        description: "Advanced intelligence, deep reasoning, vision and complex instruction following.",
        icon: "🧠",
      },
      {
        id: "gemini-3.1-flash-lite",
        name: "Gemini 3.1 Flash Lite",
        type: "Text-out models",
        rateLimit: "RPM: 2/15 | TPM: 38.68K/250K | RPD: 19/500",
        description: "Fast, cost-efficient model for sub-second conversations and agent workflows.",
        icon: "💨",
      },
      {
        id: "gemini-3.7-flash",
        name: "Gemini 3.7 Flash",
        type: "Text-out models",
        rateLimit: "RPM: 0/5 | TPM: 0/250K | RPD: 0/20",
        description: "Next-tier preview with enhanced mathematical logic and coding abilities.",
        icon: "🔬",
      },
      {
        id: "gemini-3.8-flash",
        name: "Gemini 3.8 Flash",
        type: "Text-out models",
        rateLimit: "RPM: 0/5 | TPM: 0/250K | RPD: 0/20",
        description: "Cutting-edge frontier flash model with ultra-large context handling.",
        icon: "✨",
      },
      {
        id: "gemini-3.1-pro",
        name: "Gemini 3.1 Pro",
        type: "Text-out models",
        rateLimit: "RPM: 0/0 | TPM: 0/0 | RPD: 0/0",
        description: "High-parameter deep thinking and multi-step complex logic model.",
        icon: "🏆",
      },
      {
        id: "gemini-3-flash",
        name: "Gemini 3 Flash",
        type: "Text-out models",
        rateLimit: "RPM: 0/5 | TPM: 0/250K | RPD: 0/20",
        description: "Generation 3 multimodal production model.",
        icon: "🎯",
      },
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        type: "Text-out models",
        rateLimit: "RPM: 0/5 | TPM: 0/250K | RPD: 0/20",
        description: "Standard generation 2.5 flash reasoning model.",
        icon: "⚡",
      },
      {
        id: "gemini-2.5-flash-lite",
        name: "Gemini 2.5 Flash Lite",
        type: "Text-out models",
        rateLimit: "RPM: 0/10 | TPM: 0/250K | RPD: 0/20",
        description: "Lightweight generation 2.5 conversational model.",
        icon: "🚀",
      },
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        type: "Text-out models",
        rateLimit: "RPM: 0/0 | TPM: 0/0 | RPD: 0/0",
        description: "Flagship 2.5 pro tier reasoning engine.",
        icon: "💎",
      },
      {
        id: "gemini-2-flash",
        name: "Gemini 2 Flash",
        type: "Text-out models",
        rateLimit: "RPM: 0/0 | TPM: 0/0 | RPD: 0/0",
        description: "Gen 2 fast response multimodal model.",
        icon: "⚡",
      },
      {
        id: "gemini-2-flash-lite",
        name: "Gemini 2 Flash Lite",
        type: "Text-out models",
        rateLimit: "RPM: 0/0 | TPM: 0/0 | RPD: 0/0",
        description: "Gen 2 high throughput lite model.",
        icon: "💨",
      },
    ],
  },
  {
    category: "🎨 2. Multi-Modal Generative (Images, Video, Speech & Music)",
    badge: "Media Gen",
    models: [
      {
        id: "nano-banana-pro",
        name: "Nano Banana Pro (Gemini 3 Pro Image)",
        type: "Multi-modal generative",
        rateLimit: "RPM: 0/0 | TPM: 0/0 | RPD: 0/0",
        description: "Professional high-detail 4K image and graphic design generation.",
        icon: "🍌",
      },
      {
        id: "nano-banana-2",
        name: "Nano Banana 2 (Gemini 3.1 Flash Image)",
        type: "Multi-modal generative",
        rateLimit: "RPM: 0/0 | TPM: 0/0 | RPD: 0/0",
        description: "State-of-the-art fast image generation with photorealistic prompt comprehension.",
        icon: "🎨",
      },
      {
        id: "nano-banana-2-lite",
        name: "Nano Banana 2 Lite (Gemini 3.1 Flash Lite Image)",
        type: "Multi-modal generative",
        rateLimit: "RPM: 0/0 | TPM: 0/0 | RPD: 0/0",
        description: "Ultra-fast thumbnail and sketch image generation.",
        icon: "⚡",
      },
      {
        id: "nano-banana-preview",
        name: "Nano Banana (Gemini 2.5 Flash Preview Image)",
        type: "Multi-modal generative",
        rateLimit: "RPM: 0/0 | TPM: 0/0 | RPD: 0/0",
        description: "Generation 2.5 preview image synthesis model.",
        icon: "🖼️",
      },
      {
        id: "gemini-3.1-flash-tts",
        name: "Gemini 3.1 Flash TTS",
        type: "Multi-modal generative",
        rateLimit: "RPM: 0/3 | TPM: 0/10K | RPD: 0/10",
        description: "Ultra-natural native speech synthesis with emotional inflections.",
        icon: "🔊",
      },
      {
        id: "gemini-2.5-flash-tts",
        name: "Gemini 2.5 Flash TTS",
        type: "Multi-modal generative",
        rateLimit: "RPM: 0/3 | TPM: 0/10K | RPD: 0/10",
        description: "Gen 2.5 fast text-to-speech audio rendering.",
        icon: "🗣️",
      },
      {
        id: "gemini-2.5-pro-tts",
        name: "Gemini 2.5 Pro TTS",
        type: "Multi-modal generative",
        rateLimit: "RPM: 0/0 | TPM: 0/0 | RPD: 0/0",
        description: "Studio-quality professional narrative voice generation.",
        icon: "🎙️",
      },
      {
        id: "gemini-omni-1.1-flash",
        name: "Gemini Omni 1.1 Flash",
        type: "Multi-modal generative",
        rateLimit: "RPM: 0/0 | TPM: 0/0 | RPD: 0/0",
        description: "Next-gen unified omnimodal audio, video & text synthesis.",
        icon: "🔮",
      },
      {
        id: "gemini-omni-flash",
        name: "Gemini Omni Flash",
        type: "Multi-modal generative",
        rateLimit: "RPM: 0/0 | TPM: 0/0 | RPD: 0/0",
        description: "Unified multimodal generative model across all modalities.",
        icon: "🌐",
      },
      {
        id: "veo-3-generate",
        name: "Veo 3 Generate",
        type: "Multi-modal generative",
        rateLimit: "RPM: 0/0 | Cinematic Video",
        description: "Google's cinematic 1080p generative video model.",
        icon: "🎬",
      },
      {
        id: "veo-3-fast-generate",
        name: "Veo 3 Fast Generate",
        type: "Multi-modal generative",
        rateLimit: "RPM: 0/0 | Fast Video",
        description: "Real-time rapid preview video generation.",
        icon: "📹",
      },
      {
        id: "veo-3-lite-generate",
        name: "Veo 3 Lite Generate",
        type: "Multi-modal generative",
        rateLimit: "RPM: 0/0 | Lite Video",
        description: "Low-compute mobile video animation generator.",
        icon: "🎞️",
      },
      {
        id: "lyria-3-pro",
        name: "Lyria 3 Pro",
        type: "Multi-modal generative",
        rateLimit: "RPM: 0/0 | Audio Studio",
        description: "Full-fidelity music synthesis, instrumental backing, and vocal tracks.",
        icon: "🎵",
      },
      {
        id: "lyria-3-clip",
        name: "Lyria 3 Clip",
        type: "Multi-modal generative",
        rateLimit: "RPM: 0/0 | Music Clip",
        description: "Instant 30s short melody, beat, and sound clip synthesis.",
        icon: "🎼",
      },
    ],
  },
  {
    category: "🎙️ 3. Live API Models (Streaming Speech & Bidirectional Dialog)",
    badge: "Live API",
    models: [
      {
        id: "gemini-3-flash-live",
        name: "Gemini 3 Flash Live",
        type: "Live API",
        rateLimit: "RPM: 2/Unlimited | TPM: 24.91K/65K | RPD: 18/Unlimited",
        description: "Full duplex low-latency audio/video bidirectional live dialogue.",
        icon: "📡",
      },
      {
        id: "gemini-3.5-transcribe-live",
        name: "Gemini 3.5 Transcribe Live",
        type: "Live API",
        rateLimit: "RPM: 0/Unlimited | TPM: 0/20K | RPD: 0/Unlimited",
        description: "Real-time streaming speech-to-text with multi-speaker diarization.",
        icon: "🎙️",
      },
      {
        id: "gemini-3.5-live-translate",
        name: "Gemini 3.5 Live Translate",
        type: "Live API",
        rateLimit: "RPM: 0/Unlimited | TPM: 0/20K | RPD: 0/Unlimited",
        description: "Instantaneous bidirectional real-time audio translation.",
        icon: "🌐",
      },
      {
        id: "gemini-2.5-flash-native-audio",
        name: "Gemini 2.5 Flash Native Audio Dialog",
        type: "Live API",
        rateLimit: "RPM: 0/Unlimited | TPM: 0/1M | RPD: 0/Unlimited",
        description: "Native audio understanding and voice response streaming.",
        icon: "🎧",
      },
      {
        id: "gemini-3.5-transcribe",
        name: "Gemini 3.5 Transcribe",
        type: "Live API",
        rateLimit: "RPM: 0/3 | TPM: 0/10K | RPD: 0/25",
        description: "High accuracy audio-to-text transcription engine.",
        icon: "📝",
      },
    ],
  },
  {
    category: "🤖 4. Autonomous Agents & Tools",
    badge: "Agents & Tools",
    models: [
      {
        id: "antigravity",
        name: "Antigravity",
        type: "Agents",
        rateLimit: "RPM: 0/60 | TPM: 0/100K | RPD: 0/100",
        description: "Google DeepMind's Advanced Autonomous Agent Architecture.",
        icon: "🚀",
      },
      {
        id: "deep-research-pro-preview",
        name: "Deep Research Pro Preview",
        type: "Agents",
        rateLimit: "500 Map Groundings",
        description: "Multi-step web crawling, citation synthesis, and research report agent.",
        icon: "🔍",
      },
      {
        id: "computer-use-preview",
        name: "Computer Use Preview",
        type: "Other models",
        rateLimit: "500 UI Automations",
        description: "Browser & desktop UI automation via visual screenshots and click actions.",
        icon: "💻",
      },
      {
        id: "gemini-robotics-er-2-preview",
        name: "Gemini Robotics ER 2 Preview",
        type: "Other models",
        rateLimit: "RPM: 0/5 | TPM: 0/250K | RPD: 0/20",
        description: "Spatial reasoning, 3D object manipulation, and embodied AI robotics.",
        icon: "🤖",
      },
    ],
  },
  {
    category: "💎 5. Open Weights & Embeddings",
    badge: "Embeddings & Open",
    models: [
      {
        id: "gemma-4-26b",
        name: "Gemma 4 26B",
        type: "Other models",
        rateLimit: "RPM: 0/30 | TPM: 0/16K | RPD: 0/14.4K",
        description: "Google's open-weights 26B dense transformer model.",
        icon: "💎",
      },
      {
        id: "gemma-4-31b",
        name: "Gemma 4 31B",
        type: "Other models",
        rateLimit: "RPM: 0/30 | TPM: 0/16K | RPD: 0/14.4K",
        description: "High-parameter open weights model for specialized research tasks.",
        icon: "💠",
      },
      {
        id: "gemini-embedding-1",
        name: "Gemini Embedding 1",
        type: "Other models",
        rateLimit: "RPM: 0/100 | TPM: 0/30K | RPD: 0/1K",
        description: "High-density 768/1536-dimensional semantic vector embeddings.",
        icon: "📐",
      },
      {
        id: "gemini-embedding-2",
        name: "Gemini Embedding 2",
        type: "Other models",
        rateLimit: "RPM: 0/100 | TPM: 0/30K | RPD: 0/1K",
        description: "Next-generation multimodal cross-lingual vector space.",
        icon: "🧬",
      },
    ],
  },
  {
    category: "🗺️ 6. Grounding & Search Models",
    badge: "Grounding",
    models: [
      {
        id: "gemini-2-search-grounding",
        name: "Gemini 2 (Search Grounding)",
        type: "Search Grounding",
        rateLimit: "0 / 1.5K Search Grounding",
        description: "Real-time Google Web Search grounding and source attribution.",
        icon: "🌐",
      },
      {
        id: "gemini-2.5-search-grounding",
        name: "Gemini 2.5 (Search Grounding)",
        type: "Search Grounding",
        rateLimit: "0 / 1.5K Search Grounding",
        description: "Enhanced search grounding with live factual verification.",
        icon: "🔎",
      },
      {
        id: "gemini-3-search-grounding",
        name: "Gemini 3 (Search Grounding)",
        type: "Search Grounding",
        rateLimit: "Search Grounding Active",
        description: "Gen 3 search-augmented reasoning engine.",
        icon: "⚡",
      },
      {
        id: "default-search-grounding",
        name: "Default (Search Grounding)",
        type: "Search Grounding",
        rateLimit: "0 / 1.5K Search Grounding",
        description: "Default fallback search grounding model for live queries.",
        icon: "📍",
      },
    ],
  },
];

interface ChatMessage {
  id: string;
  sender: 'user' | 'model';
  text: string;
  timestamp: number;
  modelUsed?: string;
  latencyMs?: number;
  tokensUsed?: number;
  media?: {
    name: string;
    type: 'image' | 'pdf' | 'audio' | 'video' | 'file';
    url?: string;
    size?: string;
  };
}

interface AttachedMedia {
  file: File;
  name: string;
  type: 'image' | 'pdf' | 'audio' | 'video' | 'file';
  previewUrl: string;
  base64?: string;
  mimeType: string;
}

interface ModelTesterCapsuleProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ModelTesterCapsule: React.FC<ModelTesterCapsuleProps> = ({ isOpen, onClose }) => {
  const [selectedModel, setSelectedModel] = useState<string>("gemini-3.5-flash");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [inputPrompt, setInputPrompt] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome_msg",
      sender: "model",
      text: "नमस्ते Boss! मैं **FRIDAY Model Test** हूँ। आप ऊपर दिए गए Dropdown से कोई भी Model सेलेक्ट कर सकते हैं और यहाँ Live Prompt, PDF, Audio, Video, Photo या Code टेस्ट कर सकते हैं।",
      timestamp: Date.now(),
      modelUsed: "gemini-3.5-flash",
    }
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [attachedMedia, setAttachedMedia] = useState<AttachedMedia | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll chat to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Find currently selected model object
  const currentModelObj = AI_STUDIO_MODELS.flatMap(c => c.models).find(m => m.id === selectedModel) || AI_STUDIO_MODELS[0].models[0];

  // Filtered categories for dropdown search
  const filteredCategories = AI_STUDIO_MODELS.map(cat => ({
    ...cat,
    models: cat.models.filter(m => 
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      m.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.description.toLowerCase().includes(searchQuery.toLowerCase())
    )
  })).filter(cat => cat.models.length > 0);

  // Handle Media File Selection via (+) Button
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    let mediaType: 'image' | 'pdf' | 'audio' | 'video' | 'file' = 'file';
    if (file.type.startsWith('image/')) mediaType = 'image';
    else if (file.type === 'application/pdf') mediaType = 'pdf';
    else if (file.type.startsWith('audio/')) mediaType = 'audio';
    else if (file.type.startsWith('video/')) mediaType = 'video';

    const reader = new FileReader();
    reader.onload = () => {
      const base64Data = reader.result as string;
      setAttachedMedia({
        file,
        name: file.name,
        type: mediaType,
        previewUrl: URL.createObjectURL(file),
        base64: base64Data,
        mimeType: file.type || 'application/octet-stream',
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Submit Prompt to Model
  const handleSendMessage = async () => {
    if ((!inputPrompt.trim() && !attachedMedia) || isLoading) return;

    const userText = inputPrompt.trim();
    const mediaObj = attachedMedia ? {
      name: attachedMedia.name,
      type: attachedMedia.type,
      url: attachedMedia.previewUrl,
      size: `${(attachedMedia.file.size / 1024).toFixed(1)} KB`
    } : undefined;

    const userMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      sender: 'user',
      text: userText || `[Sent ${attachedMedia?.name}]`,
      timestamp: Date.now(),
      media: mediaObj,
    };

    setMessages(prev => [...prev, userMessage]);
    setInputPrompt("");
    const mediaToSend = attachedMedia;
    setAttachedMedia(null);
    setIsLoading(true);

    const startTime = Date.now();

    try {
      // Build past history for multi-turn context
      const history = messages.slice(-8).map(m => ({
        role: m.sender === 'user' ? 'user' : 'model',
        text: m.text,
      }));

      const localKey =
        localStorage.getItem("gemini_api_key") ||
        localStorage.getItem("GEMINI_API_KEY") ||
        localStorage.getItem("apiKey") ||
        "";

      const res = await fetch(getApiUrl('/api/model-tester/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          prompt: userText,
          history,
          apiKey: localKey || undefined,
          media: mediaToSend ? {
            name: mediaToSend.name,
            mimeType: mediaToSend.mimeType,
            base64: mediaToSend.base64,
          } : undefined,
        }),
      });

      const data = await res.json();
      const latency = Date.now() - startTime;
      const replyContent = data?.reply || data?.text;

      if (data?.ok && replyContent) {
        const modelReply: ChatMessage = {
          id: `model_${Date.now()}`,
          sender: 'model',
          text: replyContent,
          timestamp: Date.now(),
          modelUsed: data.modelUsed || data.model || selectedModel,
          latencyMs: data.latencyMs || data.durationMs || latency,
          tokensUsed: data.tokensUsed,
        };
        setMessages(prev => [...prev, modelReply]);
      } else {
        const errorReply: ChatMessage = {
          id: `error_${Date.now()}`,
          sender: 'model',
          text: `⚠️ **Model Error:** ${data?.error || 'Failed to get response from model.'}\n\n_Tip: Ensure GEMINI_API_KEY is active in Render environment variables or settings._`,
          timestamp: Date.now(),
          modelUsed: selectedModel,
          latencyMs: latency,
        };
        setMessages(prev => [...prev, errorReply]);
      }
    } catch (err: any) {
      const latency = Date.now() - startTime;
      const errorReply: ChatMessage = {
        id: `error_${Date.now()}`,
        sender: 'model',
        text: `⚠️ **Network Error:** ${err?.message || 'Could not reach server.'}`,
        timestamp: Date.now(),
        modelUsed: selectedModel,
        latencyMs: latency,
      };
      setMessages(prev => [...prev, errorReply]);
    } finally {
      setIsLoading(false);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  };

  const copyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const clearChat = () => {
    setMessages([
      {
        id: "cleared_welcome",
        sender: "model",
        text: `✨ Chat reset. Active model: **${currentModelObj.name}** (${currentModelObj.id}). Ready for testing!`,
        timestamp: Date.now(),
        modelUsed: selectedModel,
      }
    ]);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md"
        onClick={() => setIsDropdownOpen(false)}
      >
        <motion.div
          initial={{ scale: 0.94, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.94, opacity: 0, y: 20 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="relative w-full max-w-5xl h-[92vh] max-h-[900px] flex flex-col rounded-3xl bg-slate-950/95 border border-cyan-500/30 shadow-[0_0_80px_rgba(6,182,212,0.25)] overflow-hidden text-slate-100"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Top Decorative Neon Glow Header */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 shadow-[0_0_15px_rgba(6,182,212,0.8)]" />

          {/* ── HEADER & MODEL SELECTOR BAR ── */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-cyan-500/20 bg-slate-900/90 backdrop-blur-lg">
            {/* Left: Capsule Title & Badge */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-600/30 border border-cyan-400/40 flex items-center justify-center text-xl shadow-[0_0_20px_rgba(6,182,212,0.4)]">
                🧪
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base sm:text-lg font-bold bg-gradient-to-r from-cyan-300 via-sky-200 to-indigo-200 bg-clip-text text-transparent">
                    Model Test
                  </h2>
                  <span className="px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                    Live Testing
                  </span>
                </div>
                <p className="text-xs text-slate-400 flex items-center gap-1.5 font-mono">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Selected: <b>{currentModelObj.name}</b></span>
                  <span className="text-slate-600">|</span>
                  <span className="text-cyan-400/80">{currentModelObj.rateLimit}</span>
                </p>
              </div>
            </div>

            {/* Right: Actions & Model Selector Dropdown */}
            <div className="flex items-center gap-2.5">
              {/* Clear Chat Button */}
              <button
                onClick={clearChat}
                title="Clear current test session"
                className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-slate-400 hover:text-slate-200 border border-white/5 transition-all text-xs flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Clear</span>
              </button>

              {/* ── MODEL SELECTOR DROPDOWN BUTTON ── */}
              <div className="relative">
                <button
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-cyan-950/60 hover:bg-cyan-900/60 text-cyan-200 border border-cyan-500/40 shadow-[0_0_20px_rgba(6,182,212,0.15)] transition-all text-xs sm:text-sm font-medium"
                >
                  <span className="text-base">{currentModelObj.icon || "⚡"}</span>
                  <span className="max-w-[140px] sm:max-w-[200px] truncate">{currentModelObj.name}</span>
                  <ChevronDown className={`w-4 h-4 text-cyan-400 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Dropdown Menu Modal / Popover */}
                <AnimatePresence>
                  {isDropdownOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.96 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 mt-2 w-[340px] sm:w-[420px] max-h-[520px] rounded-2xl bg-slate-900/98 border border-cyan-500/40 shadow-[0_15px_60px_rgba(0,0,0,0.8)] backdrop-blur-2xl z-50 flex flex-col overflow-hidden"
                    >
                      {/* Search Bar Inside Dropdown */}
                      <div className="p-3 border-b border-white/10 bg-slate-950/70">
                        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/90 border border-cyan-500/20 text-xs">
                          <Search className="w-3.5 h-3.5 text-cyan-400" />
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search models..."
                            className="bg-transparent text-slate-100 placeholder-slate-500 focus:outline-none w-full text-xs"
                            onClick={(e) => e.stopPropagation()}
                          />
                          {searchQuery && (
                            <button onClick={() => setSearchQuery("")} className="text-slate-400 hover:text-white">
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Line-by-Line Categorized Model List */}
                      <div className="flex-1 overflow-y-auto p-2 space-y-3 custom-scrollbar">
                        {filteredCategories.map((categoryGroup, idx) => (
                          <div key={idx} className="space-y-1">
                            <div className="flex items-center justify-between px-2.5 py-1 text-[11px] font-bold text-cyan-300/80 uppercase tracking-wider">
                              <span>{categoryGroup.category}</span>
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                                {categoryGroup.badge}
                              </span>
                            </div>

                            <div className="space-y-1">
                              {categoryGroup.models.map((model) => {
                                const isSelected = model.id === selectedModel;
                                return (
                                  <button
                                    key={model.id}
                                    onClick={() => {
                                      setSelectedModel(model.id);
                                      setIsDropdownOpen(false);
                                      setSearchQuery("");
                                    }}
                                    className={`w-full text-left p-2.5 rounded-xl transition-all flex items-start gap-2.5 ${
                                      isSelected
                                        ? 'bg-cyan-500/20 border border-cyan-400/50 shadow-[0_0_15px_rgba(6,182,212,0.2)]'
                                        : 'hover:bg-slate-800/70 border border-transparent text-slate-300 hover:text-white'
                                    }`}
                                  >
                                    <div className="text-lg mt-0.5">{model.icon || "⚡"}</div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center justify-between gap-1.5">
                                        <p className={`text-xs font-semibold truncate ${isSelected ? 'text-cyan-200' : 'text-slate-200'}`}>
                                          {model.name}
                                        </p>
                                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-950 text-cyan-300 border border-cyan-500/20 shrink-0">
                                          {model.type}
                                        </span>
                                      </div>
                                      <p className="text-[10px] text-slate-400 line-clamp-1 mt-0.5">
                                        {model.description}
                                      </p>
                                      <div className="flex items-center gap-2 mt-1 text-[9px] font-mono text-emerald-400/90">
                                        <span>📊 {model.rateLimit}</span>
                                      </div>
                                    </div>
                                    {isSelected && (
                                      <Check className="w-4 h-4 text-cyan-400 shrink-0 mt-1" />
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Close Modal Button */}
              <button
                onClick={onClose}
                className="p-2 rounded-xl bg-slate-800/80 hover:bg-red-500/20 text-slate-400 hover:text-red-400 border border-white/5 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* ── CHAT MESSAGES STREAM ── */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 custom-scrollbar bg-slate-950/60">
            {messages.map((msg) => {
              const isUser = msg.sender === 'user';
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-1.5`}
                >
                  <div className="flex items-center gap-2 text-[10px] text-slate-400 px-1 font-mono">
                    <span>{isUser ? '👤 You' : `🤖 ${msg.modelUsed || selectedModel}`}</span>
                    <span>•</span>
                    <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    {msg.latencyMs && (
                      <>
                        <span>•</span>
                        <span className="text-emerald-400 flex items-center gap-0.5">
                          <Zap className="w-2.5 h-2.5" />
                          {msg.latencyMs}ms
                        </span>
                      </>
                    )}
                  </div>

                  {/* Message Bubble Container */}
                  <div
                    className={`max-w-[85%] sm:max-w-[75%] rounded-2xl p-4 text-sm leading-relaxed border ${
                      isUser
                        ? 'bg-gradient-to-r from-cyan-600/90 to-blue-600/90 text-white border-cyan-400/30 rounded-tr-sm shadow-[0_0_25px_rgba(6,182,212,0.2)]'
                        : 'bg-slate-900/90 text-slate-200 border-cyan-500/20 rounded-tl-sm shadow-[0_0_20px_rgba(0,0,0,0.5)]'
                    }`}
                  >
                    {/* Attached Media Preview (If Any) */}
                    {msg.media && (
                      <div className="mb-3 p-2.5 rounded-xl bg-slate-950/80 border border-white/10 flex items-center gap-3">
                        {msg.media.type === 'image' && msg.media.url && (
                          <img src={msg.media.url} alt={msg.media.name} className="w-16 h-16 object-cover rounded-lg border border-white/10" />
                        )}
                        {msg.media.type === 'pdf' && <FileText className="w-8 h-8 text-red-400 shrink-0" />}
                        {msg.media.type === 'audio' && <Music className="w-8 h-8 text-amber-400 shrink-0" />}
                        {msg.media.type === 'video' && <Video className="w-8 h-8 text-purple-400 shrink-0" />}
                        {msg.media.type === 'file' && <Paperclip className="w-8 h-8 text-cyan-400 shrink-0" />}
                        <div className="min-w-0">
                          <p className="text-xs font-semibold truncate text-slate-200">{msg.media.name}</p>
                          <p className="text-[10px] text-slate-400 uppercase tracking-wider">{msg.media.type} {msg.media.size ? `• ${msg.media.size}` : ''}</p>
                        </div>
                      </div>
                    )}

                    {/* Formatted Text Content */}
                    <div className="whitespace-pre-wrap font-sans text-sm sm:text-[14px]">
                      {msg.text}
                    </div>

                    {/* Copy Response Footer */}
                    {!isUser && (
                      <div className="mt-3 pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-slate-400">
                        <span className="font-mono text-[10px] text-cyan-400/80">Model: {msg.modelUsed}</span>
                        <button
                          onClick={() => copyText(msg.id, msg.text)}
                          className="flex items-center gap-1 hover:text-cyan-300 transition-colors"
                        >
                          {copiedId === msg.id ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span className="text-emerald-400">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}

            {/* Live Loading Indicator */}
            {isLoading && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-3 p-3 rounded-2xl bg-slate-900/80 border border-cyan-500/20 max-w-sm text-cyan-300 text-xs font-mono"
              >
                <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                <span>Running <b>{currentModelObj.name}</b> inference...</span>
              </motion.div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* ── BOTTOM INPUT BOX WITH (+) MEDIA PICKER ── */}
          <div className="p-3 sm:p-4 border-t border-cyan-500/20 bg-slate-900/95 backdrop-blur-xl">
            {/* Attachment Staging Chip */}
            <AnimatePresence>
              {attachedMedia && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 5 }}
                  className="mb-2.5 p-2 rounded-xl bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {attachedMedia.type === 'image' && (
                      <img src={attachedMedia.previewUrl} alt="preview" className="w-8 h-8 rounded-lg object-cover border border-cyan-400/40" />
                    )}
                    {attachedMedia.type === 'pdf' && <FileText className="w-6 h-6 text-red-400 shrink-0" />}
                    {attachedMedia.type === 'audio' && <Music className="w-6 h-6 text-amber-400 shrink-0" />}
                    {attachedMedia.type === 'video' && <Video className="w-6 h-6 text-purple-400 shrink-0" />}
                    {attachedMedia.type === 'file' && <Paperclip className="w-6 h-6 text-cyan-400 shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-cyan-200 truncate">{attachedMedia.name}</p>
                      <p className="text-[10px] text-cyan-400/70 uppercase">Ready for multimodal analysis</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setAttachedMedia(null)}
                    className="p-1.5 rounded-lg hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Hidden File Input for (+) Button */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/*,application/pdf,audio/*,video/*,text/*,.doc,.docx,.csv,.json"
              className="hidden"
            />

            {/* Input Row */}
            <div className="flex items-end gap-2 sm:gap-3 bg-slate-950/80 rounded-2xl border border-cyan-500/30 p-2 shadow-[0_0_20px_rgba(6,182,212,0.1)] focus-within:border-cyan-400 focus-within:shadow-[0_0_30px_rgba(6,182,212,0.25)] transition-all">
              {/* Left (+) Button for Media/Files */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Attach Photo, PDF, File, Audio, Video"
                className="p-2.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:border-cyan-400 transition-all flex items-center justify-center shrink-0 group shadow-[0_0_10px_rgba(6,182,212,0.15)]"
              >
                <Plus className="w-5 h-5 transition-transform group-hover:rotate-90 duration-200" />
              </button>

              {/* Textarea Input */}
              <textarea
                ref={textareaRef}
                value={inputPrompt}
                onChange={(e) => setInputPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder={`Test ${currentModelObj.name} (Type prompt or attach PDF, photo, audio...)...`}
                rows={1}
                className="flex-1 bg-transparent text-slate-100 placeholder-slate-500 text-sm focus:outline-none resize-none max-h-32 py-2 px-1 custom-scrollbar leading-relaxed"
              />

              {/* Send Button */}
              <button
                type="button"
                onClick={handleSendMessage}
                disabled={isLoading || (!inputPrompt.trim() && !attachedMedia)}
                className={`p-2.5 rounded-xl flex items-center justify-center shrink-0 transition-all ${
                  isLoading || (!inputPrompt.trim() && !attachedMedia)
                    ? 'bg-slate-800/80 text-slate-500 cursor-not-allowed border border-white/5'
                    : 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white border border-cyan-400/50 shadow-[0_0_20px_rgba(6,182,212,0.4)]'
                }`}
              >
                <Send className="w-4 h-4" />
              </button>
            </div>

            {/* Footer Model Specs Info */}
            <div className="flex items-center justify-between px-2 pt-2 text-[10px] text-slate-500 font-mono">
              <span className="truncate">Active: <b>{currentModelObj.name}</b> ({currentModelObj.id})</span>
              <span className="hidden sm:inline text-cyan-400/80">Press Enter to Send • Shift+Enter for new line</span>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
