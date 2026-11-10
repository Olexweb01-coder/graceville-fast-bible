import path from "path"
import type { DriverCallbacks, TranscriberSegment, TranscriptionDriver } from "../sttHelper"
import { findRepeatedTail, isMusicAnnotation, segmentConfidence } from "../sttHelper"
import { SPEED_WINDOW_SECONDS, VOICE_PROFILES, type VoiceProfile, type VoiceProfileId } from "./voiceProfiles"

export type NemotronWorkerRequest = { type: "start"; language?: string; decodeLanguage?: string; modelDir?: string; profile?: VoiceProfileId } | { type: "audio"; data: Uint8Array } | { type: "stop" }
export type NemotronWorkerResponse = { type: "ready" } | { type: "segment"; segment: TranscriberSegment } | { type: "interim"; text: string } | { type: "error"; message: string } | { type: "stopped" } | { type: "alive" } | { type: "speed"; ratio: number }

const SAMPLE_RATE = 16000
const SPEED_WINDOW_SAMPLES = SPEED_WINDOW_SECONDS * SAMPLE_RATE

const VAD_THRESHOLD = 0.3
const VAD_MIN_SILENCE = 0.8
const VAD_MIN_SPEECH = 0.15
const VAD_MAX_SPEECH = 30
const MAX_UTTERANCE_SAMPLES = VAD_MAX_SPEECH * SAMPLE_RATE

interface Hypothesis {
    text: string
    tokens: string[]
    logProbs: number[]
    blanks: number
}

type NemotronOptions = DriverCallbacks & { language?: string; decodeLanguage?: string; modelDir?: string; profile?: VoiceProfileId; sherpa?: any; onSpeed?: (ratio: number) => void }

export class NemotronDriver implements TranscriptionDriver {
    private options: NemotronOptions
    private profile: VoiceProfile
    // decoder frames with no token: after the first the trailing word is settled, after the second the speaker is done
    private commitTrailingBlanks: number
    private closeTrailingBlanks: number
    // silence pushed at stop() so the audio after the last encoder step is still decoded
    private flushSamples: number
    private speedSamples = 0
    private speedBusyMs = 0
    private recognizer: any = null
    private vad: any = null
    private stream: any = null

    private stopped = false
    private totalSamples = 0
    private inUtterance = false
    private blanksAtOpen = 0
    private utteranceStartSample = 0
    private emittedAtOpen = 0
    private emittedChars = 0
    private nextEmitStartMs = 0

    constructor(options: NemotronOptions) {
        this.options = options
        this.profile = VOICE_PROFILES[options.profile || "full"]
        this.commitTrailingBlanks = Math.round(VAD_MIN_SILENCE * this.profile.framesPerSecond)
        this.closeTrailingBlanks = Math.round(2.5 * this.profile.framesPerSecond)
        this.flushSamples = Math.ceil(((this.profile.chunkShiftMs + 100) / 1000) * SAMPLE_RATE)
    }

    async start(): Promise<void> {
        if (this.stopped) throw new Error("Driver already stopped")

        const sherpa = this.options.sherpa || require("sherpa-onnx-node")
        const { modelDir } = this.options
        if (!modelDir) throw new Error("Nemotron model files are missing")
        const files = this.profile.files

        this.recognizer = new sherpa.OnlineRecognizer({
            featConfig: { sampleRate: SAMPLE_RATE, featureDim: this.profile.featureDim },
            modelConfig: {
                transducer: {
                    encoder: path.join(modelDir, files.encoder),
                    decoder: path.join(modelDir, files.decoder),
                    joiner: path.join(modelDir, files.joiner)
                },
                tokens: path.join(modelDir, files.tokens),
                numThreads: this.profile.numThreads,
                provider: "cpu"
            },
            decodingMethod: "greedy_search",
            enableEndpoint: false
        })

        this.stream = this.recognizer.createStream()
        if (typeof this.stream.setOption !== "function") throw new Error("sherpa-onnx-node 1.13.7 or newer is required")
        if (this.profile.usesLanguage && this.options.decodeLanguage) this.stream.setOption("language", this.options.decodeLanguage)

        this.vad = new sherpa.Vad(
            {
                sileroVad: {
                    model: path.join(modelDir, files.vad),
                    threshold: VAD_THRESHOLD,
                    minSilenceDuration: VAD_MIN_SILENCE,
                    minSpeechDuration: VAD_MIN_SPEECH,
                    maxSpeechDuration: VAD_MAX_SPEECH,
                    windowSize: 512
                },
                sampleRate: SAMPLE_RATE,
                numThreads: 1,
                provider: "cpu"
            },
            60
        )
    }

    async stop(): Promise<void> {
        if (this.stopped) return
        this.stopped = true

        try {
            this.flushTail()
            if (this.inUtterance) this.closeUtterance(this.readHypothesis(), true)
        } catch (err) {
            console.error("[nemotron] Failed to flush the final utterance:", err)
        }

        this.recognizer = null
        this.vad = null
        this.stream = null
    }

    pushAudio(buffer: Uint8Array): void {
        if (this.stopped || !this.recognizer || !this.stream) return

        const samples = int16ToFloat32(buffer)
        if (!samples.length) return

        const startedAt = performance.now()
        try {
            this.vad.acceptWaveform(samples)

            // every push reaches the recognizer, silence included, or the encoder cache goes stale
            this.stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples })
            while (this.recognizer.isReady(this.stream)) this.recognizer.decode(this.stream)

            this.totalSamples += samples.length
            const hypothesis = this.readHypothesis()
            const pending = hypothesis.text.length > this.emittedChars

            while (!this.vad.isEmpty()) this.vad.pop()

            // the recognizer emitting tokens is speech too - a music bed can hold the VAD shut for tens of seconds
            if (!this.inUtterance && (this.vad.isDetected() || pending)) {
                this.inUtterance = true
                this.nextEmitStartMs = Math.max(this.nextEmitStartMs, this.currentMs())
                this.blanksAtOpen = hypothesis.blanks
                this.utteranceStartSample = this.totalSamples
                this.emittedAtOpen = this.emittedChars
            }

            if (!this.inUtterance) {
                // clear the predictor only in a silence the decoder itself has confirmed
                if (hypothesis.text && hypothesis.blanks >= this.closeTrailingBlanks) this.resetDecoder()
                return
            }

            // an utterance that has produced nothing counts silence from its own open, not from before it
            const produced = pending || this.emittedChars > this.emittedAtOpen
            const settledBlanks = produced ? hypothesis.blanks : hypothesis.blanks - this.blanksAtOpen
            const overLong = this.totalSamples - this.utteranceStartSample >= MAX_UTTERANCE_SAMPLES && hypothesis.blanks >= 1

            if (settledBlanks >= this.closeTrailingBlanks) this.closeUtterance(hypothesis, produced)
            else if (overLong) this.splitUtterance(hypothesis)
            else this.emitFromHypothesis(hypothesis, settledBlanks >= this.commitTrailingBlanks ? "settled" : "growing")
        } catch (err) {
            this.options.onError(String((err as Error)?.message || err))
        } finally {
            this.measureSpeed(samples.length, performance.now() - startedAt)
        }
    }

    /** Reports how much processor time decoding needs compared to the length of the audio. */
    private measureSpeed(samples: number, busyMs: number) {
        this.speedSamples += samples
        this.speedBusyMs += busyMs
        if (this.speedSamples < SPEED_WINDOW_SAMPLES) return

        const ratio = this.speedBusyMs / ((this.speedSamples / SAMPLE_RATE) * 1000)
        this.speedSamples = 0
        this.speedBusyMs = 0
        this.options.onSpeed?.(Math.round(ratio * 1000) / 1000)
    }

    private currentMs = () => Math.round((this.totalSamples / SAMPLE_RATE) * 1000)

    private readHypothesis(): Hypothesis {
        const result = this.recognizer.getResult(this.stream)
        return {
            text: (result.text || "").trim(),
            tokens: result.tokens || [],
            logProbs: result.ys_probs || [],
            blanks: result.num_trailing_blanks || 0
        }
    }

    private flushTail() {
        if (!this.recognizer || !this.stream) return
        this.stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: new Float32Array(this.flushSamples) })
        while (this.recognizer.isReady(this.stream)) this.recognizer.decode(this.stream)
    }

    private emitFromHypothesis(hypothesis: Hypothesis, mode: "growing" | "settled" | "closed") {
        const final = mode !== "growing"
        const text = hypothesis.text
        if (!text) {
            if (!final) this.options.onInterim?.("")
            return
        }

        // a greedy RNN-T can lock into a cycle; only clearing the decoder breaks it
        const loopAt = findRepeatedTail(text)
        if (loopAt >= 0) {
            const keep = text.slice(0, loopAt).trimEnd()
            if (keep.length > this.emittedChars) {
                const candidate = keep.slice(this.emittedChars).trim()
                const confidence = segmentConfidence(hypothesis.tokens, hypothesis.logProbs, text, this.emittedChars, keep.length)
                this.emittedChars = keep.length
                if (candidate) this.emitText(candidate, false, confidence)
            }
            this.resetDecoder()
            this.options.onInterim?.("")
            return
        }

        const commitTo = final ? text.length : text.lastIndexOf(" ")
        let candidate = ""
        let confidence: number | undefined
        let glue = false

        if (commitTo > this.emittedChars) {
            const from = this.emittedChars
            candidate = text.slice(from, commitTo).trim()
            if (candidate) confidence = segmentConfidence(hypothesis.tokens, hypothesis.logProbs, text, from, commitTo)
            glue = from > 0 && text[from] !== " "
            this.emittedChars = commitTo
        }

        // an empty segment at close marks the utterance end
        if (candidate || (mode === "closed" && this.emittedChars > 0)) this.emitText(candidate, mode === "closed", confidence, glue)

        this.options.onInterim?.(final ? "" : text.slice(this.emittedChars).trim())
    }

    private resetDecoder() {
        this.recognizer.reset(this.stream)
        this.emittedChars = 0
        this.blanksAtOpen = 0
    }

    private closeUtterance(hypothesis: Hypothesis, produced: boolean) {
        if (produced) this.emitFromHypothesis(hypothesis, "closed")
        this.inUtterance = false
    }

    private splitUtterance(hypothesis: Hypothesis) {
        this.emitFromHypothesis(hypothesis, "growing")
        if (this.emittedChars > 0) this.emitText("", true)
        this.inUtterance = false
    }

    private emitText(text: string, utteranceEnd: boolean, confidence?: number, glue = false) {
        const endMs = this.currentMs()
        const segment: TranscriberSegment = { text, startMs: this.nextEmitStartMs, endMs }
        if (confidence !== undefined) segment.confidence = confidence
        if (glue) segment.glue = true
        if (isMusicAnnotation(text)) segment.music = true
        if (utteranceEnd) segment.utteranceEnd = true
        if (this.options.language) segment.language = this.options.language

        this.nextEmitStartMs = endMs
        this.options.onSegment(segment)
    }
}

export function int16ToFloat32(buffer: Uint8Array): Float32Array {
    const count = Math.floor(buffer.byteLength / 2)
    const samples = new Float32Array(count)
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    for (let i = 0; i < count; i++) {
        samples[i] = view.getInt16(i * 2, true) / 32768
    }
    return samples
}

// IPC Utility Process Worker Entrypoint
const parentPort = (process as any).parentPort
if (parentPort) {
    let driver: NemotronDriver | null = null
    const post = (msg: NemotronWorkerResponse) => parentPort.postMessage(msg)

    setInterval(() => post({ type: "alive" }), 5000).unref?.()

    parentPort.on("message", async ({ data }: { data: NemotronWorkerRequest }) => {
        try {
            if (data.type === "start") {
                driver = new NemotronDriver({
                    language: data.language,
                    decodeLanguage: data.decodeLanguage,
                    modelDir: data.modelDir,
                    profile: data.profile,
                    onSpeed: (ratio) => post({ type: "speed", ratio }),
                    onSegment: (segment) => post({ type: "segment", segment }),
                    onInterim: (text) => post({ type: "interim", text }),
                    onError: (message) => post({ type: "error", message })
                })
                await driver.start()
                post({ type: "ready" })
            } else if (data.type === "audio") {
                driver?.pushAudio(data.data)
            } else if (data.type === "stop") {
                await driver?.stop()
                driver = null
                post({ type: "stopped" })
            }
        } catch (err) {
            post({ type: "error", message: String((err as Error)?.message || err) })
        }
    })
}
