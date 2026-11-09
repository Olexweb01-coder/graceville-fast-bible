import type { BibleCacheData } from "../../BibleCacheManager"
import { CHAPTER_PATTERN, ORDINAL_PREFIX_PATTERN, VERSE_PATTERN } from "../../referenceDictionary"
import { KJV_VERSE_COUNTS } from "./kjvVerseCounts"

/**
 * Builds the reference part of a Bible cache (book names, chapter index, reference regex)
 * the same way BibleCacheManager.buildCacheAsync does, without loading any verse text.
 *
 * `renameBooks` lets a test mimic Bibles that name books differently (e.g. "Psalm" instead of "Psalms").
 */
export function buildTestCache(renameBooks: Record<string, string> = {}): BibleCacheData {
    const referenceIndex: BibleCacheData["referenceIndex"] = new Map()
    const verseToIdMap: Map<string, number> = new Map()
    const versePool: string[] = []
    const bookNames: string[] = []
    const bookNumbers: Map<string, number> = new Map()

    for (const [originalName, chapters] of Object.entries(KJV_VERSE_COUNTS)) {
        const bookName = renameBooks[originalName] || originalName
        bookNames.push(bookName)
        bookNumbers.set(bookName.toLowerCase(), bookNames.length)

        chapters.forEach((verseCount, index) => {
            const chapterNumber = index + 1
            const startVerseId = versePool.length

            for (let verse = 1; verse <= verseCount; verse++) {
                const verseRef = `${bookName} ${chapterNumber}:${verse}`
                verseToIdMap.set(verseRef.toLowerCase(), versePool.length)
                versePool.push(verseRef)
            }

            referenceIndex.set(`${bookName.toLowerCase()} ${chapterNumber}`, { bookName, chapterNumber, startVerseId, verseCount })
        })
    }

    // Same expression as BibleCacheManager.buildCacheAsync (keep in sync)
    const bookPattern = bookNames.map((b) => b.replace(/\s+/g, "\\s+")).join("|")
    const refRegex = new RegExp(`\\b((?:(?:[1-3]|${ORDINAL_PREFIX_PATTERN})\\s+)?(?:${bookPattern}))\\b\\s*(?:${CHAPTER_PATTERN})?\\s*(\\d+)(?:[\\s,:.]+(?:${VERSE_PATTERN})?\\s*(\\d+)(?:\\s*[-–—]\\s*(\\d+))?)?`, "iu")

    return {
        versePool,
        verseToIdMap,
        referenceIndex,
        vocabPool: [],
        vocabToIdMap: new Map(),
        wordIdf: new Float32Array(),
        wordPostingsOffsets: new Uint32Array(1),
        wordPostings: new Uint32Array(),
        verseTokensOffsets: new Uint32Array(versePool.length + 1),
        verseTokens: new Uint32Array(),
        bookNames,
        bookNumbers,
        refRegex,
        totalVerses: versePool.length
    }
}
