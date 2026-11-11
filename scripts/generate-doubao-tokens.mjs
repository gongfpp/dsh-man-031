// Development-only: exactly three fixed fragments, no runtime provider or new voice.
import { fileURLToPath } from 'node:url'
import { generateItem } from './generate-doubao-offline.mjs'
export const directory = fileURLToPath(new URL('../dev/doubao-tokens/', import.meta.url))
const instruction = '用参考的同一低沉男声，带自信和一点调侃，清楚、沉稳、自然地说目标文本。MAN要读清mæn、洪亮有力。token读英语技术词，不要读金额。不要添加词、音乐、音效。只读一次。'
export const plan = [['token-used', 'MAN! This round used.'], ['unit-token', 'Token.'], ['unit-tokens', 'Tokens.']].map(([id, text]) => ({ id, text, instruction }))
export const tokenPhrases = [
  ['token-jobs', '活儿还没结束', "Job's not finished", 'line-jobs', "Job's not finished."],
  ['token-next', '下一回合', 'Next play', 'line-next-play', 'No excuses. Next play.'],
  ['token-mission', '目标不变', 'Same mission', 'line-mission', 'Same mission.'],
  ['token-rep', '再练一组', 'One more rep', 'line-rep', 'One more rep.'],
].map(([id, labelZh, labelEn, suffix, ending]) => ({ id, labelZh, labelEn, prefix: 'token-used', suffix, text: `MAN! This round used {amount} {unit}. ${ending}` }))
export const generateTokenItem = (id, key) => generateItem(id, key, { directory, plan })
