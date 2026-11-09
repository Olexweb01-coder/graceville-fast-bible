// Graceville Fast Bible: identity, credits and update location.

export const GRACEVILLE_APP_NAME = "Graceville Fast Bible"

// Developer credit (shown in Settings, the welcome screen and About)
export const GRACEVILLE_DEVELOPER = "Olexweb"
export const GRACEVILLE_DEVELOPER_URL = "https://olexweb.com"

// Required credit: this app is built on FreeShow (GPL-3.0)
export const FREESHOW_SOURCE_URL = "https://github.com/ChurchApps/FreeShow"

// Where this app looks for its own updates.
// Never FreeShow's releases: installing those would replace Graceville's changes with the original app.
const GRACEVILLE_REPOSITORY = "Olexweb01-coder/graceville-fast-bible"

export const GRACEVILLE_REPOSITORY_URL = `https://github.com/${GRACEVILLE_REPOSITORY}`
export const GRACEVILLE_RELEASES_API = `https://api.github.com/repos/${GRACEVILLE_REPOSITORY}/releases`
export const GRACEVILLE_RELEASES_PAGE = `https://github.com/${GRACEVILLE_REPOSITORY}/releases`

/** Shows the app's own name in every translated text ("Welcome to FreeShow" -> "Welcome to Graceville Fast Bible"). */
export function brandTranslations<T extends Record<string, Record<string, string>>>(messages: T): T {
    for (const group of Object.values(messages || {})) {
        if (!group || typeof group !== "object") continue
        for (const [key, value] of Object.entries(group)) {
            if (typeof value === "string" && value.includes("FreeShow")) group[key] = value.replaceAll("FreeShow", GRACEVILLE_APP_NAME)
        }
    }
    return messages
}
