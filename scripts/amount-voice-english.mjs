// English cardinal-number planning only; no runtime/API/sibling dependency.
import { decimalAmount } from './amount-voice-text.mjs'
const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = { 20: 'twenty', 30: 'thirty', 40: 'forty', 50: 'fifty', 60: 'sixty', 70: 'seventy', 80: 'eighty', 90: 'ninety' }
export const ENGLISH_CLIP_TEXT = Object.freeze({
  prefix: "It's been", ...Object.fromEntries(SMALL.map((text, index) => [String(index), text])),
  ...TENS, hundred: 'hundred', thousand: 'thousand', million: 'million', billion: 'billion',
  dot: 'point', yuan: 'yuan', dollar: 'dollars', 'singular-dollar': 'dollar',
})
function belowThousand(number) {
  const out = []
  if (number >= 100) { out.push(String(Math.floor(number / 100)), 'hundred'); number %= 100 }
  if (number >= 20) { out.push(String(Math.floor(number / 10) * 10)); number %= 10 }
  if (number) out.push(String(number))
  return out
}
export function englishAmountTokens(value) {
  const [whole, fraction = ''] = decimalAmount(value).split('.')
  let number = Number(whole)
  const out = []
  for (const [scale, token] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]) {
    const group = Math.floor(number / scale)
    if (group) out.push(...belowThousand(group), token)
    number %= scale
  }
  if (number) out.push(...belowThousand(number))
  if (!out.length) out.push('0')
  if (fraction) out.push('dot', ...fraction.split(''))
  return out
}
export const englishAmountText = (value) => englishAmountTokens(value).map((token) => ENGLISH_CLIP_TEXT[token]).join(' ')
export function englishAmountSentence(value, currency = 'CNY') {
  if (!['CNY', 'USD'].includes(currency)) throw new Error('INVALID_CURRENCY')
  const unit = currency === 'CNY' ? 'yuan' : decimalAmount(value) === '1' ? 'dollar' : 'dollars'
  return `${ENGLISH_CLIP_TEXT.prefix} ${englishAmountText(value)} ${unit}!`
}
export function normalizeEnglishASR(text) {
  return String(text).toLowerCase().replace(/\d+(?:\.\d+)?/g, (number) => { try { return englishAmountText(number) } catch { return number } }).replace(/[^a-z]/g, '')
}
