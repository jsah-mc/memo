import type { DictationAdapter } from "@assistant-ui/react";

type MeterSnapshot = {
  phase: "idle" | "listening" | "loading" | "transcribing" | "error";
  volume: number;
  message?: string;
};

const CALIBRATION_MS = 300;
const SPEECH_CONFIRM_MS = 150;
const ENDPOINT_SILENCE_MS = 700;
const MAX_WAIT_FOR_SPEECH_MS = 15_000;
const MIN_SPEECH_RMS = 0.006;

let meterSnapshot: MeterSnapshot = { phase: "idle", volume: 0 };
const meterListeners = new Set<() => void>();

function setMeter(next: MeterSnapshot) {
  meterSnapshot = next;
  meterListeners.forEach((listener) => listener());
}

export const speechMeter = {
  getSnapshot: () => meterSnapshot,
  subscribe: (listener: () => void) => {
    meterListeners.add(listener);
    return () => meterListeners.delete(listener);
  },
};

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const encoded = String(reader.result).split(",", 2)[1];
      if (!encoded) reject(new Error("Unable to encode microphone audio."));
      else resolve(encoded);
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Unable to read microphone audio."));
    reader.readAsDataURL(blob);
  });

const preferredMimeType = () => {
  const options = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];
  return options.find((value) => MediaRecorder.isTypeSupported(value)) ?? "";
};

class GatewayDictationAdapter implements DictationAdapter {
  disableInputDuringDictation = true;

  listen(): DictationAdapter.Session {
    window.desktopApi.traceSpeech("dictation.listen");
    window.dispatchEvent(new Event("memo:voice-input-start"));
    const speechStartCallbacks = new Set<() => void>();
    const speechEndCallbacks = new Set<
      (result: DictationAdapter.Result) => void
    >();
    const speechCallbacks = new Set<
      (result: DictationAdapter.Result) => void
    >();
    const chunks: BlobPart[] = [];
    let stream: MediaStream | undefined;
    let recorder: MediaRecorder | undefined;
    let audioContext: AudioContext | undefined;
    let animationFrame = 0;
    let ended = false;
    let stopping = false;
    let recordingStartedAt = 0;
    let speechCandidateAt = 0;
    let silenceStartedAt = 0;
    let hasSpoken = false;
    const floorSamples: number[] = [];

    const cleanup = () => {
      cancelAnimationFrame(animationFrame);
      stream?.getTracks().forEach((track) => track.stop());
      if (audioContext && audioContext.state !== "closed") {
        void audioContext.close();
      }
    };

    const fail = (error: unknown) => {
      ended = true;
      cleanup();
      session.status = { type: "ended", reason: "error" };
      const message = error instanceof Error ? error.message : String(error);
      setMeter({ phase: "error", volume: 0, message });
      console.error("Gateway speech transcription failed:", error);
    };

    const transcribe = async () => {
      if (!recorder) throw new Error("Microphone recorder did not start.");
      const mimeType = recorder.mimeType || "audio/webm";
      const blob = new Blob(chunks, { type: mimeType });
      if (!blob.size) throw new Error("No microphone audio was captured.");

      setMeter({
        phase: "transcribing",
        volume: 0,
        message: "Sending audio to Memo gateway…",
      });
      window.desktopApi.traceSpeech(
        `dictation.invoke-transcribe bytes=${blob.size}`,
      );
      const extension = mimeType.includes("ogg") ? "ogg" : "webm";
      const { text } = await window.desktopApi.transcribeSpeech({
        audio: await blobToBase64(blob),
        mimeType,
        filename: `recording.${extension}`,
      });
      window.desktopApi.traceSpeech("dictation.transcribe-returned");
      const transcript = text.trim();
      if (transcript) {
        const result = { transcript, isFinal: true };
        speechCallbacks.forEach((callback) => callback(result));
        speechEndCallbacks.forEach((callback) => callback(result));
      }
    };

    const session: DictationAdapter.Session = {
      status: { type: "starting" },
      stop: async () => {
        window.desktopApi.traceSpeech("dictation.stop");
        if (ended || stopping) return;
        stopping = true;
        if (!recorder || recorder.state === "inactive") {
          ended = true;
          cleanup();
          session.status = { type: "ended", reason: "stopped" };
          return;
        }

        await new Promise<void>((resolve, reject) => {
          recorder!.addEventListener("stop", () => resolve(), { once: true });
          recorder!.addEventListener(
            "error",
            () => reject(new Error("Microphone recording failed.")),
            { once: true },
          );
          recorder!.stop();
        });
        cleanup();
        try {
          await transcribe();
          ended = true;
          session.status = { type: "ended", reason: "stopped" };
          setMeter({ phase: "idle", volume: 0 });
        } catch (error) {
          fail(error);
        }
      },
      cancel: () => {
        if (ended) return;
        ended = true;
        if (recorder?.state === "recording") recorder.stop();
        cleanup();
        setMeter({ phase: "idle", volume: 0 });
        session.status = { type: "ended", reason: "cancelled" };
      },
      onSpeechStart(callback) {
        speechStartCallbacks.add(callback);
        return () => speechStartCallbacks.delete(callback);
      },
      onSpeechEnd(callback) {
        speechEndCallbacks.add(callback);
        return () => speechEndCallbacks.delete(callback);
      },
      onSpeech(callback) {
        speechCallbacks.add(callback);
        return () => speechCallbacks.delete(callback);
      },
    };

    setMeter({ phase: "loading", volume: 0, message: "Opening microphone…" });
    void window.desktopApi
      .prepareSpeech()
      .then(() =>
        navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
        }),
      )
      .then(async (mediaStream) => {
        if (ended) {
          mediaStream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = mediaStream;
        const mimeType = preferredMimeType();
        recorder = new MediaRecorder(
          mediaStream,
          mimeType ? { mimeType } : undefined,
        );
        recorder.ondataavailable = (event) => {
          if (event.data.size) chunks.push(event.data);
        };
        recorder.start(250);
        recordingStartedAt = performance.now();

        audioContext = new AudioContext();
        await audioContext.resume();
        const source = audioContext.createMediaStreamSource(mediaStream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.7;
        source.connect(analyser);
        const levels = new Uint8Array(analyser.fftSize);
        const updateVolume = () => {
          analyser.getByteTimeDomainData(levels);
          const rms = Math.sqrt(
            levels.reduce((sum, level) => {
              const sample = (level - 128) / 128;
              return sum + sample * sample;
            }, 0) / levels.length,
          );
          const now = performance.now();
          const elapsed = now - recordingStartedAt;
          if (elapsed <= CALIBRATION_MS) {
            floorSamples.push(rms);
          } else {
            const sortedFloor = [...floorSamples].sort(
              (left, right) => left - right,
            );
            const noiseFloor =
              sortedFloor[Math.floor(sortedFloor.length / 2)] ?? 0;
            const speechThreshold = Math.max(
              MIN_SPEECH_RMS,
              noiseFloor * 1.8,
            );

            if (rms >= speechThreshold) {
              silenceStartedAt = 0;
              if (!speechCandidateAt) speechCandidateAt = now;
              if (now - speechCandidateAt >= SPEECH_CONFIRM_MS) {
                hasSpoken = true;
              }
            } else {
              speechCandidateAt = 0;
              if (hasSpoken) {
                if (!silenceStartedAt) silenceStartedAt = now;
                if (now - silenceStartedAt >= ENDPOINT_SILENCE_MS) {
                  void session.stop();
                  return;
                }
              } else if (elapsed >= MAX_WAIT_FOR_SPEECH_MS) {
                // The analyser can miss quiet speech even though MediaRecorder
                // captured it. Let the gateway transcribe instead of silently
                // discarding the entire recording.
                void session.stop();
                return;
              }
            }
          }
          setMeter({ phase: "listening", volume: Math.min(1, rms * 5) });
          animationFrame = requestAnimationFrame(updateVolume);
        };
        updateVolume();
        session.status = { type: "running" };
        speechStartCallbacks.forEach((callback) => callback());
      })
      .catch(fail);

    return session;
  }
}

export const nativeSpeechDictationAdapter = new GatewayDictationAdapter();
