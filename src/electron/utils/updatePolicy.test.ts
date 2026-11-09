import { describe, expect, it } from "vitest"
import { applyIdleReport, IDLE_BEFORE_INSTALL_MS, shouldInstallNow, type UpdateState } from "./updatePolicy"

const MONDAY_10AM = new Date(2026, 10, 9, 10, 0, 0) // Monday 9 November 2026
const SUNDAY_10AM = new Date(2026, 10, 8, 10, 0, 0) // Sunday 8 November 2026
const minutes = (date: Date, count: number) => new Date(date.getTime() + count * 60 * 1000)

const fresh: UpdateState = { downloadedVersion: "2026.11.700", idleSince: null, lastReportAt: 0, restarting: false }

/** Simulates the app reporting once a minute. */
function reportEveryMinute(state: UpdateState, start: Date, reports: boolean[]) {
    reports.forEach((idle, index) => (state = applyIdleReport(state, idle, minutes(start, index))))
    return state
}

describe("safe self-update install", () => {
    it("installs after 15 idle minutes on a weekday", () => {
        const state = reportEveryMinute(fresh, MONDAY_10AM, Array(16).fill(true))
        expect(shouldInstallNow(state, minutes(MONDAY_10AM, 15))).toBe(true)
    })

    it("waits while idle for less than 15 minutes", () => {
        const state = reportEveryMinute(fresh, MONDAY_10AM, Array(14).fill(true))
        expect(shouldInstallNow(state, minutes(MONDAY_10AM, 13))).toBe(false)
    })

    it("never installs on a Sunday", () => {
        const state = reportEveryMinute(fresh, SUNDAY_10AM, Array(120).fill(true))
        expect(shouldInstallNow(state, minutes(SUNDAY_10AM, 119))).toBe(false)
    })

    it("restarts the 15 minutes whenever something is shown, played or said", () => {
        const reports = [...Array(14).fill(true), false, ...Array(10).fill(true)]
        const state = reportEveryMinute(fresh, MONDAY_10AM, reports)
        expect(shouldInstallNow(state, minutes(MONDAY_10AM, reports.length - 1))).toBe(false)
    })

    it("does nothing when the app stopped reporting (busy or frozen)", () => {
        const state = reportEveryMinute(fresh, MONDAY_10AM, Array(16).fill(true))
        expect(shouldInstallNow(state, minutes(MONDAY_10AM, 15 + 5))).toBe(false)
    })

    it("does nothing without a downloaded update, or while already restarting", () => {
        const idle = reportEveryMinute(fresh, MONDAY_10AM, Array(16).fill(true))
        expect(shouldInstallNow({ ...idle, downloadedVersion: null }, minutes(MONDAY_10AM, 15))).toBe(false)
        expect(shouldInstallNow({ ...idle, restarting: true }, minutes(MONDAY_10AM, 15))).toBe(false)
    })

    it("uses exactly 15 minutes", () => {
        expect(IDLE_BEFORE_INSTALL_MS).toBe(15 * 60 * 1000)
    })
})
