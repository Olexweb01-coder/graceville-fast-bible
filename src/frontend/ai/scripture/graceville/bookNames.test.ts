import { describe, expect, it } from "vitest"
import { BibleSearchDetector } from "../BibleSearchDetector"
import { correctBookNames } from "./bookNames"
import { buildTestCache } from "./testing/buildTestCache"

// what the speech engines really wrote for clearly spoken references (light and full engine)
const MISHEARD: [string, string][] = [
    ["habukakh chapter two verse three says the vision", "Habakkuk 2:3"],
    ["habukuk chapter two verse three", "Habakkuk 2:3"],
    ["habakuk chapter two verse three", "Habakkuk 2:3"],
    ["first corindians thirteen verse four", "1 Corinthians 13:4"],
    ["first kore indians thirteen verse four", "1 Corinthians 13:4"],
    ["the book of ecclesiasts chapter three verse one", "Ecclesiastes 3:1"],
    ["the book of ecclesiast chapter three verse one", "Ecclesiastes 3:1"],
    ["look at satchariah chapter four verse six", "Zechariah 4:6"],
    ["look at sachariah chapter four verse six", "Zechariah 4:6"],
    ["look at sicheria chapter four verse six", "Zechariah 4:6"],
    ["look at such a riah chapter four verse six", "Zechariah 4:6"],
    ["look at cechariah chapter four verse six", "Zechariah 4:6"],
    ["look at setchariah chapter four verse six, not by might", "Zechariah 4:6"],
    ["nahemiah chapter eight verse ten", "Nehemiah 8:10"],
    ["lumitations three verse twenty two", "Lamentations 3:22"],
    ["limitations three verse twenty two", "Lamentations 3:22"],
    ["let us read jeuteronomy chapter twenty eight from verse one", "Deuteronomy 28:1"],
    ["let us read juderonomy chapter twenty eight from verse one", "Deuteronomy 28:1"],
    ["jeremia chapter twenty nine verse eleven", "Jeremiah 29:11"],
    ["philipians four thirteen", "Philippians 4:13"],
    ["galations five twenty two", "Galatians 5:22"],
    ["ephesions six eleven", "Ephesians 6:11"],
    ["mathew six thirty three", "Matthew 6:33"]
]

// ordinary speech that must stay exactly as it was said
const UNCHANGED = ["the woman's twenty two children", "number two and three", "these things two three", "the names two and three", "in the limitations of life", "sachariah came home", "my brother samuel", "habakkuk chapter two verse three", "she has seven children and twelve grandchildren", "isaiah forty verse thirty one", "turn to john chapter three verse sixteen", "the galleries open at nine thirty", "the jeremiahs of this world"]

describe("Graceville: misheard book names", () => {
    const detector = new BibleSearchDetector(buildTestCache())

    it.each(MISHEARD)("%s -> %s", async (said, reference) => {
        const result = await detector.search(said, "")
        expect(result?.content).toBe(reference)
        expect(result!.confidence).toBeGreaterThan(95) // goes on screen automatically
    })

    it.each(UNCHANGED)("leaves '%s' alone", (said) => {
        expect(correctBookNames(said)).toBe(said)
    })

    it("is fast enough to run on every word", () => {
        const text = "and the lord said unto moses go and speak to the children of israel ".repeat(20) + "habukakh chapter two verse three"
        const started = performance.now()
        for (let i = 0; i < 20; i++) correctBookNames(text)
        expect((performance.now() - started) / 20).toBeLessThan(5)
    })
})
