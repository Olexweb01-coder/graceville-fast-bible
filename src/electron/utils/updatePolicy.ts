// Graceville Fast Bible: when is it safe to restart the app to install a downloaded update?
// Pure rules (no Electron), so they can be tested. Used by updater.ts.

export const IDLE_BEFORE_INSTALL_MS = 15 * 60 * 1000 // nothing on screen, no audio, no speech for 15 minutes
export const REPORT_MAX_AGE_MS = 3 * 60 * 1000 // the app reports every minute; older reports are not trusted

export interface UpdateState {
    downloadedVersion: string | null
    idleSince: number | null // when the app last became idle, null while busy
    lastReportAt: number // when the app last reported whether it is idle
    restarting: boolean
}

export function isChurchDay(date: Date): boolean {
    return date.getDay() === 0 // Sunday
}

export function shouldInstallNow(state: UpdateState, now: Date): boolean {
    if (!state.downloadedVersion || state.restarting) return false
    if (isChurchDay(now)) return false

    const time = now.getTime()
    if (time - state.lastReportAt > REPORT_MAX_AGE_MS) return false // no recent report: the app may be busy or frozen
    if (state.idleSince === null) return false

    return time - state.idleSince >= IDLE_BEFORE_INSTALL_MS
}

/** Applies one "is the app idle?" report. Any busy report resets the idle timer. */
export function applyIdleReport(state: UpdateState, idle: boolean, now: Date): UpdateState {
    const time = now.getTime()
    return {
        ...state,
        lastReportAt: time,
        idleSince: idle ? (state.idleSince ?? time) : null
    }
}
