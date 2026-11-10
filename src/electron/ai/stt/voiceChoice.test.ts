import fs from "fs"
import os from "os"
import path from "path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ userData: "", fullOk: false, downloads: 0 }))

vi.mock("electron", () => ({ app: { getPath: () => state.userData, isPackaged: false, getAppPath: () => state.userData } }))
vi.mock("../setup/LocalModelManager", () => ({
    LocalModelManager: {
        getModelDir: () => path.join(state.userData, "full"),
        downloadEngine: async () => {
            state.downloads++
            return true
        }
    }
}))
vi.mock("../setup/models/nemotron", () => ({ NemotronSetupManager: { isPlatformSupported: () => true, checkIntegrity: async () => (state.fullOk ? "ok" : "missing") } }))

async function load() {
    vi.resetModules()
    return import("./voiceChoice")
}

function addLightModel() {
    const dir = path.join(state.userData, "resources", "graceville", "voice-light")
    fs.mkdirSync(dir, { recursive: true })
    for (const file of ["encoder.onnx", "decoder.onnx", "joiner.onnx", "tokens.txt", "silero_vad.onnx"]) fs.writeFileSync(path.join(dir, file), "x")
}

describe("Graceville: choosing the voice model this PC can run", () => {
    beforeEach(() => {
        state.userData = fs.mkdtempSync(path.join(os.tmpdir(), "voice-"))
        state.fullOk = false
        state.downloads = 0
        vi.useRealTimers()
    })

    it("uses the built-in light model when the full model is not downloaded", async () => {
        addLightModel()
        const voice = await load()
        expect((await voice.chooseVoiceModel())?.profile).toBe("light")
    })

    it("uses the full model when it is downloaded and this PC has not been too slow for it", async () => {
        addLightModel()
        state.fullOk = true
        const voice = await load()
        expect((await voice.chooseVoiceModel())?.profile).toBe("full")
    })

    it("switches to the light model after the full model falls behind twice, and remembers it", async () => {
        addLightModel()
        state.fullOk = true
        const voice = await load()
        expect(voice.reportSpeed("full", 0.9)).toBe(false) // one slow moment is not enough
        expect(voice.reportSpeed("full", 0.9)).toBe(true)
        expect((await voice.chooseVoiceModel())?.profile).toBe("light")

        // still remembered after the app restarts
        const again = await load()
        expect((await again.chooseVoiceModel())?.profile).toBe("light")
    })

    it("does not switch when the full model keeps up", async () => {
        addLightModel()
        state.fullOk = true
        const voice = await load()
        for (let i = 0; i < 5; i++) expect(voice.reportSpeed("full", 0.3)).toBe(false)
    })

    it("downloads the full model only on a strong PC, and never on a Sunday", async () => {
        addLightModel()
        vi.useFakeTimers({ toFake: ["Date"] })

        vi.setSystemTime(new Date("2026-11-08T10:00:00")) // a Sunday
        let voice = await load()
        for (let i = 0; i < 5; i++) voice.reportSpeed("light", 0.02)
        await new Promise((resolve) => setImmediate(resolve))
        expect(state.downloads).toBe(0)

        vi.setSystemTime(new Date("2026-11-10T10:00:00")) // a Tuesday, but a slow PC
        voice = await load()
        for (let i = 0; i < 5; i++) voice.reportSpeed("light", 0.15)
        await new Promise((resolve) => setImmediate(resolve))
        expect(state.downloads).toBe(0)

        voice = await load() // a Tuesday on a fast PC
        for (let i = 0; i < 3; i++) voice.reportSpeed("light", 0.02)
        await new Promise((resolve) => setImmediate(resolve))
        expect(state.downloads).toBe(1)
    })

    it("never downloads the full model on a PC that was too slow for it", async () => {
        addLightModel()
        fs.writeFileSync(path.join(state.userData, "graceville-voice.json"), JSON.stringify({ fullTooSlow: true }))
        vi.useFakeTimers({ toFake: ["Date"] })
        vi.setSystemTime(new Date("2026-11-10T10:00:00"))
        const voice = await load()
        for (let i = 0; i < 5; i++) voice.reportSpeed("light", 0.02)
        await new Promise((resolve) => setImmediate(resolve))
        expect(state.downloads).toBe(0)
    })
})
