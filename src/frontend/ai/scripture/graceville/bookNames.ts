// Graceville Fast Bible: fixes Bible book names the speech engine heard slightly wrong.
//
// "habukakh chapter 2 verse 3" -> "habakkuk chapter 2 verse 3", "first corindians 13 4" -> "first corinthians 13 4",
// "look at such a riah chapter 4" -> "look at zechariah chapter 4".
//
// To never turn ordinary words into a book, a word is only replaced when ALL of this is true:
//   - it sounds almost the same as a book name (at most 30% different after a simple sound-alike spelling)
//   - it is directly followed by "chapter" or by a number, AND the reference has at least two numbers or "chapter"
//     ("romans eight twenty eight", "zechariah chapter four") - "the woman's twenty two" stays as it is
//   - it is not a short book name (Job, Mark, Acts...) or a book named like an everyday word (Numbers, Judges, Kings,
//     James), which must be heard exactly

import { normalizeNumbers } from "../numbers"

const BOOKS = ["genesis", "exodus", "leviticus", "deuteronomy", "joshua", "samuel", "chronicles", "nehemiah", "esther", "psalms", "proverbs", "ecclesiastes", "isaiah", "jeremiah", "lamentations", "ezekiel", "daniel", "hosea", "obadiah", "jonah", "micah", "nahum", "habakkuk", "zephaniah", "haggai", "zechariah", "malachi", "matthew", "romans", "corinthians", "galatians", "ephesians", "philippians", "colossians", "thessalonians", "timothy", "titus", "philemon", "hebrews", "peter", "revelation"]

// sound-alike spelling: "zechariah" and "satchariah" both become close to "sekaria"
export function soundAlike(word: string): string {
    return word
        .toLowerCase()
        .replace(/[^a-z]/g, "")
        .replace(/ph/g, "f")
        .replace(/th/g, "t")
        .replace(/tch/g, "k")
        .replace(/ch/g, "k")
        .replace(/kh/g, "k")
        .replace(/ck/g, "k")
        .replace(/c(?=[eiy])/g, "s")
        .replace(/[cq]/g, "k")
        .replace(/z/g, "s")
        .replace(/x/g, "ks")
        .replace(/y/g, "i")
        .replace(/h$/, "")
        .replace(/(.)\1+/g, "$1")
}

const BOOK_SOUNDS = BOOKS.map((book) => ({ book, sound: soundAlike(book) }))

export function distance(a: string, b: string): number {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i++) {
        let previous = row[0]
        row[0] = i
        for (let j = 1; j <= b.length; j++) {
            const current = row[j]
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
            previous = current
        }
    }
    return row[b.length]
}

const MAX_DIFFERENCE = 0.3
const MIN_SOUND_LENGTH = 5

/** The book a spoken word (or 2-3 words) sounds like, or null. */
export function closestBook(words: string): string | null {
    const sound = soundAlike(words)
    if (sound.length < MIN_SOUND_LENGTH) return null

    let best: { book: string; score: number } | null = null
    for (const { book, sound: bookSound } of BOOK_SOUNDS) {
        const score = distance(sound, bookSound) / Math.max(sound.length, bookSound.length)
        if (score <= MAX_DIFFERENCE && (!best || score < best.score)) best = { book, score }
    }
    return best?.book || null
}

const NUMBER_WORDS = new Set(["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred"])
const isNumberWord = (word: string) => /^\d+$/.test(word) || NUMBER_WORDS.has(word)

// words that never start a misheard book name
const NOT_A_BOOK_START = new Set(["the", "to", "a", "an", "at", "in", "on", "and", "of", "is", "for", "from", "go", "read", "let", "us", "me", "my", "your", "our", "look", "turn", "open", "chapter", "chapters", "verse", "verses", "through", "first", "second", "third", "book", "with", "that", "this", "it"])
const KNOWN_WORDS = new Set([...BOOKS, "numbers", "judges", "kings", "james", "psalm", "song", "solomon", "job", "joel", "amos", "ruth", "mark", "luke", "john", "acts", "jude", "ezra"])

/** True when the words after a possible book name are a real reference: "chapter ..." or at least two numbers. */
function looksLikeReference(after: string[]): boolean {
    if (!after.length) return false
    if (after[0] === "chapter") return true
    if (!isNumberWord(after[0])) return false

    const numbers = normalizeNumbers(after.slice(0, 8).join(" ")).match(/\d+/g) || []
    return numbers.length >= 2
}

export function correctBookNames(text: string): string {
    const words = text.split(/\s+/).filter(Boolean)
    const clean = words.map((word) => word.toLowerCase().replace(/[^a-z0-9']/g, ""))

    for (let end = 0; end < words.length; end++) {
        if (!looksLikeReference(clean.slice(end + 1))) continue
        if (KNOWN_WORDS.has(clean[end]) || isNumberWord(clean[end])) continue

        let best: { start: number; book: string; score: number } | null = null
        for (let size = 1; size <= 3; size++) {
            const start = end - size + 1
            if (start < 0) break
            const span = clean.slice(start, end + 1)
            if (NOT_A_BOOK_START.has(span[0]) || span.some((word) => !word || isNumberWord(word) || KNOWN_WORDS.has(word))) continue

            const book = closestBook(span.join(""))
            if (!book) continue
            const score = distance(soundAlike(span.join("")), soundAlike(book))
            if (!best || score < best.score) best = { start, book, score }
        }

        if (best) {
            words.splice(best.start, end - best.start + 1, best.book)
            clean.splice(best.start, end - best.start + 1, best.book)
            end = best.start
        }
    }

    return words.join(" ")
}
