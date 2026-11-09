import { describe, expect, it } from "vitest"
import { BibleSearchDetector } from "../BibleSearchDetector"
import { findFollowTarget, isSameOrLessPrecise, type FollowTarget } from "./liveFollow"
import { buildTestCache } from "./testing/buildTestCache"

const cache = buildTestCache()
const follow = (said: string) => {
    const target = findFollowTarget(said, cache)
    if (!target) return null
    return [target.bookName, target.chapter, target.verse].filter((part) => part !== null).join(" ")
}

describe("live follow: the panel follows the preacher", () => {
    it.each([
        // as soon as the book is named
        ["let us go to jeremiah", "Jeremiah"],
        ["turn your bibles to the book of isaiah", "Isaiah"],
        ["open to first corinthians", "1 Corinthians"],
        ["psalms", "Psalms"],
        ["turn with me to romans", "Romans"],
        // then the chapter
        ["jeremiah chapter twenty nine", "Jeremiah 29"],
        ["jeremiah 29", "Jeremiah 29"],
        ["john chapter 3", "John 3"],
        ["psalm one hundred and twenty one", "Psalms 121"],
        // then the verse
        ["jeremiah chapter 29 verse 7", "Jeremiah 29 7"],
        ["john three sixteen", "John 3 16"],
        // from the Graceville test sermon
        ["i just want us to pray on prayer jeremiah twenty nine can you see", "Jeremiah 29"],
        ["jesus project jeremiah chapter twenty nine i just want us", "Jeremiah 29"]
    ])("%s -> %s", (said, expected) => {
        expect(follow(said)).toBe(expected)
    })

    it.each([
        "john said to the people", // a person, not the book (no chapter)
        "i love my job",
        "the acts of the apostles were great",
        "numbers do not lie",
        "john 45 years ago", // John has no chapter 45: not a reference
        "the weather is nice today"
    ])("does not move for: %s", (said) => {
        expect(follow(said)).toBe(null)
    })

    it("ignores a mention that is no longer recent", () => {
        const old = "jeremiah chapter 29 " + "and we prayed and we sang and we gave thanks to god for all he has done for us this year".repeat(1)
        expect(follow(old)).toBe(null)
    })

    it("uses the most recent mention", () => {
        expect(follow("romans 8 and then isaiah 40")).toBe("Isaiah 40")
    })

    it("knows the book numbers", () => {
        expect(findFollowTarget("jeremiah", cache)?.bookNumber).toBe(24)
        expect(findFollowTarget("revelation 12", cache)?.bookNumber).toBe(66)
    })

    it("works when the Bible names the book Psalm", () => {
        const psalmCache = buildTestCache({ Psalms: "Psalm" })
        expect(findFollowTarget("psalms 23", psalmCache)?.bookName).toBe("Psalm")
    })
})

describe("live follow never moves backwards", () => {
    const at = (bookNumber: number, chapter: number | null, verse: number | null): FollowTarget => ({ bookName: "", bookNumber, chapter, verse })

    it("stays when the same book or chapter is heard again", () => {
        expect(isSameOrLessPrecise(at(24, 29, 7), at(24, null, null))).toBe(true)
        expect(isSameOrLessPrecise(at(24, 29, 7), at(24, 29, null))).toBe(true)
        expect(isSameOrLessPrecise(at(24, 29, 7), at(24, 29, 7))).toBe(true)
    })

    it("moves for a new book, chapter or verse", () => {
        expect(isSameOrLessPrecise(at(24, 29, 7), at(23, null, null))).toBe(false)
        expect(isSameOrLessPrecise(at(24, 29, 7), at(24, 30, null))).toBe(false)
        expect(isSameOrLessPrecise(at(24, 29, 7), at(24, 29, 11))).toBe(false)
        expect(isSameOrLessPrecise(null, at(24, null, null))).toBe(false)
    })
})

describe("speed", () => {
    it("finds a spoken reference in a few milliseconds", async () => {
        const detector = new BibleSearchDetector(cache)
        const sentence = "i just want us to pray one prayer before we see that turn to jeremiah chapter twenty nine verse seven"

        // warm up
        await detector.search(sentence, "")
        findFollowTarget(sentence, cache)

        const runs = 200
        const start = performance.now()
        for (let i = 0; i < runs; i++) {
            await detector.search(sentence, "")
            findFollowTarget(sentence, cache)
        }
        const average = (performance.now() - start) / runs

        console.info(`[speed] reference + follow: ${average.toFixed(2)} ms per piece of speech`)
        expect(average).toBeLessThan(20)
    })
})
