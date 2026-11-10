// Graceville Fast Bible: how preachers at RCCG Graceville (Olive Tree Parish, Lagos) say Bible references.
//
// These steps run ONLY on the reference-detection path (e.g. "John 3:16"), never on the text used to
// recognise quoted verses, so they cannot make quote matching worse.
//
// Order inside BibleSearchDetector.search():
//   prepareSpokenReferences -> normalizeMishearings -> normalizeNumbers -> refineSpokenReferences -> normalizeReferences -> joinAdjacentVerses

import type { MatchResult } from "../../../../types/ai/Ai"
import type { BibleCacheData } from "../BibleCacheManager"
import { correctBookNames } from "./bookNames"
import { HUNDREDS_WORDS, ORDINAL_UNIT_WORDS, SPECIAL_COMPLEX_NUMBERS, TEEN_WORDS, TENS_WORDS, UNIT_WORDS } from "../numberDictionary"

// English number words stay numbers. Number words from the other supported languages are switched off,
// because many of them are everyday English or Yoruba words: "to" (Norwegian 2), "fire" (Norwegian 4),
// "ni" (Norwegian 9, a very common Yoruba word), "en", "sept", "elf", ...
const ENGLISH_NUMBER_WORDS = new Set(["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "hundred", "hundreds"])

export const FOREIGN_NUMBER_WORDS: string[] = [...new Set([UNIT_WORDS, TEEN_WORDS, TENS_WORDS, ORDINAL_UNIT_WORDS, HUNDREDS_WORDS, SPECIAL_COMPLEX_NUMBERS].flatMap((map) => Object.keys(map).map((word) => word.toLowerCase())))].filter((word) => !ENGLISH_NUMBER_WORDS.has(word)).sort((a, b) => b.length - a.length)

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// A trailing "_" keeps the word readable but stops it from matching any number rule.
const FOREIGN_NUMBER_REGEX = new RegExp(`(?<![\\p{L}\\p{N}_])(${FOREIGN_NUMBER_WORDS.map(escapeRegex).join("|")})(?![\\p{L}\\p{N}_])`, "giu")

/** Runs before mishearing and number normalization. */
export function prepareSpokenReferences(text: string): string {
    let prepared = text.toLowerCase()

    // "turn to John 3:16", "verses 5 to 6", "go back to verse 16": in English, "to" is never the number two
    prepared = prepared.replace(/(?<![\p{L}\p{N}_])to(?![\p{L}\p{N}_])/giu, "through")

    // Switch off number words from other languages
    prepared = prepared.replace(FOREIGN_NUMBER_REGEX, "$1_")

    // "1st Peter", "2nd Timothy", "3rd John", "the 23rd Psalm" -> plain numbers
    prepared = prepared.replace(/\b(\d+)\s*(?:st|nd|rd|th)\b/giu, "$1")

    // "the book of John" / "book of Romans" -> "John" / "Romans"
    prepared = prepared.replace(/\b(?:the\s+)?book\s+of\s+/giu, "")

    // "Songs of Solomon" -> "Song of Solomon"
    prepared = prepared.replace(/\bsongs\s+of\s+solomon\b/giu, "song of solomon")

    // "Revelations" -> "Revelation" (also handled by mishearings, kept here so the raw path works too)
    prepared = prepared.replace(/\brevelations\b/giu, "revelation")

    // "habukakh chapter 2 verse 3" -> "habakkuk chapter 2 verse 3" (only right before a chapter and verse)
    prepared = correctBookNames(prepared)

    return prepared
}

/** Runs after number normalization (all spoken numbers are digits now) and before normalizeReferences. */
export function refineSpokenReferences(text: string): string {
    let refined = text

    // "John 14 vs 6", "John 14 v. 6", "vv 5-6" -> "verse"
    refined = refined.replace(/\b(?:vs|vv|v)\.?\s*(?=\d)/giu, "verse ")

    // "John chapter 3 and verse 16" -> "John chapter 3 verse 16"
    refined = refined.replace(/\band\s+(?=verses?\s+\d)/giu, "")

    // "Romans chapter 8 from verse 28", "John 3 from 16 through 18", "read from verse 10" -> drop "from"
    refined = refined.replace(/\bfrom\s+(?=(?:verses?\s+)?\d)/giu, "")

    return refined
}

/**
 * Runs after normalizeReferences.
 * "Luke 4:18 and 19" / "verses 5 and 6" -> a range, but ONLY when the second verse directly follows the first.
 * "verses 5 and 9" are two separate verses, so only the first is kept.
 */
export function joinAdjacentVerses(text: string): string {
    const join = (match: string, start: string, first: string, second: string) => (Number(second) === Number(first) + 1 ? `${start}${first}-${second}` : match)

    let joined = text.replace(/(\d+:)(\d+)\s+and\s+(?:verses?\s+)?(\d+)\b/giu, join)
    joined = joined.replace(/(\bverses?\s+)(\d+)\s+and\s+(?:verses?\s+)?(\d+)\b/giu, join)
    // "Luke 4 18 and 19" (no colon spoken)
    joined = joined.replace(/(\b\p{L}+\s+\d+[\s,.]+)(\d+)\s+and\s+(?:verses?\s+)?(\d+)\b/giu, join)
    return joined
}

// -----

const CURRENT_REFERENCE_REGEX = /^((?:\d\s+)?[\p{L}\s]+?)\s+(\d+):(\d+)(?:-(\d+))?$/u

function parseCurrent(reference: string) {
    const match = reference?.trim().match(CURRENT_REFERENCE_REGEX)
    if (!match) return null
    return { book: match[1].trim(), chapter: Number(match[2]), verse: Number(match[4] || match[3]) }
}

/** "the next verse", "the following verse", "next verse please" -> the verse after the one on screen. */
export function findNextVerseRequest(text: string, currentlyOutputted: string | null | undefined, cacheData: BibleCacheData): MatchResult | null {
    if (!currentlyOutputted) return null

    const tail = text.toLowerCase().slice(-60)
    if (!/\b(?:next|following)\s+verse\b/u.test(tail)) return null

    const current = parseCurrent(currentlyOutputted)
    if (!current) return null

    const chapterData = cacheData.referenceIndex.get(`${current.book.toLowerCase()} ${current.chapter}`)
    const nextVerse = current.verse + 1
    if (!chapterData || nextVerse > chapterData.verseCount) return null

    return { type: "scripture", content: `${chapterData.bookName} ${chapterData.chapterNumber}:${nextVerse}`, confidence: AUTO_SHOW_CONFIDENCE }
}

// -----

// Graceville rule: a verse goes on screen automatically ONLY when the preacher said its number out loud
// and that verse exists in the Bible. Everything inferred waits for the media team to approve it.
// FreeShow's "Auto present: Highest" setting shows matches above 95.
export const AUTO_SHOW_CONFIDENCE = 96
export const MAX_SUGGESTION_CONFIDENCE = 90

/** True when the end of the text contains a spoken verse number such as "verse 17" or "verses 31-39". */
export function hasSpokenVerseNumber(text: string): boolean {
    return /\bverses?\s*\d+/iu.test(text.slice(-40))
}

/** A verse recognised only from quoted words can be wrong (many verses sound alike), so it is never auto-shown. */
export function capInferredConfidence(match: MatchResult | null): MatchResult | null {
    if (!match) return null
    if (match.scriptureMatchType === "content" && match.confidence > MAX_SUGGESTION_CONFIDENCE) {
        return { ...match, confidence: MAX_SUGGESTION_CONFIDENCE }
    }
    return match
}
