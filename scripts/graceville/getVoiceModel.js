// Graceville Fast Bible: puts the light voice model in resources/graceville/voice-light before a build,
// so it is part of the installer (listening then works on any PC, offline, with no download).
//
// Downloaded once (about 60 MB) and checked against fixed fingerprints, so exactly these files are shipped.
// Usage: node scripts/graceville/getVoiceModel.js   (buildInstaller.js runs it automatically)

const { spawnSync } = require("child_process")
const crypto = require("crypto")
const fs = require("fs")
const os = require("os")
const path = require("path")

const root = path.join(__dirname, "..", "..")
const target = path.join(root, "resources", "graceville", "voice-light")

const RELEASES = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models"
const ARCHIVE = { name: "sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06", sha256: "c8676e5ff9ac2a85296e53ee0fd4d5fb1db6770e7a7647166eeafe349ade6834" }

const FILES = {
    "encoder.onnx": "d4881c57449d581e0770fd53fa66c2fdc6cd167d92ece7c715e603defc96d9d4",
    "decoder.onnx": "455ba38466fce8d5a57e7db68a323b684079ca4d9e1dd93a740d9b2429aae3b1",
    "joiner.onnx": "d406f616736350e2a7df3e39398b78eb2fc1a2ca6973a19d3853fa3227e25b52",
    "tokens.txt": "396dbeb5f4858875690716084f54e90d339679d0ba3e6b5b584f3d7589254d2d"
}
const VAD = { name: "silero_vad.onnx", url: `${RELEASES}/silero_vad.onnx`, sha256: "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6" }

const LICENSE = `Light voice model used by Graceville Fast Bible for listening.

Kroko ASR streaming English model by Banafo (https://huggingface.co/Banafo/Kroko-ASR),
licensed under Creative Commons Attribution-ShareAlike 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).
ONNX export from the sherpa-onnx project (https://github.com/k2-fsa/sherpa-onnx), unchanged.

silero_vad.onnx: Silero VAD (https://github.com/snakers4/silero-vad), MIT licence.
`

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")
const isGood = (file, hash) => fs.existsSync(file) && sha256(file) === hash

async function download(url, file, hash) {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`)
    fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()))
    if (sha256(file) !== hash) {
        fs.rmSync(file, { force: true })
        throw new Error(`The downloaded file is not the expected one: ${url}`)
    }
}

function extract(archive, folder) {
    // Windows 10/11 has its own tar.exe, which can open .tar.bz2
    const tar = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar"
    const result = spawnSync(tar, ["-xjf", path.basename(archive)], { cwd: folder, stdio: "inherit" })
    if (result.status !== 0) throw new Error("Could not unpack the voice model")
}

async function getVoiceModel() {
    const missing = Object.entries(FILES).filter(([name, hash]) => !isGood(path.join(target, name), hash))
    const vadMissing = !isGood(path.join(target, VAD.name), VAD.sha256)

    if (!missing.length && !vadMissing) {
        console.log("Light voice model: ready")
        return
    }

    fs.mkdirSync(target, { recursive: true })
    console.log("Light voice model: downloading (one time only, about 60 MB)...")

    if (missing.length) {
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), "graceville-voice-"))
        try {
            const archive = path.join(temp, `${ARCHIVE.name}.tar.bz2`)
            await download(`${RELEASES}/${ARCHIVE.name}.tar.bz2`, archive, ARCHIVE.sha256)
            extract(archive, temp)
            for (const [name, hash] of Object.entries(FILES)) {
                const from = path.join(temp, ARCHIVE.name, name)
                if (!isGood(from, hash)) throw new Error(`${name} in the voice model is not the expected file`)
                fs.copyFileSync(from, path.join(target, name))
            }
        } finally {
            fs.rmSync(temp, { recursive: true, force: true })
        }
    }

    if (vadMissing) await download(VAD.url, path.join(target, VAD.name), VAD.sha256)
    fs.writeFileSync(path.join(target, "LICENSE.txt"), LICENSE)
    console.log("Light voice model: ready")
}

module.exports = { getVoiceModel }

if (require.main === module) {
    getVoiceModel().catch((err) => {
        console.error(`\x1b[31m${err.message}\x1b[0m`)
        process.exit(1)
    })
}
