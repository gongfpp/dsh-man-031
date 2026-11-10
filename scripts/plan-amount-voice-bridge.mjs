import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
export const bridgeVoicePlan = {
  id: 'kobe-mimo-en-b-bridge-v1', language: 'en',
  reference: 'dev/voice/kobe-original-kimmel-man-what-long.mp3',
  referenceSha256: '20742b25564e131ef5ed8207f72dfbf6bcb284a573dfb7ed89b9f149db178b79',
  proposedCalls: { total: 2, tts: 1, asr: 1, retries: 0 },
  instruction: "Say the supplied single short phrase exactly once in clear natural English: That's about. Keep the reference speaker's original low deep voice and stable register. Speak normally and firmly, not exaggerated, not shouted, and not like an emotional Man interjection. Do not say Man, labels, numbers, amounts, translations, or any extra words. Do not change pitch or speed.",
  items: [{ key: 'bridge-thats-about', text: "That's about" }],
  text: "That's about.",
  segmentation: { expectedInternalSilences: 0, boundaryReviewed: false, approach: 'preserve complete generated short phrase file, no automatic in-word trimming' },
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify({ dryRun: true, calls: 0, ...bridgeVoicePlan }, null, 2))
