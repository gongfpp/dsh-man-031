// Pure offline plan. The separate executable enforces the authorized eight-call ceiling.
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENGLISH_CLIP_TEXT } from './amount-voice-english.mjs'
export const englishVoiceGroupPlan = {
  id: 'kobe-mimo-en-b-groups-v1', language: 'en', numberStyle: 'cardinal-US-no-and',
  voiceId: 'kobe-mimo-en-v1', reference: 'dev/voice/kobe-original-kimmel-man-what-long.mp3',
  referenceSha256: '20742b25564e131ef5ed8207f72dfbf6bcb284a573dfb7ed89b9f149db178b79',
  instruction: 'Read each supplied item exactly once, in order, in clear natural English. Each item is an independent recording unit. Leave a full one second of silence between every item, including after numbers. Preserve the reference speaker\'s original low, deep voice and stable natural vocal register. Stay calm, clear and consistent. Do not say any labels, ordinal numbers, numbering, connecting words, translations, or additional words. Do not say Man. Do not sing or change pitch or speed. If the item It\'s been is present, read it naturally as one short phrase.',
  proposedCalls: { tts: 4, asr: 4, total: 8, retries: 0 },
  slicing: { approach: 'silence count plus complete group ASR sequence', silenceThresholdDb: -38, minimumSilenceSeconds: 0.35, humanBoundaryReviewRequiredForVerified: true, noPitchChange: true, failurePolicy: 'Stop on API failure or mismatching ASR/segment count; never guess missing boundaries or regenerate automatically.' },
  normalization: { sampleRate: 24000, channels: 1, staticGainTargetMeanDb: -20, peakCeilingDb: -1 },
  generatedTokenCount: 37, approvedOpeners: ['man-firm', 'man-extended'], finalClipCount: 39,
  groups: [
    { id: 'digits', keys: Array.from({ length: 10 }, (_, i) => String(i)) },
    { id: 'teens', keys: Array.from({ length: 10 }, (_, i) => String(i + 10)) },
    { id: 'tens', keys: Array.from({ length: 8 }, (_, i) => String((i + 2) * 10)) },
    { id: 'scales-units-prefix', keys: ['hundred', 'thousand', 'million', 'billion', 'dot', 'yuan', 'dollar', 'singular-dollar', 'prefix'] },
  ].map((group) => ({ ...group, text: group.keys.map((key) => ENGLISH_CLIP_TEXT[key]).join('.\n\n') + '.', expectedTokens: group.keys.map((key) => ({ key, text: ENGLISH_CLIP_TEXT[key] })) })),
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify({ dryRun: true, authorizedCeiling: 8, ...englishVoiceGroupPlan }, null, 2))
