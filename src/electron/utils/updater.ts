// Graceville Fast Bible: silent self-updates.
//
// - Looks for new versions on this project's own GitHub Releases (set in config/building/graceville-builder.yaml),
//   never FreeShow's.
// - Downloads quietly in the background. Only the changed parts are downloaded after the first update.
// - Installs by itself while the app is open, but ONLY when it is safe (see updatePolicy.ts): nothing on any screen,
//   no audio, no speech heard for 15 minutes, and never on a Sunday. The app saves everything, closes, installs
//   silently and reopens. No popups, nothing to click.
// - If it is never safe while open, the update installs when the app is closed.
// - Never downloads on a Sunday, so a service's internet (e.g. the livestream) is never slowed down.

import { app } from "electron"
import { autoUpdater } from "electron-updater"
import { Main } from "../../types/IPC/Main"
import { sendMain } from "../IPC/main"
import { applyIdleReport, isChurchDay, shouldInstallNow, type UpdateState } from "./updatePolicy"

const FIRST_CHECK_DELAY_MS = 3 * 60 * 1000 // let the app settle after opening
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // check for new versions every 6 hours while open
const SAFETY_CHECK_INTERVAL_MS = 60 * 1000 // check every minute whether it is safe to install
const RESTART_GIVE_UP_MS = 5 * 60 * 1000 // if closing did not happen, try again later

let started = false
let state: UpdateState = { downloadedVersion: null, idleSince: null, lastReportAt: 0, restarting: false }

export function startGracevilleUpdates() {
    // only the installed app can update itself (not development or test runs)
    if (started || !app.isPackaged) return
    started = true

    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false
    autoUpdater.allowDowngrade = false
    autoUpdater.logger = console

    autoUpdater.on("update-downloaded", (info) => {
        state = { ...state, downloadedVersion: info.version }
        console.info(`[Graceville] Update ${info.version} downloaded. It installs when the app is idle or closed.`)
    })
    autoUpdater.on("error", (err) => console.warn("[Graceville] Update failed (will retry later):", err?.message || err))

    setTimeout(checkQuietly, FIRST_CHECK_DELAY_MS)
    setInterval(checkQuietly, CHECK_INTERVAL_MS)
    setInterval(installIfSafe, SAFETY_CHECK_INTERVAL_MS)
}

async function checkQuietly() {
    if (isChurchDay(new Date())) return // never use the church's internet for updates on a Sunday

    try {
        await autoUpdater.checkForUpdates()
    } catch (err) {
        console.warn("[Graceville] Update check failed (will retry later):", err)
    }
}

/** The app reports once a minute whether it is idle (nothing on screen, no audio, no speech). */
export function reportIdle(idle: boolean) {
    state = applyIdleReport(state, idle, new Date())
}

function installIfSafe() {
    if (!shouldInstallNow(state, new Date())) return

    state = { ...state, restarting: true }
    console.info(`[Graceville] App is idle: saving, closing and installing update ${state.downloadedVersion}.`)

    // the normal "save and close" path: saves everything, closes outputs, then calls exitApp()
    sendMain(Main.CLOSE, true)

    setTimeout(() => (state = { ...state, restarting: false }), RESTART_GIVE_UP_MS)
}

/** Called by exitApp() instead of app.quit(). Returns true when it took over quitting to install the update. */
export function installUpdateInsteadOfQuit(): boolean {
    if (!state.restarting || !state.downloadedVersion) return false

    // silent install, then reopen the app on the new version
    autoUpdater.quitAndInstall(true, true)
    return true
}

// The settings toggle "Auto updates" and the idle reports both arrive here.
export default function checkForUpdates(data?: { idle: boolean } | void) {
    startGracevilleUpdates()
    if (data && typeof data.idle === "boolean") reportIdle(data.idle)
}
