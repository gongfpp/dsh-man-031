// Development only: ten new fixed fragments; reuse every existing number/unit/prefix.
import { fileURLToPath } from 'node:url'
import { generateItem } from './generate-doubao-offline.mjs'
import { phrases as previous } from './generate-doubao-phrases.mjs'
export const directory = fileURLToPath(new URL('../dev/doubao-phrases-v3/', import.meta.url))
const instruction = '用参考的同一低沉男声，带自信和一点调侃，清楚、沉稳、自然地说目标文本。MAN要读清mæn、洪亮有力，之后自然放松；不要像收银员，不要添加词、音乐、音效。只读一次。'
export const plan = [
  ['line-next-play', 'No excuses. Next play.'],
  ['line-far-stop', "We didn't come this far to stop."],
  ['bill-showed', 'MAN! The bill showed up. So did we. About.'],
  ['line-worth', 'Good. Now make it worth it.'],
  ['line-eyes', 'Eyes up. Next shot.'],
  ['line-rep', 'One more rep.'],
  ['line-receipt', 'Keep the receipt. Lose the doubt.'],
  ['line-shortcuts', 'No shortcuts from here.'],
  ['line-mission', 'Same mission.'],
  ['line-clock', "Clock's still running."],
].map(([id, text]) => ({ id, text, instruction }))
export const phrases = [...previous, ...[
  ['next-play', '别找借口，下一回合', 'No excuses, next play', 'man-about', 'line-next-play', 'MAN! About {amount} {unit}. No excuses. Next play.'],
  ['far-stop', '走到这了，别停', 'We did not come this far to stop', 'about', 'line-far-stop', "About {amount} {unit}. We didn't come this far to stop."],
  ['showed', '账单来了，我们也到了', 'The bill showed up', 'bill-showed', null, 'MAN! The bill showed up. So did we. About {amount} {unit}.'],
  ['worth', '现在，让这笔钱花得值', 'Make it worth it', 'about', 'line-worth', 'About {amount} {unit}. Good. Now make it worth it.'],
  ['eyes', '抬头，下一球', 'Eyes up, next shot', 'man-about', 'line-eyes', 'MAN! About {amount} {unit}. Eyes up. Next shot.'],
  ['rep', '再练一组', 'One more rep', 'about', 'line-rep', 'About {amount} {unit}. One more rep.'],
  ['receipt', '留着小票，丢掉怀疑', 'Keep the receipt, lose the doubt', 'about', 'line-receipt', 'About {amount} {unit}. Keep the receipt. Lose the doubt.'],
  ['shortcuts', '这里没有捷径', 'No shortcuts from here', 'man-about', 'line-shortcuts', 'MAN! About {amount} {unit}. No shortcuts from here.'],
  ['mission', '再来一轮，目标不变', 'Same mission', 'another-round', 'line-mission', 'Another round, about {amount} {unit}. Same mission.'],
  ['clock', '计时还没停', 'Clock is still running', 'about', 'line-clock', "About {amount} {unit}. Clock's still running."],
].map(([id, labelZh, labelEn, prefix, suffix, text], i) => ({ id, labelZh: `${i + 11}. ${labelZh}`, labelEn: `${i + 11}. ${labelEn}`, prefix, ...(suffix ? { suffix } : {}), text }))]
export const generatePhraseItem = (id, key) => generateItem(id, key, { directory, plan })
