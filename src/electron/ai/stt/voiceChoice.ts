// Graceville Fast Bible: picks the voice model this PC can really run, so listening works on ANY computer.
//
// - Every PC starts with the light model (part of the installer: no download, works offline straight away).
// - While listening, the decode process reports how hard the processor works.
//   If the light model leaves plenty of room (the full model should keep up too), the more accurate full model is
//   downloaded in the background (never on a Sunday) and used from the next time listening starts.
// - If the full model ever falls behind on this PC, the app switches back to the light model at once
//   and remembers that this PC is too slow for it.

import { app } from "electron"
import fs from "fs"
import path from "path"
import { LocalModelManager } from "../setup/LocalModelManager"
import { NemotronSetupManager } from "../setup/models/nemotron"
import { FULL_TOO_SLOW_RATIO, LIGHT_RATIO_FOR_FULL, VOICE_PROFILES, type VoiceProfileId } from "./models/voiceProfiles"

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
    const lightOk = isLightModelAvailable()
    const fullOk = await isFullModelAvailable()

    if (fullOk && (!readMemory().fullTooSlow || !lightOk)) return { profile: "full", modelDir: LocalModelManager.getModelDir("nemotron") }
    if (lightOk) return { profile: "light", modelDir: getLightModelDir() }
    return null
}

// ----- speed reports from the decode process -----

let slowFullReports = 0
let fastLightReports = 0
let downloadStarted = false

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
    fastLightReports = ratio < LIGHT_RATIO_FOR_FULL ? fastLightReports + 1 : 0
    if (fastLightReports >= 1) void downloadFullModelIfWorthIt()
    return false
}

/** A strong PC gets the more accurate model, downloaded quietly in the background. */
async function downloadFullModelIfWorthIt() {
    if (downloadStarted || readMemory().fullTooSlow) return
    if (new Date().getDay() === 0) return // never use the church's internet for a big download on a Sunday

    // claimed straight away, so speed reports arriving meanwhile never start a second download
    downloadStarted = true
    try {
        if (await isFullModelAvailable()) return
        console.info("[voice] This PC is fast enough: downloading the full voice model in the background")
        if (!(await LocalModelManager.downloadEngine("nemotron"))) downloadStarted = false // try again another time
    } catch (err) {
        console.warn("[voice] Background download failed:", err)
        downloadStarted = false
    }
}

/** For the status check: listening can start when either model is on this PC. */
export async function isAnyVoiceModelReady(): Promise<boolean> {
    return isLightModelAvailable() || (await isFullModelAvailable())
}
