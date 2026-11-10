// Development-only MAN/attitude repair; current runtime assets remain unchanged.
import { fileURLToPath } from 'node:url'
import { generateItem } from './generate-doubao-offline.mjs'
export const directory = fileURLToPath(new URL('../dev/doubao-man-refresh/', import.meta.url))
export const plan = [
  { id: 'prefix-clear', text: "MAN! That's about.", instruction: '用参考中的同一低沉男声。开头清晰地发英语MAN（mæn）：m起音扎实，张口发æ，最后完整收住n鼻音，响亮有力地感叹，拉长大约半秒，短停顿后从容说That\'s about。带一点笑意和自信，不是平板报账。只读目标文本，不加词、音乐或音效。' },
  { id: 'prefix-flavor', text: "MAN! That's about.", instruction: '同一参考男声，像一个自信又略带不可置信的球星，带着笑意大声感叹MAN！这个英语词要咬字很清楚，æ略拖长，n收音明显，胸腔共鸣厚实。接着语调有起伏、稍带得意地说That\'s about，像甩出一句梗，不是客服或报账员。只读目标文本，不加词、音乐或音效。' },
  { id: 'yuan-flavor', text: "元。Job's not finished.", instruction: '保持参考的同一男声。元按中文yuán清晰读。短停顿后，带一点笑意、自信而有分量地说Job\'s not finished，重读Job\'s和finished，最后干脆有力落地，像球星赛后甩出一句硬话，不是平板报账。只读目标文本，不加词、音乐或音效。' },
  { id: 'dollars-flavor', text: "Dollars. Job's not finished.", instruction: '保持参考的同一男声。先清楚说Dollars。短停顿后，带一点笑意、自信而有分量地说Job\'s not finished，重读Job\'s和finished，最后干脆有力落地，像球星赛后甩出一句硬话，不是平板报账。只读目标文本，不加词、音乐或音效。' },
]
export async function generateRefresh(key) {
  const results = []
  for (const item of plan) results.push(await generateItem(item.id, key, { directory, plan }))
  return { results, calls: results.length, cloudAsr: 0, runtimeChanged: false }
}
