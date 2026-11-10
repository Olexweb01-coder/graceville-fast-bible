// Graceville Fast Bible: the two voice models the listening can run.
//
// full:  Nemotron 3.5 (about 680 MB, downloaded). Most accurate and many languages, but it needs a strong processor.
// light: Kroko streaming Zipformer (about 70 MB, part of the installer). English, around 10 times less work for the
//        processor, so it keeps up live even on old dual-core PCs and leaves the rest of the app fast.
//
// This file is shared with the decode process, so it must not use Electron.

export type VoiceProfileId = "full" | "light"

export interface VoiceProfile {
    id: VoiceProfileId
    files: { encoder: string; decoder: string; joiner: string; tokens: string; vad: string }
    featureDim: number
    /** decoder frames per second (for counting silence) */
    framesPerSecond: number
    /** the audio one encoder step needs, in ms */
    chunkShiftMs: number
    numThreads: number
    /** only the full model understands a language hint */
    usesLanguage: boolean
}

export const VOICE_PROFILES: Record<VoiceProfileId, VoiceProfile> = {
    full: {
        id: "full",
        files: { encoder: "encoder.int8.onnx", decoder: "decoder.int8.onnx", joiner: "joiner.int8.onnx", tokens: "tokens.txt", vad: "silero_vad.onnx" },
        featureDim: 128,
        framesPerSecond: 12.5,
        chunkShiftMs: 1120,
        numThreads: 2,
        usesLanguage: true
    },
    light: {
        id: "light",
        files: { encoder: "encoder.onnx", decoder: "decoder.onnx", joiner: "joiner.onnx", tokens: "tokens.txt", vad: "silero_vad.onnx" },
        featureDim: 80,
        framesPerSecond: 25,
        chunkShiftMs: 1280,
        // one thread is plenty for this model; the other core stays free for the app itself
        numThreads: 1,
        usesLanguage: false
    }
}

// ----- speed -----
// "work ratio" = processor time spent / length of the audio. 0.5 means one second of speech takes half a second to decode.

/** seconds of audio per speed report */
export const SPEED_WINDOW_SECONDS = 20

/** the full model is too heavy when it needs more than this, two reports in a row (the app must stay responsive too) */
export const FULL_TOO_SLOW_RATIO = 0.6

/**
 * The light model needs roughly 1/9 of the full model's work (measured on the same processor).
 * A PC where the light model needs less than this can comfortably run the full model.
 */
export const LIGHT_RATIO_FOR_FULL = 0.05
