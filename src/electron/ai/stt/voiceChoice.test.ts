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

    it("uses the built-in light model, without downloading anything", async () => {
        addLightModel()
        const voice = await load()
        expect((await voice.chooseVoiceModel())?.profile).toBe("light")
        for (let i = 0; i < 5; i++) voice.reportSpeed("light", 0.02) // even on a very fast PC
        await new Promise((resolve) => setImmediate(resolve))
        expect(state.downloads).toBe(0)
    })

    it("prefers the light model even when the full model was downloaded by an older version", async () => {
        addLightModel()
        state.fullOk = true
        const voice = await load()
        expect((await voice.chooseVoiceModel())?.profile).toBe("light")
    })

    it("uses the full model only when the light model is missing", async () => {
        state.fullOk = true
        const voice = await load()
        expect((await voice.chooseVoiceModel())?.profile).toBe("full")
    })

    it("has nothing to listen with when neither model is there", async () => {
        const voice = await load()
        expect(await voice.chooseVoiceModel()).toBe(null)
    })

    it("switches away from the full model after it falls behind twice, if the light model is there", async () => {
        addLightModel()
        const voice = await load()
        expect(voice.reportSpeed("full", 0.9)).toBe(false) // one slow moment is not enough
        expect(voice.reportSpeed("full", 0.9)).toBe(true)
        for (let i = 0; i < 3; i++) expect(voice.reportSpeed("full", 0.3)).toBe(false)
    })
})
