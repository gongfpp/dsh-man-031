import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
export const phraseVoicePlan = {
  id: 'kobe-mimo-en-b-phrases-v1', language: 'en',
  reference: 'dev/voice/kobe-original-kimmel-man-what-long.mp3',
  referenceSha256: '20742b25564e131ef5ed8207f72dfbf6bcb284a573dfb7ed89b9f149db178b79',
  proposedCalls: { total: 2, tts: 1, asr: 1, retries: 0 },
  instruction: 'Read the five supplied items exactly once in order, in clear natural English. Each item is an independent recording unit. Leave a full one second of SILENCE between every item. Keep the original low deep voice of the reference and a stable natural register, calm and clear. Do not say any numbering, labels, Man, amounts, or connecting words. Do not add or omit words. Preserve each phrase as supplied. Do not sing, shout, or change pitch or speed.',
  items: [
    { key: 'phrase-round-cost', text: 'This round cost about' },
    { key: 'phrase-came-to', text: 'That came to about' },
    { key: 'phrase-you-spent', text: 'You spent about' },
    { key: 'phrase-this-round', text: 'this round' },
    { key: 'phrase-total', text: 'The total for this round was about' },
  ],
  phrases: [
    { id: 'round-cost', prefix: 'phrase-round-cost' },
    { id: 'came-to', prefix: 'phrase-came-to' },
    { id: 'you-spent', prefix: 'phrase-you-spent', suffix: 'phrase-this-round' },
    { id: 'total', prefix: 'phrase-total' },
  ],
  segmentation: { thresholdDb: -38, minimumSilenceSeconds: 0.35, expectedInternalSilences: 4, paddingSeconds: 0.05, boundaryReviewed: false },
}
phraseVoicePlan.text = phraseVoicePlan.items.map((x) => x.text).join('.\n\n') + '.'
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify({ dryRun: true, calls: 0, ...phraseVoicePlan }, null, 2))
