import { useState, useRef, useCallback } from 'react';
import { toast } from 'sonner';

interface UseVoiceProps {
    language: string;
    ruralMode: boolean;
    onTranscriptComplete: (text: string) => void;
}

export function useVoice({ language, ruralMode, onTranscriptComplete }: UseVoiceProps) {
    const [isListening, setIsListening] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const synthRef = useRef<SpeechSynthesis>(window.speechSynthesis);

    // Set language mapping for both recognition and synthesis
    const langMap: Record<string, string> = {
        English: "en-IN",
        Hindi: "hi-IN",
        Punjabi: "pa-IN",
        Marathi: "mr-IN",
        Gujarati: "gu-IN",
        Bengali: "bn-IN",
        Tamil: "ta-IN",
        Telugu: "te-IN",
        Kannada: "kn-IN",
        Malayalam: "ml-IN",
    };

    const currentLangCode = langMap[language] || "hi-IN";

    // --- Recognition (Listening) ---
    const startListening = useCallback(() => {
        const win = window as unknown as Window;
        if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
            toast.error("Your browser does not support voice input.");
            return;
        }

        const SpeechRecognitionClass = win.SpeechRecognition || win.webkitSpeechRecognition;
        recognitionRef.current = new SpeechRecognitionClass();

        recognitionRef.current.lang = currentLangCode;
        recognitionRef.current.continuous = false;
        recognitionRef.current.interimResults = false; // We only want final results here for simplicity

        recognitionRef.current.onstart = () => {
            setIsListening(true);
            // Stop speaking if starting to listen
            stopSpeaking();
        };

        recognitionRef.current.onend = () => {
            setIsListening(false);
        };

        recognitionRef.current.onresult = (event: SpeechRecognitionEvent) => {
            // We only take the final transcript
            const last = event.results.length - 1;
            const transcript = event.results[last][0].transcript;
            if (transcript.trim()) {
                onTranscriptComplete(transcript);
            }
        };

        recognitionRef.current.onerror = (event: SpeechRecognitionErrorEvent) => {
            console.error("Speech recognition error:", event.error);
            setIsListening(false);
            if (event.error === "not-allowed") {
                toast.error("Please allow microphone access.");
            }
        };

        try {
            recognitionRef.current.start();
        } catch (e) {
            console.error("Error starting recognition", e);
            setIsListening(false);
        }
    }, [currentLangCode, onTranscriptComplete]);

    const stopListening = useCallback(() => {
        if (recognitionRef.current) {
            recognitionRef.current.stop();
        }
        setIsListening(false);
    }, []);

    const stopSpeaking = useCallback(() => {
        if (synthRef.current) {
            synthRef.current.cancel();
        }
        setIsSpeaking(false);
    }, []);

    // --- Synthesis (Speaking) ---
    const speak = useCallback((text: string) => {
        if (!synthRef.current) return;

        // Stop previous utterance
        stopSpeaking();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = currentLangCode;

        // Try to find a voice that matches the language
        const voices = synthRef.current.getVoices();
        const langPrefix = currentLangCode.split('-')[0];

        let selectedVoice = voices.find(v => v.lang === currentLangCode);
        // Fallback to searching by just the language prefix (e.g., 'hi' instead of 'hi-IN')
        if (!selectedVoice) {
            selectedVoice = voices.find(v => v.lang.startsWith(langPrefix));
        }

        if (selectedVoice) {
            utterance.voice = selectedVoice;
        }

        // Adjust speech rate based on rural mode
        // Normal: 1.0, Rural (slower/simpler): 0.85
        utterance.rate = ruralMode ? 0.85 : 1.0;

        // Optionally set pitch or volume
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        utterance.onstart = () => setIsSpeaking(true);
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = (e) => {
            console.error("Speech synthesis error", e);
            setIsSpeaking(false);
        };

        // Handle bug in some browsers where synthesis gets stuck
        let resumeInfinity: any;
        const resumeHack = () => {
            if (setIsSpeaking) {
                synthRef.current?.resume();
                resumeInfinity = setTimeout(resumeHack, 1000);
            }
        };
        utterance.onstart = () => {
            setIsSpeaking(true);
            resumeInfinity = setTimeout(resumeHack, 1000);
        };
        utterance.onend = () => {
            setIsSpeaking(false);
            clearTimeout(resumeInfinity);
        };

        synthRef.current.speak(utterance);
    }, [currentLangCode, ruralMode, stopSpeaking]);

    return {
        isListening,
        isSpeaking,
        startListening,
        stopListening,
        speak,
        stopSpeaking
    };
}
