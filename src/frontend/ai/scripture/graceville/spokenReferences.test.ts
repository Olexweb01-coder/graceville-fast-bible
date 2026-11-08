import { describe, expect, it } from "vitest"
import { BibleSearchDetector } from "../BibleSearchDetector"
import { normalizeNumbers } from "../numbers"
import { AUTO_SHOW_CONFIDENCE, capInferredConfidence, FOREIGN_NUMBER_WORDS, joinAdjacentVerses, MAX_SUGGESTION_CONFIDENCE, prepareSpokenReferences, refineSpokenReferences } from "./spokenReferences"
import { buildTestCache } from "./testing/buildTestCache"

// FreeShow's "Auto present: Highest" setting shows a verse only when its confidence is above this value
const AUTO_THRESHOLD = 95

type Case = { said: string; onScreen?: string }

// The preacher said a complete reference that exists: it must go on screen automatically.
const AUTO: [string, string, string?][] = [
    ["turn your bible to john chapter 3 verse 16", "John 3:16"],
    ["john three sixteen", "John 3:16"],
    ["john 3 16", "John 3:16"],
    ["first corinthians chapter 13 from verse 4", "1 Corinthians 13:4"],
    ["1st corinthians 13 verse 4", "1 Corinthians 13:4"],
    ["one corinthians 13 4", "1 Corinthians 13:4"],
    ["second timothy 2 15", "2 Timothy 2:15"],
    ["2nd timothy chapter 2 verse 15", "2 Timothy 2:15"],
    ["psalm 91 verse 1", "Psalms 91:1"],
    ["psalms chapter 91 verse 1", "Psalms 91:1"],
    ["psalm 23 1", "Psalms 23:1"],
    ["psalms 46 10", "Psalms 46:10"],
    ["psalm 121 verse 1 to 8", "Psalms 121:1-8"],
    ["psalm one hundred and nineteen verse one hundred and five", "Psalms 119:105"],
    ["romans eight twenty eight", "Romans 8:28"],
    ["let's go to romans chapter 8 from verse 28", "Romans 8:28"],
    ["romans 10 9 and 10", "Romans 10:9-10"],
    ["philippians 4 13", "Philippians 4:13"],
    ["philippians 4 6 and 7", "Philippians 4:6-7"],
    ["isaiah 53 verse 5", "Isaiah 53:5"],
    ["isaiah forty verse thirty one", "Isaiah 40:31"],
    ["isaiah 61 1 to 3", "Isaiah 61:1-3"],
    ["proverbs 3 5 to 6", "Proverbs 3:5-6"],
    ["proverbs chapter 3 verse 5 to 6", "Proverbs 3:5-6"],
    ["proverbs chapter 3 verses 5 and 6", "Proverbs 3:5-6"],
    ["matthew 6 33", "Matthew 6:33"],
    ["jeremiah 29 11", "Jeremiah 29:11"],
    ["hebrews 11 verse 1", "Hebrews 11:1"],
    ["first john 1 9", "1 John 1:9"],
    ["first john chapter one verse nine", "1 John 1:9"],
    ["turn your bibles to first john 1 9", "1 John 1:9"],
    ["third john verse 2", "3 John 1:2"],
    ["jude verse 24", "Jude 1:24"],
    ["jude 1 24", "Jude 1:24"],
    ["philemon verse 6", "Philemon 1:6"],
    ["philemon 1 6", "Philemon 1:6"],
    ["song of solomon 2 15", "Song of Solomon 2:15"],
    ["songs of solomon chapter 2 verse 15", "Song of Solomon 2:15"],
    ["lamentations 3 22 to 23", "Lamentations 3:22-23"],
    ["deuteronomy 28 verse 13", "Deuteronomy 28:13"],
    ["habakkuk 2 2", "Habakkuk 2:2"],
    ["revelation 12 11", "Revelation 12:11"],
    ["revelations 12 verse 11", "Revelation 12:11"],
    ["first samuel 17 45", "1 Samuel 17:45"],
    ["second chronicles 7 14", "2 Chronicles 7:14"],
    ["first thessalonians 5 17", "1 Thessalonians 5:17"],
    ["1st peter 5 7", "1 Peter 5:7"],
    ["2nd corinthians 5 17", "2 Corinthians 5:17"],
    ["john chapter 3 and verse 16", "John 3:16"],
    ["verse 16 of john chapter 3", "John 3:16"],
    ["the book of john chapter 3 verse 16", "John 3:16"],
    ["luke 4 18 and 19", "Luke 4:18-19"],
    ["mark 16 verses 15 to 18", "Mark 16:15-18"],
    ["ephesians 6 from verse 10", "Ephesians 6:10"],
    ["galatians chapter 2 verse 20", "Galatians 2:20"],
    ["first kings 18 21", "1 Kings 18:21"],
    ["joel 2 25", "Joel 2:25"],
    ["acts 1 8", "Acts 1:8"],
    ["john 14 vs 6", "John 14:6"],
    ["john 14 v 6", "John 14:6"],
    ["john 3 16 to 18", "John 3:16-18"],
    ["john 3 from 16 to 18", "John 3:16-18"],
    ["ezekiel 37 verse 1 to 10", "Ezekiel 37:1-10"],
    ["exodus 14 14", "Exodus 14:14"],
    ["joshua 1 verse 8 and 9", "Joshua 1:8-9"],
    // traps found while testing: these used to show the WRONG verse
    ["turn to john 1 verse 9", "John 1:9"], // was "2 John 1:9" ("to" read as the number two)
    ["jesu ni oluwa, john 3 16", "John 3:16"], // Yoruba "ni" must not become the number 9
    ["john 3 16 to 45", "John 3:16"], // John 3 has 36 verses: the impossible range end is dropped
    ["not verse 16, i mean john 3 17", "John 3:17"], // the last reference spoken wins
    // follow-ups while a verse is on screen
    ["verse 17", "John 3:17", "John 3:16"],
    ["let us read verse 31 to 39", "Romans 8:31-39", "Romans 8:28"],
    ["the next verse", "John 3:17", "John 3:16"],
    ["go back to verse 16", "John 3:16", "John 3:18"],
    ["verses 5 and 9", "Proverbs 3:5", "Proverbs 3:4"]
]

// A chapter was named without a verse: offer it as a suggestion, never auto-show.
const SUGGEST: [string, string][] = [
    ["psalms 23", "Psalms 23:1"],
    ["psalm one hundred and twenty one", "Psalms 121:1"],
    ["psalm 23 for the lord is my shepherd", "Psalms 23:1"], // was Psalm 23:4 ("for" heard as "four")
    ["the holy ghost fire fell in acts 2", "Acts 2:1"] // "fire" must not become the number 4
]

// Nothing must be shown automatically.
const NOTHING: string[] = ["john 3 45", "jude 2 3", "psalm 151 verse 1", "in the year 2026 we will rise", "i have told you 3 times", "the fire of god is falling", "god is too faithful to fail"]

function run(detectorBookStyle: "Psalms" | "Psalm") {
    const cache = buildTestCache(detectorBookStyle === "Psalm" ? { Psalms: "Psalm" } : {})
    const detector = new BibleSearchDetector(cache)
    const fix = (ref: string) => ref.replace(/^Psalms\b/, detectorBookStyle)
    const search = ({ said, onScreen }: Case) => detector.search(said, onScreen || "")

    describe(`Bible names the book "${detectorBookStyle}"`, () => {
        it.each(AUTO)("auto-shows: %s", async (said, expected, onScreen) => {
            const result = await search({ said, onScreen })
            expect(result?.content).toBe(fix(expected))
            expect(result!.confidence).toBeGreaterThan(AUTO_THRESHOLD)
        })

        it.each(SUGGEST)("suggests only: %s", async (said, expected) => {
            const result = await search({ said })
            expect(result?.content).toBe(fix(expected))
            expect(result!.confidence).toBeLessThanOrEqual(AUTO_THRESHOLD)
        })

        it.each(NOTHING)("shows nothing automatically: %s", async (said) => {
            const result = await search({ said })
            expect(result === null || result.confidence <= AUTO_THRESHOLD).toBe(true)
        })
    })
}

run("Psalms")
run("Psalm")

describe("speech preparation", () => {
    it("never turns English 'to' into the number two", () => {
        expect(normalizeNumbers(prepareSpokenReferences("turn to john"))).toBe("turn through john")
        expect(normalizeNumbers(prepareSpokenReferences("verses five to six"))).toBe("verses 5-6")
    })

    it("switches off number words from other languages but keeps English ones", () => {
        expect(normalizeNumbers(prepareSpokenReferences("holy ghost fire"))).toBe("holy ghost fire_")
        expect(normalizeNumbers(prepareSpokenReferences("jesu ni oluwa"))).toBe("jesu ni_ oluwa")
        expect(normalizeNumbers(prepareSpokenReferences("one two three twenty one first"))).toBe("1 2 3 21 1")
        expect(FOREIGN_NUMBER_WORDS).not.toContain("one")
        expect(FOREIGN_NUMBER_WORDS).toContain("fire")
    })

    it("understands Nigerian ways of naming books and verses", () => {
        expect(prepareSpokenReferences("1st Peter")).toBe("1 peter")
        expect(prepareSpokenReferences("the 23rd psalm")).toBe("the 23 psalm")
        expect(prepareSpokenReferences("the book of Romans")).toBe("romans")
        expect(prepareSpokenReferences("Songs of Solomon")).toBe("song of solomon")
        expect(refineSpokenReferences("john 14 vs 6")).toBe("john 14 verse 6")
        expect(refineSpokenReferences("john chapter 3 and verse 16")).toBe("john chapter 3 verse 16")
        expect(refineSpokenReferences("romans 8 from verse 28")).toBe("romans 8 verse 28")
    })

    it("joins 'and' into a range only for neighbouring verses", () => {
        expect(joinAdjacentVerses("John 3:16 and 17")).toBe("John 3:16-17")
        expect(joinAdjacentVerses("John 3:16 and 18")).toBe("John 3:16 and 18")
        expect(joinAdjacentVerses("Genesis 1 and 2")).toBe("Genesis 1 and 2")
    })
})

describe("auto-show rule", () => {
    it("never auto-shows a verse recognised only from quoted words", () => {
        const capped = capInferredConfidence({ type: "scripture", content: "John 3:16", confidence: 98, scriptureMatchType: "content" })
        expect(capped!.confidence).toBe(MAX_SUGGESTION_CONFIDENCE)
        expect(MAX_SUGGESTION_CONFIDENCE).toBeLessThanOrEqual(AUTO_THRESHOLD)
    })

    it("leaves spoken references untouched", () => {
        const reference = capInferredConfidence({ type: "scripture", content: "John 3:16", confidence: 98 })
        expect(reference!.confidence).toBe(98)
        expect(AUTO_SHOW_CONFIDENCE).toBeGreaterThan(AUTO_THRESHOLD)
    })
})
