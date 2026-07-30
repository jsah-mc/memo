import type { SpeechSynthesisAdapter } from "@assistant-ui/react";

const MIME_TYPE = "audio/wav";
const MAX_SEGMENT_CHARACTERS = 220;

const decodeBase64 = (value: string) => {
  const binary = atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return buffer;
};

const splitSpeechText = (value: string) => {
  const sentences =
    value.trim().replace(/\s+/g, " ").match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [];
  const pieces: string[] = [];

  for (const sentence of sentences.map((part) => part.trim()).filter(Boolean)) {
    let remaining = sentence;
    while (remaining.length > MAX_SEGMENT_CHARACTERS) {
      const candidate = remaining.slice(0, MAX_SEGMENT_CHARACTERS + 1);
      const boundary = candidate.lastIndexOf(" ");
      const splitAt = boundary > 40 ? boundary : MAX_SEGMENT_CHARACTERS;
      pieces.push(remaining.slice(0, splitAt).trim());
      remaining = remaining.slice(splitAt).trim();
    }
    if (remaining) pieces.push(remaining);
  }

  return pieces;
};

class GatewaySpeechAdapter implements SpeechSynthesisAdapter {
  speak(text: string): SpeechSynthesisAdapter.Utterance {
    const listeners = new Set<() => void>();
    const segments = splitSpeechText(text);
    const audio = new Audio();
    const objectUrls = new Set<string>();
    let activeRequestId: string | null = null;
    let unsubscribe: (() => void) | null = null;
    let nextSegment = 0;
    let status: SpeechSynthesisAdapter.Status = { type: "starting" };

    const notify = () => listeners.forEach((listener) => listener());
    const cleanupRequest = () => {
      unsubscribe?.();
      unsubscribe = null;
      activeRequestId = null;
    };
    const cleanup = () => {
      cleanupRequest();
      audio.pause();
      audio.removeAttribute("src");
      audio.onended = null;
      audio.onerror = null;
      window.removeEventListener(
        "memo:voice-input-start",
        handleVoiceInputStart,
      );
      for (const url of objectUrls) URL.revokeObjectURL(url);
      objectUrls.clear();
    };
    const end = (
      reason: "finished" | "cancelled" | "error",
      error?: unknown,
    ) => {
      if (status.type === "ended") return;
      status = { type: "ended", reason, ...(error ? { error } : {}) };
      cleanup();
      notify();
    };
    const cancel = () => {
      if (status.type === "ended") return;
      if (activeRequestId) window.desktopApi.cancelSpeech(activeRequestId);
      end("cancelled");
    };
    const handleVoiceInputStart = cancel;
    window.addEventListener("memo:voice-input-start", handleVoiceInputStart);

    const playNextSegment = () => {
      if (status.type === "ended") return;
      if (nextSegment >= segments.length) {
        end("finished");
        return;
      }

      const id = crypto.randomUUID();
      const segment = segments[nextSegment++];
      const chunks: ArrayBuffer[] = [];
      activeRequestId = id;
      unsubscribe = window.desktopApi.streamSpeech(
        { id, text: segment },
        (event) => {
          if (status.type === "ended" || activeRequestId !== id) return;
          if (event.type === "chunk") {
            chunks.push(decodeBase64(event.audio));
            return;
          }
          cleanupRequest();
          if (event.type === "error") {
            end("error", new Error(event.message));
            return;
          }
          if (!chunks.length) {
            end("error", new Error("Speech API returned no audio."));
            return;
          }

          const blob = new Blob(chunks, { type: MIME_TYPE });
          const url = URL.createObjectURL(blob);
          objectUrls.add(url);
          audio.src = url;
          audio.onended = () => {
            objectUrls.delete(url);
            URL.revokeObjectURL(url);
            playNextSegment();
          };
          audio.onerror = () =>
            end("error", new Error("WAV audio playback failed."));
          if (status.type === "starting") {
            status = { type: "running" };
            notify();
          }
          void audio.play().catch((error: unknown) => end("error", error));
        },
      );
    };

    if (!segments.length) {
      end("error", new Error("Text-to-speech input cannot be empty."));
    } else {
      playNextSegment();
    }

    return {
      get status() {
        return status;
      },
      cancel,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  }
}

export const gatewaySpeechAdapter = new GatewaySpeechAdapter();
