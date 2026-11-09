// Graceville Fast Bible: tells the app once a minute whether it is idle, so a downloaded update is only installed
// when nothing is happening (see src/electron/utils/updatePolicy.ts).
// Idle = nothing on any screen (locked overlays count), no audio playing, and no speech heard in the last minute.

import { get } from "svelte/store"
import { Main } from "../../types/IPC/Main"
import { isOutCleared } from "../components/helpers/output"
import { sendMain } from "../IPC/main"
import { outputs, playingAudio, sttTranscript } from "../stores"

const REPORT_INTERVAL_MS = 60 * 1000

let started = false
let lastSpeechAt = 0

export function startGracevilleIdleReports() {
    if (started) return
    started = true

    let previous = ""
    sttTranscript.subscribe((transcript) => {
        const current = `${transcript.finalized}|${transcript.unprocessed}`
        if (current !== previous && current !== "|") lastSpeechAt = Date.now()
        previous = current
    })

    setInterval(report, REPORT_INTERVAL_MS)
}

function report() {
    let idle = false
    try {
        const screensClear = isOutCleared(null, get(outputs), true)
        const noAudio = Object.keys(get(playingAudio) || {}).length === 0
        const noRecentSpeech = Date.now() - lastSpeechAt > REPORT_INTERVAL_MS
        idle = screensClear && noAudio && noRecentSpeech
    } catch (err) {
        console.warn("[Graceville] Could not check if the app is idle:", err)
        idle = false // when unsure, never restart
    }

    sendMain(Main.AUTO_UPDATE, { idle })
}
