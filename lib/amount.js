// Runtime money-to-text planning. One complete provider utterance, never audio token splicing.
const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

export const VOICE_INSTRUCTION = '开头的MAN用低沉浑厚、洪亮有力的感叹喊出来；短暂停顿后，同一声线沉稳缓慢地说完正文。金额逐个读清，元按中文yuán发音。'

export function canonicalAmount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1e12 || (value > 0 && value < 1e-8)) throw new Error('unsupported-amount')
  const text = String(value)
  if (!text.includes('e')) return text
  const [coefficient, exponent] = text.split('e')
  const [whole, fraction = ''] = coefficient.split('.')
  const digits = whole + fraction, position = whole.length + Number(exponent)
  if (position <= 0) return `0.${'0'.repeat(-position)}${digits}`
  if (position >= digits.length) return digits + '0'.repeat(position - digits.length)
  return `${digits.slice(0, position)}.${digits.slice(position)}`
}

function smallGroup(value) {
  const words = []
  if (value >= 100) { words.push(SMALL[Math.floor(value / 100)], 'hundred'); value %= 100 }
  if (value >= 20) { words.push(TENS[Math.floor(value / 10)]); value %= 10 }
  if (value) words.push(SMALL[value])
  return words
}

export function amountWords(value) {
  const [whole, fraction = ''] = canonicalAmount(value).split('.')
  let remaining = Number(whole)
  const words = []
  for (const [scale, name] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]) {
    const group = Math.floor(remaining / scale)
    if (group) words.push(...smallGroup(group), name)
    remaining %= scale
  }
  if (remaining) words.push(...smallGroup(remaining))
  if (!words.length) words.push('zero')
  if (fraction) words.push('point', ...[...fraction].map(digit => SMALL[Number(digit)]))
  return words.join(' ')
}

export function utterance(value, currency) {
  if (currency !== 'CNY' && currency !== 'USD') throw new Error('invalid-currency')
  const amount = canonicalAmount(value)
  const unit = currency === 'CNY' ? '元' : amount === '1' ? 'dollar' : 'dollars'
  return `MAN! That's about ${amountWords(value)} ${unit}. Job's not finished.`
}
