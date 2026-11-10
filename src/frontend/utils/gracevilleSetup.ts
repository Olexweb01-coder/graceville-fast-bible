// Graceville Fast Bible: automatic first-time setup, so the media team can just open the app and use it.
//
// Once (after the welcome popup is closed):
//   - installs the built-in public-domain Bibles (KJV, BSB, WEB, ASV, BBE, YLT, Darby) and selects KJV
//   - switches Smart listening on, picks the computer's default microphone, sets Auto present to "If confident"
//   - opens the Scripture tab
// The voice model needs no setup: a light model is part of the installer, and on fast PCs the app itself
// fetches the more accurate model in the background (see src/electron/ai/stt/voiceChoice.ts).

import { get } from "svelte/store"
import type { Bible } from "json-bible/lib/Bible"
import { SpeechToText } from "../ai/stt/stt"
import { setActiveScripture } from "../converters/bible"
import { activeDrawerTab, activePopup, ai, drawerTabsData, scriptures, scripturesCache, special } from "../stores"
import { newToast } from "./common"
import { save } from "./save"

const SETUP_VERSION = 1 // raise to run new setup steps once on existing installs

export const BUNDLED_BIBLES = [
    { id: "graceville_kjv", file: "kjv" },
    { id: "graceville_bsb", file: "bsb" },
    { id: "graceville_web", file: "web" },
    { id: "graceville_asv", file: "asv" },
    { id: "graceville_bbe", file: "bbe" },
    { id: "graceville_ylt", file: "ylt" },
    { id: "graceville_darby", file: "darby" }
]
const DEFAULT_BIBLE_ID = "graceville_kjv"

let started = false

export async function runGracevilleSetup() {
    if (started) return
    started = true

    // wait until the welcome popup (where the data folder is chosen) is closed
    while (get(activePopup) === "initialize") await wait(1000)

    try {
        if ((get(special).gracevilleSetup || 0) < SETUP_VERSION) await firstTimeSetup()
    } catch (err) {
        console.error("[Graceville] Setup failed:", err)
    }
}

async function firstTimeSetup() {
    const installed = await installBundledBibles()

    // choose KJV, unless a local Bible is already chosen (an online Bible cannot be used for listening)
    const activeId = get(drawerTabsData)?.scripture?.activeSubTab || ""
    const active = get(scriptures)[activeId]
    if ((!active || active.api) && get(scriptures)[DEFAULT_BIBLE_ID]) setActiveScripture(DEFAULT_BIBLE_ID)

    // Smart listening on, verses go up when the preacher clearly says them
    ai.update((a) => {
        a.enabled = true
        if (!a.scripture) a.scripture = {}
        if (!a.scripture.confidence || a.scripture.confidence === "ask") a.scripture.confidence = "highest"
        return a
    })

    if (!get(ai).stt?.micDeviceId) {
        try {
            const deviceId = await SpeechToText.resolveMicDeviceId("")
            if (deviceId) {
                ai.update((a) => {
                    if (!a.stt) a.stt = {}
                    a.stt.micDeviceId = deviceId
                    return a
                })
            }
        } catch (err) {
            console.warn("[Graceville] No microphone found yet:", err)
        }
    }

    activeDrawerTab.set("scripture")

    special.update((a) => ({ ...a, gracevilleSetup: SETUP_VERSION }))

    // write the new Bibles and settings to disk straight away
    save()

    if (installed) newToast(`${installed} Bibles installed`)
}

async function installBundledBibles(): Promise<number> {
    let installed = 0

    for (const { id, file } of BUNDLED_BIBLES) {
        if (get(scriptures)[id]) continue

        try {
            const response = await fetch(`./graceville/bibles/${file}.json`)
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const bible: Bible = await response.json()
            if (!bible?.books?.length) throw new Error("empty Bible file")

            scripturesCache.update((a) => {
                a[id] = bible
                return a
            })
            scriptures.update((a) => {
                a[id] = { name: bible.name, id }
                return a
            })
            installed++
        } catch (err) {
            console.error(`[Graceville] Could not install the ${file} Bible:`, err)
        }
    }

    return installed
}

function wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}
