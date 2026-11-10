import path from "path"
import type { SttEngineOptions } from "../../../../types/ai/AiSettings"
import type { TranscriberSegment } from "../sttHelper"
import { chooseVoiceModel, getLightModelDir, reportSpeed } from "../voiceChoice"
import { NemotronDriver, type NemotronWorkerRequest, type NemotronWorkerResponse } from "./nemotronWorker"
import type { VoiceProfileId } from "./voiceProfiles"

const WORKER_START_TIMEOUT = 30000
const WORKER_FLUSH_TIMEOUT = 3000
const WORKER_STALL_TIMEOUT = 60000
const WORKER_STALL_CHECK_INTERVAL = 5000

export class NemotronTranscriber {
    private options: SttEngineOptions
    private onSegment: (segment: TranscriberSegment) => void
    private onError: (message: string) => void
    private onInterim?: (text: string) => void

    private child: Electron.UtilityProcess | null = null
    private fallback: NemotronDriver | null = null
    private stopped = false

    private readyResolve: ((ok: boolean) => void) | null = null
    private stoppedResolve: (() => void) | null = null
    private startErrorMessage = ""

    private lastWorkerMessageAt = 0
    private stallTimer: NodeJS.Timeout | null = null
    private restarting = false
    private modelDir = ""
    private profile: VoiceProfileId = "light"

    constructor(options: SttEngineOptions, onSegment: (segment: TranscriberSegment) => void, onError: (message: string) => void, onInterim?: (text: string) => void) {
        this.options = options
        this.onSegment = onSegment
        this.onError = onError
        this.onInterim = onInterim
    }

    async start() {
        const choice = await chooseVoiceModel()
        if (!choice) throw new Error("The voice model is missing. Please reinstall Graceville Fast Bible.")
        this.profile = choice.profile
        this.modelDir = choice.modelDir
        console.info(`[voice] Listening with the ${this.profile} voice model`)

        if (await this.startWorker()) return true
        if (this.startErrorMessage) throw new Error(this.startErrorMessage)

        this.fallback = new NemotronDriver({
            language: this.options.language || "en",
            decodeLanguage: this.options.language,
            modelDir: this.modelDir,
            profile: this.profile,
            onSpeed: (ratio) => this.handleSpeed(ratio),
            onSegment: this.onSegment,
            onInterim: this.onInterim,
            onError: this.onError
        })
        await this.fallback.start()
        return true
    }

    async stop() {
        this.stopped = true
        this.clearStallTimer()

        const { child } = this
        this.child = null

        if (child) {
            try {
                this.post(child, { type: "stop" })
                await new Promise<void>((resolve) => {
                    const timer = setTimeout(resolve, WORKER_FLUSH_TIMEOUT)
                    this.stoppedResolve = () => {
                        clearTimeout(timer)
                        resolve()
                    }
                })
            } catch {}
            try {
                child.kill()
            } catch {}
        }

        if (this.fallback) {
            await this.fallback.stop()
            this.fallback = null
        }
        return true
    }

    pushAudio(buffer: Uint8Array) {
        if (this.child) {
            this.post(this.child, { type: "audio", data: buffer })
            return true
        }
        if (!this.fallback) return false
        this.fallback.pushAudio(buffer)
        return true
    }

    private async startWorker(): Promise<boolean> {
        let child: Electron.UtilityProcess
        try {
            const { utilityProcess } = require("electron") as typeof import("electron")
            if (!utilityProcess?.fork) return false
            child = utilityProcess.fork(path.join(__dirname, "./nemotronWorker.js"), [], { serviceName: "Graceville Fast Bible listening" })
        } catch (err) {
            console.error("[nemotron] Could not spawn the decode process:", err)
            return false
        }

        this.child = child
        this.lastWorkerMessageAt = Date.now()
        this.armStallWatchdog()

        child.on("message", (msg: NemotronWorkerResponse) => this.handleWorkerMessage(msg))
        child.on("exit", (code) => {
            if (this.child !== child) return
            this.child = null
            this.readyResolve?.(false)
            this.stoppedResolve?.()
            if (!this.stopped) this.onError(`Nemotron transcription process exited unexpectedly (code ${code})`)
        })

        this.post(child, { type: "start", language: this.options.language || "en", decodeLanguage: this.options.language, modelDir: this.modelDir, profile: this.profile })

        const ok = await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => {
                this.readyResolve = null
                resolve(false)
            }, WORKER_START_TIMEOUT)
            this.readyResolve = (value: boolean) => {
                clearTimeout(timer)
                this.readyResolve = null
                resolve(value)
            }
        })

        if (!ok) {
            this.child = null
            try {
                child.kill()
            } catch {}
        }
        return ok
    }

    private handleWorkerMessage(message: NemotronWorkerResponse) {
        if (!message || typeof message !== "object") return
        this.lastWorkerMessageAt = Date.now()

        const handlers: Record<string, () => void> = {
            segment: () => message.type === "segment" && this.onSegment(message.segment),
            interim: () => message.type === "interim" && this.onInterim?.(message.text),
            ready: () => this.readyResolve?.(true),
            speed: () => message.type === "speed" && this.handleSpeed(message.ratio),
            stopped: () => this.stoppedResolve?.(),
            error: () => {
                if (message.type !== "error") return
                if (this.readyResolve) {
                    this.startErrorMessage = message.message
                    this.readyResolve(false)
                } else if (!this.stopped) {
                    this.onError(message.message)
                }
            }
        }

        handlers[message.type]?.()
    }

    private handleSpeed(ratio: number) {
        if (this.stopped || !reportSpeed(this.profile, ratio)) return
        void this.switchToLight()
    }

    /** The full model cannot keep up on this PC: continue with the light model (a short pause of a second or two). */
    private async switchToLight() {
        if (this.profile === "light" || this.restarting) return
        this.restarting = true
        this.profile = "light"
        this.modelDir = getLightModelDir()

        try {
            if (this.fallback) {
                await this.fallback.stop()
                this.fallback = new NemotronDriver({ language: this.options.language || "en", decodeLanguage: this.options.language, modelDir: this.modelDir, profile: this.profile, onSpeed: (r) => this.handleSpeed(r), onSegment: this.onSegment, onInterim: this.onInterim, onError: this.onError })
                await this.fallback.start()
                return
            }

            const { child } = this
            this.child = null
            try {
                child?.kill()
            } catch {
                // already closed
            }
            this.onInterim?.("")

            const ok = await this.startWorker()
            if (!ok && !this.stopped) this.onError(this.startErrorMessage || "Could not switch to the light voice model")
        } finally {
            this.restarting = false
        }
    }

    private post(child: Electron.UtilityProcess, message: NemotronWorkerRequest) {
        try {
            child.postMessage(message)
        } catch (err) {
            console.error("[nemotron] Failed to reach the decode process:", err)
        }
    }

    private clearStallTimer() {
        if (this.stallTimer) {
            clearInterval(this.stallTimer)
            this.stallTimer = null
        }
    }

    private armStallWatchdog() {
        this.clearStallTimer()
        this.stallTimer = setInterval(() => void this.checkStall(), WORKER_STALL_CHECK_INTERVAL)
        this.stallTimer.unref?.()
    }

    private async checkStall() {
        if (this.stopped || this.restarting || !this.child) return
        if (Date.now() - this.lastWorkerMessageAt < WORKER_STALL_TIMEOUT) return

        this.restarting = true

        // likely just not speaking
        console.info(`[nemotron] Decode process went silent for ${Math.round((Date.now() - this.lastWorkerMessageAt) / 1000)}s - restarting process`)

        const { child } = this
        this.child = null
        try {
            child?.kill()
        } catch {}
        this.onInterim?.("")

        try {
            const ok = await this.startWorker()
            if (!ok && !this.stopped) this.onError(this.startErrorMessage || "Nemotron transcription process could not be restarted")
        } finally {
            this.restarting = false
        }
    }
}
