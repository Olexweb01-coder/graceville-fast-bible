// Graceville Fast Bible: puts the light voice model in resources/graceville/voice-light before a build,
// so it is part of the installer (listening then works on any PC, offline, with no download).
//
// Downloaded once (about 70 MB) and checked against fixed fingerprints, so exactly these files are shipped.
// Usage: node scripts/graceville/getVoiceModel.js   (buildInstaller.js runs it automatically)

const crypto = require("crypto")
const fs = require("fs")
const path = require("path")

const root = path.join(__dirname, "..", "..")
const target = path.join(root, "resources", "graceville", "voice-light")

// The model files one by one (no archive to unpack, so nothing depends on the tools installed on the build PC)
const MODEL_URL = process.env.GRACEVILLE_VOICE_URL || "https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06/resolve/main"
const FILES = {
    "encoder.onnx": "d4881c57449d581e0770fd53fa66c2fdc6cd167d92ece7c715e603defc96d9d4",
    "decoder.onnx": "455ba38466fce8d5a57e7db68a323b684079ca4d9e1dd93a740d9b2429aae3b1",
    "joiner.onnx": "d406f616736350e2a7df3e39398b78eb2fc1a2ca6973a19d3853fa3227e25b52",
    "tokens.txt": "396dbeb5f4858875690716084f54e90d339679d0ba3e6b5b584f3d7589254d2d",
    "silero_vad.onnx": "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6"
}
const fileUrl = (name) => (name === "silero_vad.onnx" ? "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx" : `${MODEL_URL}/${name}`)

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

async function getVoiceModel() {
    const missing = Object.entries(FILES).filter(([name, hash]) => !isGood(path.join(target, name), hash))
    if (!missing.length) {
        console.log("Light voice model: ready")
        return
    }

    fs.mkdirSync(target, { recursive: true })
    console.log("Light voice model: downloading (one time only, about 70 MB)...")

    for (const [name, hash] of missing) {
        // download next to the target first, so a broken download never replaces a good file
        const temp = path.join(target, `${name}.download`)
        await download(fileUrl(name), temp, hash)
        fs.renameSync(temp, path.join(target, name))
    }

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
