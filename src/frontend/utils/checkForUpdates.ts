import { get } from "svelte/store"
import { activePopup, alertUpdates, isDev, popupData, special } from "./../stores"
import { GRACEVILLE_RELEASES_API } from "./graceville"

interface UpdateData {
    latestVersion: string
    changelog: string
    hasUpdate: boolean
}

export async function getUpdateData(currentVersion: string, includeBeta: boolean): Promise<UpdateData> {
    // Graceville: check our own releases, never FreeShow's
    const response = await fetch(GRACEVILLE_RELEASES_API)
    const data = await response.json()
    if (!Array.isArray(data)) return { latestVersion: "", changelog: "", hasUpdate: false }

    const latestAll = data.filter((a: any) => a.draft === false)[0]
    const latestRelease = data.filter((a: any) => a.draft === false && a.prerelease === false)[0]

    const latestVersionAll = latestAll?.tag_name?.slice(1) || ""
    const latestVersionStable = latestRelease?.tag_name?.slice(1) || latestVersionAll
    const latestVersion = includeBeta ? latestVersionAll : latestVersionStable
    const changelog = includeBeta ? latestAll?.body || "" : latestRelease?.body || latestAll?.body || ""

    return {
        latestVersion,
        changelog,
        hasUpdate: !!latestVersion && currentVersion !== latestVersion
    }
}

// Graceville: updates install silently when the app is closed (see src/electron/utils/updater.ts), so no popup
const GRACEVILLE_UPDATE_POPUP = false

export function checkForUpdates(currentVersion: string) {
    if (!GRACEVILLE_UPDATE_POPUP || get(isDev) || get(alertUpdates) === false) return
    const includeBeta = currentVersion.includes("-beta") || get(special).betaVersionAlert

    getUpdateData(currentVersion, includeBeta)
        .then(({ latestVersion, changelog, hasUpdate }) => {
            if (get(activePopup) !== null) return
            if (!hasUpdate) return

            popupData.set({ changelog, latestVersion })
            activePopup.set("new_update")
        })
        .catch((error) => {
            console.warn(error)
        })
}
