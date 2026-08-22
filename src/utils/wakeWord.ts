// Wake Word Listener for "Hello Friday"

export interface WakeWordConfig {
    onWake: () => void;
    enabled?: boolean;
}

export function speakWakeAck(callback?: () => void) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance("Yes DK, main sun raha hoon");
        utterance.rate = 1.05;
        utterance.pitch = 1.0;
        utterance.lang = 'hi-IN';
        
        // Try to pick a female Hindi or warm English/Hindi voice if available
        const voices = window.speechSynthesis.getVoices();
        const hiVoice = voices.find(v => v.lang.includes('hi') || v.name.includes('Hindi') || v.name.includes('India'));
        if (hiVoice) {
            utterance.voice = hiVoice;
        }

        utterance.onend = () => {
            if (callback) callback();
        };
        utterance.onerror = () => {
            if (callback) callback();
        };

        window.speechSynthesis.speak(utterance);
    } else {
        if (callback) callback();
    }
}

class WakeWordManager {
    private recognition: any = null;
    private isRunning = false;
    private callbacks: Set<() => void> = new Set();
    private enabled = true;

    constructor() {
        this.initRecognition();
    }

    private initRecognition() {
        const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRec) {
            console.warn("SpeechRecognition not supported in this browser.");
            return;
        }

        try {
            this.recognition = new SpeechRec();
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.lang = 'en-US';

            this.recognition.onresult = (event: any) => {
                const current = event.resultIndex;
                const transcript = event.results[current][0].transcript.toLowerCase().trim();
                console.log("[WakeWord] Heard:", transcript);

                // Match "hello friday", "hey friday", "friday", "ok friday"
                if (
                    transcript.includes("hello friday") ||
                    transcript.includes("hey friday") ||
                    transcript.includes("hi friday") ||
                    transcript.includes("friday") ||
                    transcript.includes("he friday")
                ) {
                    console.log("[WakeWord] Triggered by:", transcript);
                    this.trigger();
                }
            };

            this.recognition.onerror = (event: any) => {
                if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                    console.warn("[WakeWord] Permission denied:", event.error);
                    this.isRunning = false;
                }
            };

            this.recognition.onend = () => {
                this.isRunning = false;
                // Auto restart if still enabled
                if (this.enabled && this.callbacks.size > 0) {
                    setTimeout(() => this.start(), 300);
                }
            };
        } catch (e) {
            console.error("[WakeWord] Init error:", e);
        }
    }

    public start() {
        if (!this.enabled || this.isRunning || !this.recognition) return;
        try {
            this.recognition.start();
            this.isRunning = true;
            console.log("[WakeWord] Listening for 'Hello Friday'...");
        } catch (e) {
            // Already started or busy
        }
    }

    public stop() {
        if (!this.recognition || !this.isRunning) return;
        try {
            this.recognition.stop();
            this.isRunning = false;
        } catch (e) {}
    }

    public register(callback: () => void) {
        this.callbacks.add(callback);
        if (this.enabled) this.start();

        return () => {
            this.callbacks.delete(callback);
            if (this.callbacks.size === 0) this.stop();
        };
    }

    public trigger() {
        this.stop();
        speakWakeAck(() => {
            this.callbacks.forEach(cb => cb());
        });
    }

    public setEnabled(enabled: boolean) {
        this.enabled = enabled;
        if (!enabled) {
            this.stop();
        } else if (this.callbacks.size > 0) {
            this.start();
        }
    }

    public isListening() {
        return this.isRunning;
    }
}

export const wakeWordManager = new WakeWordManager();
