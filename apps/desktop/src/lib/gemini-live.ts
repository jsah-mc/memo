/** Google Gemini Live WebSocket connection with noise cancellation. */

type GeminiLiveState = "idle" | "connecting" | "connected" | "listening" | "speaking" | "error";

interface GeminiLiveConfig {
  apiKey: string;
  model?: string;
}

export class GeminiLiveConnection {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private noiseNode: AudioWorkletNode | null = null;
  private state: GeminiLiveState = "idle";
  private listeners: Map<string, Set<() => void>> = new Map();
  private config: GeminiLiveConfig;

  constructor(config: GeminiLiveConfig) {
    this.config = config;
  }

  on(event: string, callback: () => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: () => void) {
    this.listeners.get(event)?.delete(callback);
  }

  private emit(event: string) {
    this.listeners.get(event)?.forEach(cb => cb());
  }

  getState(): GeminiLiveState {
    return this.state;
  }

  async connect(): Promise<void> {
    if (this.state === "connected" || this.state === "connecting") return;

    this.state = "connecting";
    this.emit("stateChange");

    try {
      // Connect to gateway's realtime endpoint
      const wsUrl = `ws://127.0.0.1:4010/v1/realtime`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.state = "connected";
        this.emit("stateChange");
        this.sendSetup();
      };

      this.ws.onmessage = async (event) => {
        await this.handleMessage(event.data);
      };

      this.ws.onerror = (error) => {
        console.error("Gemini Live WebSocket error:", error);
        this.state = "error";
        this.emit("stateChange");
      };

      this.ws.onclose = () => {
        this.state = "idle";
        this.emit("stateChange");
      };
    } catch (error) {
      console.error("Failed to connect to Gemini Live:", error);
      this.state = "error";
      this.emit("stateChange");
      throw error;
    }
  }

  private sendSetup() {
    if (!this.ws) return;

    const setupMessage = {
      setup: {
        model: this.config.model || "gemini-2.0-flash-exp",
        generationConfig: {
          temperature: 0.7,
          topP: 0.9,
          maxOutputTokens: 2048,
        },
      },
    };

    this.ws.send(JSON.stringify(setupMessage));
  }

  async startAudioInput(): Promise<void> {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
        },
      });

      this.audioContext = new AudioContext({ sampleRate: 16000 });

      // Add noise cancellation using Web Audio API
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Create a high-pass filter to remove low-frequency noise
      const highPass = this.audioContext.createBiquadFilter();
      highPass.type = "highpass";
      highPass.frequency.value = 80;

      // Create a low-pass filter to remove high-frequency noise
      const lowPass = this.audioContext.createBiquadFilter();
      lowPass.type = "lowpass";
      lowPass.frequency.value = 8000;

      // Create a noise gate using dynamics compressor
      const compressor = this.audioContext.createDynamicsCompressor();
      compressor.threshold.value = -50;
      compressor.knee.value = 40;
      compressor.ratio.value = 12;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;

      // Chain: source -> highpass -> lowpass -> compressor -> processor
      source.connect(highPass);
      highPass.connect(lowPass);
      lowPass.connect(compressor);

      // Create processor to capture audio data
      const bufferSize = 4096;
      this.processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

      compressor.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      this.processor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);
        this.sendAudioChunk(inputData);
      };

      this.state = "listening";
      this.emit("stateChange");
    } catch (error) {
      console.error("Failed to start audio input:", error);
      this.state = "error";
      this.emit("stateChange");
      throw error;
    }
  }

  stopAudioInput(): void {
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    this.state = "connected";
    this.emit("stateChange");
  }

  private sendAudioChunk(audioData: Float32Array) {
    if (!this.ws || this.state !== "listening") return;

    // Convert Float32Array to Int16 PCM (16-bit, little-endian)
    const pcmData = new Int16Array(audioData.length);
    for (let i = 0; i < audioData.length; i++) {
      pcmData[i] = Math.max(-32768, Math.min(32767, audioData[i] * 32768));
    }

    // Send as base64
    const base64 = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));

    const message = {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: "audio/pcm",
            data: base64,
          },
        ],
      },
    };

    this.ws.send(JSON.stringify(message));
  }

  private async handleMessage(data: string) {
    try {
      const message = JSON.parse(data);

      if (message.serverContent) {
        const content = message.serverContent;
        if (content.parts) {
          for (const part of content.parts) {
            if (part.text) {
              // Text response
              console.log("Gemini Live text:", part.text);
            }
            if (part.inlineData && part.inlineData.mimeType?.startsWith("audio")) {
              // Audio response
              this.playAudio(part.inlineData.data);
            }
          }
        }
      }

      if (message.setupComplete) {
        console.log("Gemini Live setup complete");
      }
    } catch (error) {
      console.error("Failed to parse Gemini Live message:", error);
    }
  }

  private async playAudio(base64Audio: string) {
    try {
      this.state = "speaking";
      this.emit("stateChange");

      const audioData = Uint8Array.from(atob(base64Audio), c => c.charCodeAt(0));
      const audioBuffer = await this.audioContext?.decodeAudioData(audioData.buffer);
      if (audioBuffer) {
        const source = this.audioContext!.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.audioContext!.destination);
        source.onended = () => {
          this.state = "listening";
          this.emit("stateChange");
        };
        source.start();
      }
    } catch (error) {
      console.error("Failed to play audio:", error);
      this.state = "listening";
      this.emit("stateChange");
    }
  }

  disconnect(): void {
    this.stopAudioInput();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.state = "idle";
    this.emit("stateChange");
  }

  sendText(text: string) {
    if (!this.ws) return;

    const message = {
      clientContent: {
        parts: [{ text }],
      },
    };

    this.ws.send(JSON.stringify(message));
  }
}
