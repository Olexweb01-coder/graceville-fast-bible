// Graceville Fast Bible: "live follow". The Scripture panel follows the preacher while he is still speaking:
//   "Jeremiah"            -> the panel opens Jeremiah
//   "Jeremiah chapter 29" -> the panel opens Jeremiah 29
//   "... verse 7"         -> the panel selects verse 7 (whether it also goes on screen is decided by Auto present)
// This only moves the media team's panel. It never puts anything on the projector.

import type { BibleCacheData } from "../BibleCacheManager"
import { normalizeMishearings } from "../mishearings"
import { normalizeNumbers } from "../numbers"
import { prepareSpokenReferences, refineSpokenReferences } from "./spokenReferences"

export interface FollowTarget {
    bookName: string
    bookNumber: number
    chapter: number | null
    verse: number | null
}

// Only mentions among the most recent words count, so an old mention never pulls the panel back.
const RECENT_WORDS = 15

// Books that are also everyday words or people's names ("John said", "my job", "the acts of the apostles").
// For these the panel only moves once a chapter number is heard ("John 3").
const NAME_LIKE_BOOKS = new Set(["john", "james", "mark", "luke", "matthew", "job", "acts", "numbers", "judges", "ruth", "esther", "daniel", "jonah", "joel", "amos", "micah", "hosea", "nahum", "jude", "titus", "philemon", "joshua", "ezra", "nehemiah"])

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const bookRegexCache = new WeakMap<BibleCacheData, RegExp>()
function getBookRegex(cacheData: BibleCacheData): RegExp {
    const cached = bookRegexCache.get(cacheData)
    if (cached) return cached

    const names = new Set(cacheData.bookNames.map((name) => name.toLowerCase()))
    if ([...names].some((name) => /^psalms?$/.test(name))) {
        names.add("psalm")
        names.add("psalms")
    }

    // longest first, so "1 john" wins over "john"
    const pattern = [...names]
        .sort((a, b) => b.length - a.length)
        .map((name) => escapeRegex(name).replace(/\s+/g, "\\s+"))
        .join("|")

    // book, then optionally "chapter 29", then optionally a verse ("29 7", "29 verse 7", "29:7")
    const regex = new RegExp(`(?<![\\p{L}\\d])(${pattern})(?![\\p{L}])(?:\\s+(?:chapter\\s+)?(\\d+)(?:(?:\\s*[:.,]\\s*|\\s+)(?:verses?\\s+)?(\\d+))?)?`, "giu")
    bookRegexCache.set(cacheData, regex)
    return regex
}

function resolveBookName(spoken: string, cacheData: BibleCacheData): string | null {
    const lower = spoken.toLowerCase().replace(/\s+/g, " ")
    const exact = cacheData.bookNames.find((name) => name.toLowerCase() === lower)
    if (exact) return exact
    if (/^psalms?$/.test(lower)) return cacheData.bookNames.find((name) => /^psalms?$/i.test(name.trim())) || null
    return null
}

/** Prepares spoken text the same way as reference detection (numbers as digits, "to" never read as two). */
export function prepareForFollow(transcript: string): string {
    return refineSpokenReferences(normalizeNumbers(normalizeMishearings(prepareSpokenReferences(transcript))))
}

/** Finds the book / chapter / verse the preacher is naming right now, or null. */
export function findFollowTarget(transcript: string, cacheData: BibleCacheData): FollowTarget | null {
    const text = prepareForFollow(transcript)
    const regex = getBookRegex(cacheData)
    regex.lastIndex = 0

    let last: RegExpExecArray | null = null
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) last = match
    if (!last) return null

    // must be among the most recent words
    const wordsAfter = text
        .slice(last.index + last[0].length)
        .split(/\s+/)
        .filter(Boolean).length
    if (wordsAfter > RECENT_WORDS) return null

    const bookName = resolveBookName(last[1], cacheData)
    if (!bookName) return null
    const bookNumber = cacheData.bookNumbers?.get(bookName.toLowerCase())
    if (!bookNumber) return null

    const chapter = last[2] ? Number(last[2]) : null
    let verse = last[3] ? Number(last[3]) : null

    if (chapter === null) {
        if (NAME_LIKE_BOOKS.has(bookName.toLowerCase())) return null
        return { bookName, bookNumber, chapter: null, verse: null }
    }

    const chapterData = cacheData.referenceIndex.get(`${bookName.toLowerCase()} ${chapter}`)
    if (!chapterData) return null // "John 45" is not a chapter: probably not a reference at all

    if (verse !== null && (verse < 1 || verse > chapterData.verseCount)) verse = null

    return { bookName, bookNumber, chapter, verse }
}

/** True when moving from `previous` to `next` adds nothing (same place, or less precise for the same book). */
export function isSameOrLessPrecise(previous: FollowTarget | null, next: FollowTarget): boolean {
    if (!previous || previous.bookNumber !== next.bookNumber) return false
    if (next.chapter === null) return true // already in this book (maybe deeper)
    if (previous.chapter !== next.chapter) return false
    if (next.verse === null) return true // already in this chapter (maybe at a verse)
    return previous.verse === next.verse
}
