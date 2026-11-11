// Graceville Fast Bible: rare Bible words the speech engine spelled slightly wrong are matched to the real word,
// so quoted verses are still recognised ("the hand of zerebabel have laid" -> "zerubbabel" -> Zechariah 4:9).
//
// Only long words that are not in the Bible at all are changed, and only to a Bible word that sounds almost the same
// (at most 25% different, same first sound). Verses found from quoted words stay suggestions; they never go on screen
// by themselves.

import { distance, soundAlike } from "./bookNames"

const MIN_LENGTH = 6
const MAX_DIFFERENCE = 0.25

export function createVocabularySnapper(vocabulary: string[]) {
    const known = new Set(vocabulary)
    // grouped by first sound and length, so only a small part of the vocabulary is compared
    const groups = new Map<string, { word: string; sound: string }[]>()
    for (const word of vocabulary) {
        if (word.length < MIN_LENGTH - 1) continue
        const sound = soundAlike(word)
        if (!sound) continue
        const key = `${sound[0]}${sound.length}`
        const list = groups.get(key) || []
        list.push({ word, sound })
        groups.set(key, list)
    }

    const remembered = new Map<string, string | null>()

    return function snap(token: string): string | null {
        if (token.length < MIN_LENGTH || known.has(token) || /\d/.test(token)) return null
        if (remembered.has(token)) return remembered.get(token)!

        const sound = soundAlike(token)
        let best: { word: string; score: number } | null = null
        if (sound.length >= MIN_LENGTH - 1) {
            for (let length = sound.length - 2; length <= sound.length + 2; length++) {
                for (const candidate of groups.get(`${sound[0]}${length}`) || []) {
                    const score = distance(sound, candidate.sound) / Math.max(sound.length, candidate.sound.length)
                    if (score <= MAX_DIFFERENCE && (!best || score < best.score)) best = { word: candidate.word, score }
                }
            }
        }

        const result = best?.word || null
        remembered.set(token, result)
        return result
    }
}
