import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Mic, Plus, Loader2, Settings, ChevronDown, Captions, MessageSquare, Square } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import AgentFace from './AgentFace';
import ChatHistoryModal from './ChatHistoryModal';
import WhatsAppPairModal from './WhatsAppPairModal';
import { getWsUrl } from '@/utils/api';
import { wakeWordManager } from '@/utils/wakeWord';

interface LiveAIInterfaceProps {
    onClose: () => void;
}

const VOICES = ['Aoede', 'Charon', 'Fenrir', 'Kore', 'Puck'];
const THINKING_LEVELS = ['low', 'medium', 'high'];

function pcmToBase64(pcm: Float32Array): string {
    if (!pcm || pcm.length === 0) return "";
    const buffer = new Int16Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) {
        buffer[i] = Math.max(-1, Math.min(1, pcm[i])) * 32767;
    }
    const binary = new Uint8Array(buffer.buffer);
    let base64 = "";
    for (let i = 0; i < binary.length; i++) {
        base64 += String.fromCharCode(binary[i]);
    }
    return btoa(base64);
}

function createAudioContext(sampleRate?: number): AudioContext {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (sampleRate) {
        try {
            return new AudioCtx({ sampleRate });
        } catch (e) {
            console.warn(`AudioContext with sampleRate ${sampleRate} failed, falling back`, e);
        }
    }
    return new AudioCtx();
}

async function playAudioChunk(
    audioCtx: AudioContext,
    base64Audio: string,
    nextStartTime: { current: number },
    isAiSpeaking: { current: boolean },
    speakingCooldownUntilRef?: { current: number }
) {
    try {
        if (!base64Audio || !audioCtx || audioCtx.state === 'closed') return;
        const binary = atob(base64Audio);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const sampleCount = Math.floor(bytes.length / 2);
        if (sampleCount <= 0) return;

        const buffer = audioCtx.createBuffer(1, sampleCount, 24000);
        const channelData = buffer.getChannelData(0);
        for (let i = 0; i < sampleCount; i++) {
            const sample = (bytes[i * 2 + 1] << 8) | bytes[i * 2];
            channelData[i] = ((sample << 16) >> 16) / 32768;
        }

        const source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(audioCtx.destination);

        const startTime = Math.max(audioCtx.currentTime, nextStartTime.current);
        source.start(startTime);
        nextStartTime.current = startTime + buffer.duration;
        isAiSpeaking.current = true;

        source.onended = () => {
            if (audioCtx.currentTime >= nextStartTime.current - 0.08) {
                isAiSpeaking.current = false;
                if (speakingCooldownUntilRef) {
                    speakingCooldownUntilRef.current = Date.now() + 500; // 500ms safety cooldown to let speaker sound decay
                }
            }
        };
    } catch (e) {
        console.error("Error playing audio chunk:", e);
    }
}

export default function LiveAIInterface({ onClose }: LiveAIInterfaceProps) {
    const [isRecording, setIsRecording] = useState(false);
    const [status, setStatus] = useState("Idle");
    const statusRef = useRef("Idle");
    const [volume, setVolume] = useState(0);
    const [colorIndex, setColorIndex] = useState(0);
    const [selectedImages, setSelectedImages] = useState<{ id: string; file: File; status: 'uploading' | 'uploaded' }[]>([]);
    const [showSettings, setShowSettings] = useState(false);
    const [selectedVoice, setSelectedVoice] = useState(() => localStorage.getItem('selectedVoice') || 'Aoede');
    const [showVoiceDropdown, setShowVoiceDropdown] = useState(false);
    const [thinkingLevel, setThinkingLevel] = useState('low');
    const [accurateMode, setAccurateMode] = useState(false);
    const [answerLength, setAnswerLength] = useState(() => localStorage.getItem('answerLength') || 'short');
    const [googleSearchMode, setGoogleSearchMode] = useState(false);
    const [wakeWordActive, setWakeWordActive] = useState(() => localStorage.getItem('wakeWordActive') !== 'false');
    const [pairingCode, setPairingCode] = useState<string | null>(null);
    const [dueReminder, setDueReminder] = useState<{ title: string; timeString: string } | null>(null);
    const [whatsappNotif, setWhatsappNotif] = useState<{ sender: string; text: string; isGroup: boolean; groupName?: string | null } | null>(null);
    const whatsappNotifTimerRef = useRef<any>(null);
    const [inactivityCountdown, setInactivityCountdown] = useState<number | null>(null);
    const [showCaptions, setShowCaptions] = useState(true);
    const [captionText, setCaptionText] = useState('');
    const [showChatHistory, setShowChatHistory] = useState(false);
    const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const captionBoxRef = useRef<HTMLDivElement>(null);
    const userScrolledUpRef = useRef(false);
    const captionTurnStartedRef = useRef(false);

    const [isTyping, setIsTyping] = useState(false);
    const targetCaptionTextRef = useRef('');
    const displayedLengthRef = useRef(0);
    const typewriterTimeoutRef = useRef<any>(null);

    const resetTypewriter = useCallback(() => {
        if (typewriterTimeoutRef.current) {
            clearTimeout(typewriterTimeoutRef.current);
            typewriterTimeoutRef.current = null;
        }
        targetCaptionTextRef.current = '';
        displayedLengthRef.current = 0;
        setIsTyping(false);
        setCaptionText('');
    }, []);

    const scheduleNextTypewriterTick = useCallback(() => {
        if (typewriterTimeoutRef.current) return;
        const tick = () => {
            const target = targetCaptionTextRef.current;
            const currentLen = displayedLengthRef.current;
            if (currentLen < target.length) {
                const remaining = target.length - currentLen;
                const charsToAdvance = remaining > 50 ? 3 : remaining > 25 ? 2 : 1;
                const nextLen = Math.min(currentLen + charsToAdvance, target.length);
                displayedLengthRef.current = nextLen;
                const newText = target.slice(0, nextLen);
                setCaptionText(newText);
                setIsTyping(true);
                if (captionBoxRef.current && !userScrolledUpRef.current) {
                    captionBoxRef.current.scrollTop = captionBoxRef.current.scrollHeight;
                }
                const lastChar = newText[newText.length - 1];
                let delay = 18;
                if (['.', '!', '?', '\n'].includes(lastChar)) delay = 75;
                else if ([',', ';', ':'].includes(lastChar)) delay = 45;
                else if (lastChar === ' ') delay = 24;
                typewriterTimeoutRef.current = setTimeout(() => {
                    typewriterTimeoutRef.current = null;
                    tick();
                }, delay);
            } else {
                typewriterTimeoutRef.current = null;
                setIsTyping(false);
            }
        };
        tick();
    }, []);

    const enqueueTextChunk = useCallback((chunk: string, isNewTurn: boolean) => {
        if (isNewTurn) {
            if (typewriterTimeoutRef.current) {
                clearTimeout(typewriterTimeoutRef.current);
                typewriterTimeoutRef.current = null;
            }
            targetCaptionTextRef.current = chunk;
            displayedLengthRef.current = 0;
            setCaptionText('');
        } else {
            targetCaptionTextRef.current += chunk;
        }
        setIsTyping(true);
        scheduleNextTypewriterTick();
    }, [scheduleNextTypewriterTick]);

    useEffect(() => {
        localStorage.setItem('selectedVoice', selectedVoice);
        localStorage.setItem('thinkingLevel', thinkingLevel);
        localStorage.setItem('accurateMode', accurateMode.toString());
        localStorage.setItem('answerLength', answerLength);
        localStorage.setItem('googleSearchMode', googleSearchMode.toString());
    }, [selectedVoice, thinkingLevel, accurateMode, answerLength, googleSearchMode]);

    useEffect(() => {
        const box = captionBoxRef.current;
        if (!box) return;
        if (!userScrolledUpRef.current) box.scrollTop = box.scrollHeight;
    }, [captionText]);

    useEffect(() => {
        statusRef.current = status;
    }, [status]);

    useEffect(() => {
        const interval = setInterval(() => {
            const outCtx = outputAudioCtx.current;
            const audioDrained = !outCtx || outCtx.currentTime >= nextStartTime.current - 0.05;

            // Only let the turn actually end once turnComplete has arrived AND
            // every scheduled audio chunk has really finished playing. This
            // is checked here (not per-chunk in onended) so a brief gap
            // between two streamed TTS chunks never gets mistaken for the
            // turn being over.
            if (turnCompletePendingRef.current && audioDrained) {
                turnCompletePendingRef.current = false;
                aiTurnActiveRef.current = false;
                isAiSpeaking.current = false;
            }

            if (!aiTurnActiveRef.current && Date.now() > speakingCooldownUntilRef.current && status === "Speaking...") {
                setStatus("Listening...");
            }
        }, 200);
        return () => clearInterval(interval);
    }, [status]);

    useEffect(() => {
        if (!isRecording) return;
        const interval = setInterval(() => {
            if (inputAudioCtx.current && inputAudioCtx.current.state === 'suspended') {
                inputAudioCtx.current.resume();
            }
            // Mobile browsers often start a freshly-created AudioContext in
            // "suspended" state when the session was opened without a direct
            // tap (e.g. wake-word "Hello Friday" instead of pressing the mic
            // button). If outputAudioCtx stays suspended, the AI's audio is
            // still scheduled/generated but never actually plays — which
            // looks like "AI spoke but I heard nothing" / mistaken for a
            // network error. Keep retrying resume() until it takes.
            if (outputAudioCtx.current && outputAudioCtx.current.state === 'suspended') {
                outputAudioCtx.current.resume().catch(() => {});
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [isRecording]);

    // Reconnect on settings change if already recording
    useEffect(() => {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            isInitializedRef.current = false;
            ws.current.send(JSON.stringify({
                type: 'init',
                voice: selectedVoice,
                thinkingLevel,
                accurateMode,
                answerLength,
                googleSearchMode,
            }));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedVoice, thinkingLevel, accurateMode, answerLength, googleSearchMode]);

    const ws = useRef<WebSocket | null>(null);
    const inputAudioCtx = useRef<AudioContext | null>(null);
    const outputAudioCtx = useRef<AudioContext | null>(null);
    const processor = useRef<ScriptProcessorNode | null>(null);
    const nextStartTime = useRef<number>(0);
    const isAiSpeaking = useRef<boolean>(false);
    const isAiThinkingRef = useRef<boolean>(false);
    const isInitializedRef = useRef<boolean>(false);
    const initAckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const shouldCloseAfterTurnRef = useRef<boolean>(false);
    const lastActivityTimeRef = useRef<number>(Date.now());
    const isWarningSpokenRef = useRef<boolean>(false);
    const speakingCooldownUntilRef = useRef<number>(0);
    const hasSpokenInTurnRef = useRef<boolean>(false);
    // True for the ENTIRE duration of one AI turn (from the first "thinking"/
    // "speaking" event until turnComplete AND all buffered audio has actually
    // finished playing). Unlike isAiSpeaking (which briefly flips false in the
    // gap between two streamed TTS chunks), this never flickers mid-turn, so
    // it's the flag the mic hard-mute relies on to avoid re-opening the mic
    // between chunks and picking up stray audio.
    const aiTurnActiveRef = useRef<boolean>(false);
    // Set when turnComplete arrives; only actually clears aiTurnActiveRef once
    // the queued audio has finished playing (checked by the status interval).
    const turnCompletePendingRef = useRef<boolean>(false);
    // Prevents two overlapping ensureConnection() calls (e.g. wake-word firing
    // at the same moment as a manual mic tap) from both attaching a mic
    // pipeline, which was sending duplicate audio to Gemini and made spoken
    // numbers sound doubled/repeated.
    const isConnectingRef = useRef<boolean>(false);
    const pendingImagePayloadsRef = useRef<{ id: string; file: File; caption?: string }[]>([]);
    const selectedImagesRef = useRef(selectedImages);
    useEffect(() => { selectedImagesRef.current = selectedImages; }, [selectedImages]);

    const compressImageFile = (file: File, maxDim = 1280, quality = 0.8): Promise<{ base64: string; mimeType: string }> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    let width = img.width, height = img.height;
                    if (width > maxDim || height > maxDim) {
                        if (width > height) { height = Math.round((height * maxDim) / width); width = maxDim; }
                        else { width = Math.round((width * maxDim) / height); height = maxDim; }
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = width; canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        const rawBase64 = (e.target?.result as string).split(',')[1];
                        return resolve({ base64: rawBase64, mimeType: file.type || 'image/jpeg' });
                    }
                    ctx.drawImage(img, 0, 0, width, height);
                    const dataUrl = canvas.toDataURL('image/jpeg', quality);
                    resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
                };
                img.onerror = () => {
                    const rawBase64 = (e.target?.result as string).split(',')[1];
                    resolve({ base64: rawBase64, mimeType: file.type || 'image/jpeg' });
                };
                img.src = e.target?.result as string;
            };
            reader.onerror = (err) => reject(err);
            reader.readAsDataURL(file);
        });
    };

    const sendImageToWebSocket = async (image: { id: string; file: File; caption?: string }) => {
        if (ws.current && ws.current.readyState === WebSocket.OPEN && isInitializedRef.current) {
            try {
                const compressed = await compressImageFile(image.file);
                ws.current.send(JSON.stringify({
                    image: compressed.base64,
                    mimeType: compressed.mimeType,
                    imageId: image.id,
                    caption: image.caption || ''
                }));
            } catch (err) {
                console.error("Failed to compress/send image:", err);
            }
        } else {
            if (!pendingImagePayloadsRef.current.some(p => p.id === image.id)) {
                pendingImagePayloadsRef.current.push(image);
            }
            ensureConnection(false);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const files = Array.from(e.target.files);
            const newImages = files.map(file => ({
                id: Math.random().toString(36).substr(2, 9),
                file,
                status: 'uploading' as const
            }));
            setSelectedImages(prev => [...prev, ...newImages]);
            ensureConnection(false).then(() => {
                newImages.forEach(image => sendImageToWebSocket(image));
            });
            e.target.value = '';
        }
    };

    const handleRemoveImage = (id: string) => {
        setSelectedImages(prev => prev.filter(img => img.id !== id));
    };

    const stopAudio = () => {
        if (outputAudioCtx.current && outputAudioCtx.current.state !== 'closed') {
            try { outputAudioCtx.current.close(); } catch {}
            outputAudioCtx.current = createAudioContext(24000);
        }
    };

    const stopRecording = () => {
        if (initAckTimeoutRef.current) { clearTimeout(initAckTimeoutRef.current); initAckTimeoutRef.current = null; }
        ws.current?.close();
        processor.current?.disconnect();
        processor.current = null;
        if (inputAudioCtx.current && inputAudioCtx.current.state !== 'closed') inputAudioCtx.current.close();
        mediaStreamRef.current?.getTracks().forEach(t => t.stop());
        mediaStreamRef.current = null;
        stopAudio();
        aiTurnActiveRef.current = false;
        turnCompletePendingRef.current = false;
        isConnectingRef.current = false;
        setIsRecording(false);
        setStatus("Idle");
    };

    const handleInterrupt = () => {
        ws.current?.send(JSON.stringify({ interrupt: true }));
        stopAudio();
        resetTypewriter();
        aiTurnActiveRef.current = false;
        turnCompletePendingRef.current = false;
        setStatus("Listening...");
    };

    useEffect(() => {
        return () => { stopRecording(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!isRecording && wakeWordActive) {
            const unregister = wakeWordManager.register(() => {
                setStatus("Connecting AI...");
                ensureConnection(true);
            });
            return () => unregister();
        } else {
            wakeWordManager.stop();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isRecording, wakeWordActive]);

    // 75-second Inactivity Detection -> 15s warning -> Auto Shutdown (Paused during Thinking & Speaking)
    useEffect(() => {
        if (!isRecording) {
            setInactivityCountdown(null);
            isWarningSpokenRef.current = false;
            return;
        }

        lastActivityTimeRef.current = Date.now();
        isWarningSpokenRef.current = false;

        const interval = setInterval(() => {
            // NEVER count down when AI is Thinking, Speaking, or playing output audio!
            const isAudioStillPlaying = !!(outputAudioCtx.current && outputAudioCtx.current.currentTime < (nextStartTime.current - 0.05));
            const isAiBusy = aiTurnActiveRef.current || isAiSpeaking.current || isAiThinkingRef.current || statusRef.current === "Thinking..." || statusRef.current === "Speaking..." || isAudioStillPlaying;
            if (isAiBusy) {
                lastActivityTimeRef.current = Date.now();
                if (isWarningSpokenRef.current) {
                    isWarningSpokenRef.current = false;
                    setInactivityCountdown(null);
                }
                return;
            }

            const elapsed = Date.now() - lastActivityTimeRef.current;

            if (elapsed >= 75000 && !isWarningSpokenRef.current) {
                isWarningSpokenRef.current = true;
                setInactivityCountdown(15);
            } else if (isWarningSpokenRef.current) {
                const remaining = Math.max(0, 90 - Math.floor(elapsed / 1000));
                setInactivityCountdown(remaining);

                if (remaining <= 0) {
                    clearInterval(interval);
                    isWarningSpokenRef.current = false;
                    setInactivityCountdown(null);
                    stopRecording();
                    setStatus("Session band ho gaya. Say 'Hello Friday' to wake.");
                }
            }
        }, 1000);

        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isRecording]);

    /**
     * Wires up a MediaStream to the input AudioContext + ScriptProcessor and
     * attaches the shared onaudioprocess handler (RMS voice detection, hard
     * mute while AI is busy, 900ms voice-gate hangover). Used by both the
     * "already connected, just attach mic" path and the "fresh WebSocket
     * connect" path in ensureConnection, so the mic-gating logic only lives
     * in one place.
     */
    const attachMicPipeline = async (stream: MediaStream) => {
        // Safety: if a previous input pipeline is still attached (e.g. from a
        // race between wake-word trigger and a manual mic tap), tear it down
        // fully first. Two live processors both sending mic audio to the same
        // WebSocket is what made Gemini "hear" everything twice — including
        // spoken numbers coming back doubled/repeated.
        if (processor.current) {
            try { processor.current.onaudioprocess = null; processor.current.disconnect(); } catch {}
            processor.current = null;
        }
        if (inputAudioCtx.current && inputAudioCtx.current.state !== 'closed') {
            try { await inputAudioCtx.current.close(); } catch {}
        }

        inputAudioCtx.current = createAudioContext(16000);
        outputAudioCtx.current = createAudioContext(24000);
        try {
            await inputAudioCtx.current.resume();
            await outputAudioCtx.current.resume();
        } catch (e) {
            console.error("Failed to resume AudioContext:", e);
        }

        const source = inputAudioCtx.current.createMediaStreamSource(stream);
        processor.current = inputAudioCtx.current.createScriptProcessor(4096, 1, 1);
        source.connect(processor.current);
        processor.current.connect(inputAudioCtx.current.destination);
        processor.current.onaudioprocess = (e) => {
            // 1. HARD MUTE: While AI is Thinking, Speaking, output buffer is playing, or cooling down -> Mic is 100% OFF
            const isAudioStillPlaying = !!(outputAudioCtx.current && outputAudioCtx.current.currentTime < (nextStartTime.current - 0.05));
            const isAiBusy = aiTurnActiveRef.current || isAiSpeaking.current || isAiThinkingRef.current || statusRef.current === "Thinking..." || statusRef.current === "Speaking..." || isAudioStillPlaying;
            if (isAiBusy || Date.now() < speakingCooldownUntilRef.current || !isInitializedRef.current) {
                setVolume(0);
                return;
            }

            const pcm = e.inputBuffer.getChannelData(0);

            // 2. Calculate true RMS sound power (only used for the UI volume
            // meter now — no longer used to decide whether to send audio).
            let sumSquares = 0;
            for (let i = 0; i < pcm.length; i++) {
                sumSquares += pcm[i] * pcm[i];
            }
            const rms = Math.sqrt(sumSquares / pcm.length) * 1000;
            const isHumanSpeaking = rms >= 10;
            if (isHumanSpeaking) {
                lastActivityTimeRef.current = Date.now();
                if (isWarningSpokenRef.current) {
                    isWarningSpokenRef.current = false;
                    setInactivityCountdown(null);
                }
            }

            // 3. Always forward audio to Gemini, loud or quiet — no custom
            // noise gate, no manual "user stopped talking" guessing on our
            // end. Gemini's own server-side automatic VAD is built exactly
            // for this: it needs a continuous, uninterrupted audio stream
            // (including the quiet parts) to reliably detect real speech
            // pauses and end turns on its own — the same way it works in
            // apps that don't do any custom client-side gating. Cutting the
            // stream ourselves (old behavior) is what caused both earlier
            // bugs: replies stuck on "Listening..." and sentences getting
            // chopped into fragments.
            ws.current?.send(JSON.stringify({ audio: pcmToBase64(pcm) }));
            setVolume(Math.min(100, rms * 2.2));
        };
    };

    const requestMicStream = async (): Promise<MediaStream> => {
        return navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1,
            },
        });
    };

    const ensureConnection = async (withMic: boolean) => {
        // If a connection/mic-attach is already in flight (e.g. wake-word
        // detection fired at the same moment as a manual mic tap), skip this
        // call entirely instead of racing it — that race was the source of
        // two ScriptProcessors both streaming mic audio at once.
        if (withMic && isConnectingRef.current) return;

        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            if (withMic && !isRecording) {
                isConnectingRef.current = true;
                setStatus("Requesting Microphone...");
                try {
                    const stream = await requestMicStream();
                    setIsRecording(true);
                    setStatus("Listening...");
                    mediaStreamRef.current = stream;
                    await attachMicPipeline(stream);
                } catch (err) {
                    console.error("Error accessing audio", err);
                    setStatus("Error: Mic Access Failed");
                } finally {
                    isConnectingRef.current = false;
                }
            }
            return;
        }

        if (withMic) isConnectingRef.current = true;
        setStatus("Connecting...");
        let stream: MediaStream | undefined;
        if (withMic) {
            setStatus("Requesting Microphone...");
            try {
                stream = await requestMicStream();
                setStatus("Connecting...");
            } catch (err) {
                console.error("Error accessing audio", err);
                setStatus("Error: Mic Access Failed");
                isConnectingRef.current = false;
                return;
            }
        }

        const socket = new WebSocket(getWsUrl());
        ws.current = socket;

        socket.onopen = async () => {
            setIsRecording(withMic);
            setStatus(withMic ? "Connecting AI..." : "Connected");
            nextStartTime.current = 0;
            isInitializedRef.current = false;
            socket.send(JSON.stringify({
                type: 'init',
                voice: selectedVoice,
                thinkingLevel,
                accurateMode,
                answerLength,
                googleSearchMode,
            }));

            const initAckTimeout = setTimeout(() => {
                if (!isInitializedRef.current) setStatus("Starting up, please wait...");
            }, 6000);
            initAckTimeoutRef.current = initAckTimeout;

            const imageMessages = selectedImagesRef.current.filter(img => img.status === 'uploading');
            imageMessages.forEach(image => sendImageToWebSocket(image));

            if (withMic && stream) {
                mediaStreamRef.current = stream;
                await attachMicPipeline(stream);
            }
            isConnectingRef.current = false;
        };

        socket.onmessage = (event) => {
            try {
                if (typeof event.data !== 'string') return;
                const msg = JSON.parse(event.data);
                if (msg.audio) {
                    if (outputAudioCtx.current) {
                        aiTurnActiveRef.current = true;
                        turnCompletePendingRef.current = false;
                        setStatus("Speaking...");
                        playAudioChunk(outputAudioCtx.current, msg.audio, nextStartTime, isAiSpeaking, speakingCooldownUntilRef);
                    }
                } else if (msg.type === 'thinking') {
                    aiTurnActiveRef.current = true;
                    turnCompletePendingRef.current = false;
                    isAiThinkingRef.current = true;
                    setStatus("Thinking...");
                    // Bug Fix 2: Safety escape — if AI is stuck in thinking for >30s,
                    // force-clear it so the mic is not permanently muted.
                    clearTimeout((window as any).__thinkingTimeout);
                    (window as any).__thinkingTimeout = setTimeout(() => {
                        if (isAiThinkingRef.current) {
                            console.warn('[Friday] Thinking timeout — forcing Listening state');
                            isAiThinkingRef.current = false;
                            aiTurnActiveRef.current = false;
                            turnCompletePendingRef.current = false;
                            setStatus('Listening...');
                        }
                    }, 30000);
                } else if (msg.type === 'speaking') {
                    // AI has audio coming — clear thinking flag immediately
                    aiTurnActiveRef.current = true;
                    turnCompletePendingRef.current = false;
                    isAiThinkingRef.current = false;
                    clearTimeout((window as any).__thinkingTimeout);
                } else if (msg.text) {
                    if (!captionTurnStartedRef.current) {
                        captionTurnStartedRef.current = true;
                        enqueueTextChunk(msg.text, true);
                    } else {
                        enqueueTextChunk(msg.text, false);
                    }

                    if (/(chup ho rahi hoon|chup ho jata|session band|alvida|standby par ja rahi|bye dk|main chup ho)/i.test(msg.text)) {
                        shouldCloseAfterTurnRef.current = true;
                    }
                } else if (msg.turnComplete) {
                    captionTurnStartedRef.current = false;
                    isAiThinkingRef.current = false;
                    // Don't drop aiTurnActiveRef here — text/turnComplete can
                    // arrive before the trailing audio chunks finish playing.
                    // The status-polling interval clears it once currentTime
                    // actually catches up to nextStartTime.
                    turnCompletePendingRef.current = true;
                    if (shouldCloseAfterTurnRef.current) {
                        shouldCloseAfterTurnRef.current = false;
                        const delay = Math.max(1200, ((nextStartTime.current - (outputAudioCtx.current?.currentTime || 0)) * 1000) + 600);
                        setTimeout(() => {
                            stopRecording();
                            setStatus("Session band ho gaya. Say 'Hello Friday' to wake.");
                        }, delay);
                    }
                } else if (msg.type === 'init_ack') {
                    isInitializedRef.current = true;
                    isAiThinkingRef.current = false;
                    // Safety: a fresh session (including a settings-change
                    // reconnect mid-turn) means any previous turn's context is
                    // dead. If it never sent turnComplete/interrupted, clear
                    // the flag here so the mic can't stay muted forever.
                    aiTurnActiveRef.current = false;
                    turnCompletePendingRef.current = false;
                    if (initAckTimeoutRef.current) { clearTimeout(initAckTimeoutRef.current); initAckTimeoutRef.current = null; }
                    setStatus("Listening...");
                    if (pendingImagePayloadsRef.current.length > 0) {
                        const queued = [...pendingImagePayloadsRef.current];
                        pendingImagePayloadsRef.current = [];
                        queued.forEach(img => sendImageToWebSocket(img));
                    }
                } else if (msg.interrupted) {
                    isAiSpeaking.current = false;
                    isAiThinkingRef.current = false;
                    aiTurnActiveRef.current = false;
                    turnCompletePendingRef.current = false;
                    nextStartTime.current = outputAudioCtx.current?.currentTime || 0;
                    resetTypewriter();
                    setStatus("Listening...");
                } else if (msg.error === "session_init_failed") {
                    aiTurnActiveRef.current = false;
                    turnCompletePendingRef.current = false;
                    setStatus("Error: AI session failed to start");
                } else if (msg.imageAck) {
                    setSelectedImages(prev => prev.map(img => img.id === msg.imageId ? { ...img, status: 'uploaded' } : img));
                    if (status !== "Speaking...") isAiSpeaking.current = false;
                } else if (msg.type === 'pairing_code_ready' && msg.pairingCode) {
                    setPairingCode(msg.pairingCode);
                } else if (msg.type === 'reminder_due' && msg.reminder) {
                    setDueReminder({ title: msg.reminder.title, timeString: msg.reminder.timeString });
                    // Auto-dismiss the banner after 15s so it doesn't linger forever
                    // if the user doesn't interact with it.
                    setTimeout(() => setDueReminder(null), 15000);
                } else if (msg.type === 'whatsapp_incoming') {
                    setWhatsappNotif({
                        sender: msg.sender || 'Unknown',
                        text: msg.text || '',
                        isGroup: !!msg.isGroup,
                        groupName: msg.groupName,
                    });
                    // Auto-dismiss personal messages after 12s, group after 8s
                    clearTimeout(whatsappNotifTimerRef.current);
                    whatsappNotifTimerRef.current = setTimeout(
                        () => setWhatsappNotif(null),
                        msg.isGroup ? 8000 : 12000
                    );
                }
            } catch (err) {
                console.warn("[LiveAIInterface] Error processing socket message:", err);
            }
        };

        socket.onclose = () => {
            isInitializedRef.current = false;
            isConnectingRef.current = false;
            setIsRecording(false);
            setStatus("Idle");
            stream?.getTracks().forEach(track => track.stop());
        };

        socket.onerror = (error) => {
            console.error("WebSocket error", error);
            isConnectingRef.current = false;
            setStatus("Error: Connection Failed");
            stream?.getTracks().forEach(track => track.stop());
        };
    };

    const handleToggleRecording = async () => {
        if (isRecording) stopRecording();
        else await ensureConnection(true);
    };

    const handleClose = () => {
        if (isRecording) stopRecording();
        onClose();
    };

    return (
        <div
            className="fixed inset-0 z-[1000] bg-gradient-to-b from-[#0a0f24] via-[#0a0f24] via-60% to-black text-white flex flex-col items-center pt-[env(safe-area-inset-top,0px)] px-6 pb-[max(env(safe-area-inset-bottom,0px),12px)] overflow-hidden"
        >
            <div className="w-full h-full flex flex-col flex-1 overflow-hidden">
                <div className="w-full flex justify-between items-center mb-6 pt-4">
                    <h1 className="text-lg font-bold flex items-center gap-2">AI <span className="text-blue-400">Live Agent</span></h1>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setShowWhatsAppModal(true)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/50 text-emerald-300 text-xs font-semibold shadow-[0_0_15px_rgba(16,185,129,0.25)] transition-all cursor-pointer hover:scale-105 active:scale-95"
                            title="WhatsApp Link Assistant"
                        >
                            <span>📲</span>
                            <span>Link WhatsApp</span>
                        </button>
                        <button onClick={() => setShowCaptions(!showCaptions)} className={showCaptions ? 'text-green-500' : 'text-white'}>
                            <Captions className="h-6 w-6" />
                        </button>
                        <button onClick={() => setShowChatHistory(true)} className="text-white">
                            <MessageSquare className="h-6 w-6" />
                        </button>
                        <button onClick={() => setShowSettings(!showSettings)} className="text-white">
                            <Settings className="h-6 w-6" />
                        </button>
                        <button onClick={handleClose} className="text-white">
                            <X className="h-6 w-6" />
                        </button>
                    </div>
                </div>

                <AnimatePresence>
                    {dueReminder && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="w-full mb-4 flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-amber-500/15 border border-amber-500/40 shadow-[0_0_20px_rgba(245,158,11,0.2)]"
                        >
                            <div className="flex items-center gap-2 min-w-0">
                                <span>⏰</span>
                                <span className="text-amber-200 text-sm font-medium truncate">{dueReminder.title}</span>
                            </div>
                            <button onClick={() => setDueReminder(null)} className="text-amber-300/70 hover:text-amber-200 shrink-0">
                                <X className="h-4 w-4" />
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>

                <AnimatePresence>
                    {whatsappNotif && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className={`w-full mb-4 flex items-center justify-between gap-3 px-4 py-3 rounded-2xl ${
                                whatsappNotif.isGroup
                                    ? 'bg-blue-500/15 border border-blue-500/40 shadow-[0_0_20px_rgba(59,130,246,0.2)]'
                                    : 'bg-emerald-500/15 border border-emerald-500/40 shadow-[0_0_20px_rgba(16,185,129,0.2)]'
                            }`}
                        >
                            <div className="flex items-center gap-2 min-w-0">
                                <span>{whatsappNotif.isGroup ? '👥' : '💬'}</span>
                                <div className="min-w-0">
                                    <p className={`text-xs font-bold ${
                                        whatsappNotif.isGroup ? 'text-blue-300' : 'text-emerald-300'
                                    }`}>
                                        {whatsappNotif.isGroup
                                            ? `${whatsappNotif.sender} (${whatsappNotif.groupName || 'Group'})`
                                            : whatsappNotif.sender}
                                    </p>
                                    <p className="text-slate-200 text-xs truncate max-w-[220px]">{whatsappNotif.text}</p>
                                </div>
                            </div>
                            <button onClick={() => setWhatsappNotif(null)} className="text-slate-400 hover:text-white shrink-0">
                                <X className="h-4 w-4" />
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>

                <div className="flex-1 flex flex-col items-center justify-center gap-8 overflow-hidden">
                    <AgentFace status={status} volume={volume} size={160} colorIndex={colorIndex} />
                    <p className="text-slate-300 text-sm font-medium">{status}</p>

                    {!isRecording && wakeWordActive && (
                        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-xs text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.15)] animate-pulse">
                            <span className="w-2 h-2 rounded-full bg-cyan-400" />
                            <span>Say <b>"Hello Friday"</b> to start session</span>
                        </div>
                    )}

                    <AnimatePresence>
                        {pairingCode && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                                className="w-full max-w-sm p-4 rounded-3xl bg-emerald-950/90 border border-emerald-500/50 shadow-[0_0_35px_rgba(16,185,129,0.35)] backdrop-blur-xl text-center flex flex-col items-center gap-2"
                            >
                                <span className="text-emerald-400 font-bold text-sm">📲 WhatsApp Pairing Code</span>
                                <span className="text-slate-300 text-xs">WhatsApp &gt; Linked Devices &gt; Link with phone number:</span>
                                <div className="px-4 py-2 rounded-2xl bg-black/60 border border-emerald-400/60 text-emerald-300 font-mono font-black text-2xl tracking-widest select-all">
                                    {pairingCode}
                                </div>
                                <div className="flex gap-2 w-full mt-1">
                                    <button
                                        onClick={() => {
                                            navigator.clipboard.writeText(pairingCode);
                                            alert("Pairing code copied!");
                                        }}
                                        className="flex-1 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition-colors"
                                    >
                                        Copy Code
                                    </button>
                                    <button
                                        onClick={() => setPairingCode(null)}
                                        className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                                    >
                                        Dismiss
                                    </button>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <AnimatePresence>
                        {isRecording && inactivityCountdown !== null && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.9, y: -10 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.9, y: -10 }}
                                className="flex items-center gap-3 px-4 py-2 rounded-2xl bg-amber-500/20 border border-amber-500/60 text-amber-300 text-xs shadow-[0_0_25px_rgba(245,158,11,0.3)] backdrop-blur-md animate-bounce"
                            >
                                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
                                <span><b>DK</b>, main <b>{inactivityCountdown}s</b> mein band ho jaungi! Kuch poochna hai?</span>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {showCaptions && captionText && (
                        <div
                            ref={captionBoxRef}
                            onScroll={() => {
                                const box = captionBoxRef.current;
                                if (!box) return;
                                userScrolledUpRef.current = box.scrollTop + box.clientHeight < box.scrollHeight - 20;
                            }}
                            className="w-full max-h-40 overflow-y-auto bg-slate-950/60 border border-purple-500/20 rounded-2xl p-4 text-sm text-slate-100 leading-relaxed"
                        >
                            {captionText}
                        </div>
                    )}

                    {selectedImages.length > 0 && (
                        <div className="flex gap-2 flex-wrap justify-center">
                            {selectedImages.map(img => (
                                <div key={img.id} className="relative">
                                    <img
                                        src={URL.createObjectURL(img.file)}
                                        className={`w-16 h-16 object-cover rounded-lg border ${img.status === 'uploaded' ? 'border-green-500' : 'border-slate-600 opacity-60'}`}
                                    />
                                    <button
                                        onClick={() => handleRemoveImage(img.id)}
                                        className="absolute -top-1 -right-1 bg-red-600 rounded-full w-5 h-5 flex items-center justify-center text-xs"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-center gap-4 w-full pb-6">
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="p-3 rounded-full bg-slate-800/80 border border-slate-600 text-white hover:bg-slate-700 transition-colors"
                        title="Upload Image"
                    >
                        <Plus className="w-5 h-5" />
                    </button>
                    <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />

                    <button
                        onClick={handleToggleRecording}
                        className={`p-5 rounded-full text-white shadow-lg transition-all ${isRecording ? 'bg-red-600 shadow-red-500/40 hover:bg-red-500' : 'gradient-btn-primary shadow-purple-500/40 hover:scale-105'}`}
                        title={isRecording ? "Stop Session" : "Start Session"}
                    >
                        {isRecording ? <Square className="w-7 h-7" /> : <Mic className="w-7 h-7" />}
                    </button>

                    {isRecording && (
                        <button
                            onClick={() => {
                                if (ws.current && ws.current.readyState === WebSocket.OPEN) {
                                    setStatus("Thinking...");
                                    ws.current.send(JSON.stringify({ type: 'trigger_reply' }));
                                }
                            }}
                            className="px-4 py-3 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white font-bold text-xs shadow-[0_0_20px_rgba(245,158,11,0.4)] transition-all flex items-center gap-1.5 active:scale-95 animate-pulse cursor-pointer"
                            title="Friday ko turant bolne ke liye kahein"
                        >
                            <span>⚡</span>
                            <span>Jawab Do</span>
                        </button>
                    )}


                    <button
                        onClick={handleInterrupt}
                        disabled={!isRecording}
                        className="p-3 rounded-full bg-slate-800/80 border border-slate-600 text-white disabled:opacity-30 hover:bg-slate-700 transition-colors"
                        title="Interrupt AI"
                    >
                        <Loader2 className="w-5 h-5" />
                    </button>
                </div>
            </div>

            <AnimatePresence>
                {showSettings && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                        className="absolute bottom-0 left-0 right-0 z-[2500] bg-[#0d1330] border-t border-purple-500/30 rounded-t-3xl p-6 max-h-[70vh] overflow-y-auto"
                    >
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-white font-bold text-lg">Settings</h3>
                            <button onClick={() => setShowSettings(false)}><X className="w-5 h-5 text-slate-400" /></button>
                        </div>

                        <div className="space-y-5">
                            <div>
                                <label className="text-slate-400 text-xs uppercase tracking-wide">Voice</label>
                                <div className="relative mt-1">
                                    <button
                                        onClick={() => setShowVoiceDropdown(!showVoiceDropdown)}
                                        className="w-full flex items-center justify-between bg-slate-800/60 border border-slate-600 rounded-xl px-4 py-3 text-white"
                                    >
                                        {selectedVoice} <ChevronDown className="w-4 h-4" />
                                    </button>
                                    {showVoiceDropdown && (
                                        <div className="absolute top-full mt-1 w-full bg-slate-800 border border-slate-600 rounded-xl overflow-hidden z-10">
                                            {VOICES.map(v => (
                                                <button
                                                    key={v}
                                                    onClick={() => { setSelectedVoice(v); setShowVoiceDropdown(false); }}
                                                    className={`w-full text-left px-4 py-2 hover:bg-slate-700 ${v === selectedVoice ? 'text-purple-400' : 'text-white'}`}
                                                >
                                                    {v}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div>
                                <label className="text-slate-400 text-xs uppercase tracking-wide">Thinking Level</label>
                                <div className="flex gap-2 mt-1">
                                    {THINKING_LEVELS.map(level => (
                                        <button
                                            key={level}
                                            onClick={() => setThinkingLevel(level)}
                                            className={`flex-1 py-2 rounded-xl border capitalize ${thinkingLevel === level ? 'bg-purple-600 border-purple-500 text-white' : 'bg-slate-800/60 border-slate-600 text-slate-300'}`}
                                        >
                                            {level}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="text-slate-400 text-xs uppercase tracking-wide">Answer Length</label>
                                <div className="flex gap-2 mt-1">
                                    {['short', 'detailed'].map(len => (
                                        <button
                                            key={len}
                                            onClick={() => setAnswerLength(len)}
                                            className={`flex-1 py-2 rounded-xl border capitalize ${answerLength === len ? 'bg-purple-600 border-purple-500 text-white' : 'bg-slate-800/60 border-slate-600 text-slate-300'}`}
                                        >
                                            {len}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="flex items-center justify-between">
                                <span className="text-white text-sm">Careful / Accurate Mode</span>
                                <button
                                    onClick={() => setAccurateMode(!accurateMode)}
                                    className={`w-12 h-7 rounded-full transition-colors relative ${accurateMode ? 'bg-purple-600' : 'bg-slate-700'}`}
                                >
                                    <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-transform ${accurateMode ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                            </div>

                            <div className="flex items-center justify-between">
                                <span className="text-white text-sm">Google Search Mode</span>
                                <button
                                    onClick={() => setGoogleSearchMode(!googleSearchMode)}
                                    className={`w-12 h-7 rounded-full transition-colors relative ${googleSearchMode ? 'bg-purple-600' : 'bg-slate-700'}`}
                                >
                                    <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-transform ${googleSearchMode ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                            </div>

                            <div className="flex items-center justify-between">
                                <div>
                                    <span className="text-white text-sm block">Wake Word ("Hello Friday")</span>
                                    <span className="text-slate-400 text-xs">Say "Hello Friday" anytime to start</span>
                                </div>
                                <button
                                    onClick={() => {
                                        const next = !wakeWordActive;
                                        setWakeWordActive(next);
                                        localStorage.setItem('wakeWordActive', String(next));
                                    }}
                                    className={`w-12 h-7 rounded-full transition-colors relative ${wakeWordActive ? 'bg-cyan-500' : 'bg-slate-700'}`}
                                >
                                    <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-transform ${wakeWordActive ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {showChatHistory && <ChatHistoryModal onClose={() => setShowChatHistory(false)} />}
            <WhatsAppPairModal isOpen={showWhatsAppModal} onClose={() => setShowWhatsAppModal(false)} />
        </div>
    );
}
