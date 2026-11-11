// Graceville Fast Bible: picks the voice model for listening.
//
// Tested on Graceville's own sermon recordings (November 2026): on a clean sound-desk feed every model heard the
// pastor about equally well, but with room echo and noise the light model (Kroko) held up best, and it needs about a
// fifth of the processor time of the full model (Nemotron). So the light model, which is part of the installer, is used
// on every PC. The full model is only used if the light one is missing, and the app switches away from it at once if
// it falls behind. Nothing is downloaded.

import { app } from "electron"
import fs from "fs"
import path from "path"
import { LocalModelManager } from "../setup/LocalModelManager"
import { NemotronSetupManager } from "../setup/models/nemotron"
import { FULL_TOO_SLOW_RATIO, VOICE_PROFILES, type VoiceProfileId } from "./models/voiceProfiles"

// raise to measure every PC again (2: the app itself no longer slows the voice engine down by searching seven Bibles)
const MEMORY_VERSION = 2

interface VoiceMemory {
    version?: number
    /** the full model fell behind on this PC */
    fullTooSlow?: boolean
    /** last measured work ratios */
    lightRatio?: number
    fullRatio?: number
}

const MEMORY_FILE = () => path.join(app.getPath("userData"), "graceville-voice.json")

function readMemory(): VoiceMemory {
    try {
        const memory: VoiceMemory = JSON.parse(fs.readFileSync(MEMORY_FILE(), "utf8")) || {}
        // results measured by an older version no longer count
        return memory.version === MEMORY_VERSION ? memory : { version: MEMORY_VERSION }
    } catch {
        return { version: MEMORY_VERSION }
    }
}

function writeMemory(update: Partial<VoiceMemory>) {
    try {
        fs.writeFileSync(MEMORY_FILE(), JSON.stringify({ ...readMemory(), ...update }, null, 4))
    } catch (err) {
        console.error("[voice] Could not save the speed check:", err)
    }
}

// ----- where the models are -----

/** The light model ships inside the installer (resources/voice-light). */
export function getLightModelDir(): string {
    if (app.isPackaged) return path.join(process.resourcesPath, "voice-light")
    return path.join(app.getAppPath(), "resources", "graceville", "voice-light")
}

export function isLightModelAvailable(): boolean {
    const dir = getLightModelDir()
    return Object.values(VOICE_PROFILES.light.files).every((file) => fs.existsSync(path.join(dir, file)))
}

async function isFullModelAvailable(): Promise<boolean> {
    if (!NemotronSetupManager.isPlatformSupported()) return false
    return (await NemotronSetupManager.checkIntegrity(LocalModelManager.getModelDir("nemotron"))) === "ok"
}

// ----- choosing -----

export async function chooseVoiceModel(): Promise<{ profile: VoiceProfileId; modelDir: string } | null> {
    if (isLightModelAvailable()) return { profile: "light", modelDir: getLightModelDir() }
    if (await isFullModelAvailable()) return { profile: "full", modelDir: LocalModelManager.getModelDir("nemotron") }
    return null
}

// ----- speed reports from the decode process -----

let slowFullReports = 0

/** Returns true when the full model must be replaced by the light model right now. */
export function reportSpeed(profile: VoiceProfileId, ratio: number): boolean {
    if (profile === "full") {
        writeMemory({ fullRatio: ratio })
        slowFullReports = ratio > FULL_TOO_SLOW_RATIO ? slowFullReports + 1 : 0
        if (slowFullReports < 2 || !isLightModelAvailable()) return false

        console.info(`[voice] The full voice model is too heavy for this PC (work ratio ${ratio}) - using the light model`)
        writeMemory({ fullTooSlow: true })
        slowFullReports = 0
        return true
    }

    writeMemory({ lightRatio: ratio })
    return false
}

/** For the status check: listening can start when either model is on this PC. */
export async function isAnyVoiceModelReady(): Promise<boolean> {
    return isLightModelAvailable() || (await isFullModelAvailable())
}
