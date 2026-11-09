// Graceville Fast Bible: silent self-updates.
//
// - Looks for new versions on this project's own GitHub Releases (set in config/building/graceville-builder.yaml),
//   never FreeShow's.
// - Downloads quietly in the background. Only the changed parts are downloaded after the first update.
// - Installs ONLY when the app is closed, so it can never interrupt a service. No popups, nothing to click.
// - Never downloads on a Sunday, so a service's internet (e.g. the livestream) is never slowed down.

import { app } from "electron"
import { autoUpdater } from "electron-updater"

const FIRST_CHECK_DELAY_MS = 3 * 60 * 1000 // let the app settle after opening
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // check again every 6 hours while open

let started = false

export function startGracevilleUpdates() {
    // only the installed app can update itself (not development or test runs)
    if (started || !app.isPackaged) return
    started = true

    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false
    autoUpdater.allowDowngrade = false
    autoUpdater.logger = console

    autoUpdater.on("update-downloaded", (info) => console.info(`[Graceville] Update ${info.version} downloaded. It will install when the app is closed.`))
    autoUpdater.on("error", (err) => console.warn("[Graceville] Update check failed (will retry later):", err?.message || err))

    setTimeout(checkQuietly, FIRST_CHECK_DELAY_MS)
    setInterval(checkQuietly, CHECK_INTERVAL_MS)
}

async function checkQuietly() {
    if (new Date().getDay() === 0) return // Sunday: never use the church's internet for updates

    try {
        await autoUpdater.checkForUpdates()
    } catch (err) {
        console.warn("[Graceville] Update check failed (will retry later):", err)
    }
}

// The settings toggle "Auto updates" still calls this; updates are always on and silent in Graceville.
export default function checkForUpdates() {
    startGracevilleUpdates()
}
