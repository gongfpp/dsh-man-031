// Offline text/planning only. No service or sibling-plugin dependency.
const DIGITS = [...'零一二三四五六七八九']
export const CLIP_TEXT = Object.freeze({
  prefix: "Man! It's been", ...Object.fromEntries(DIGITS.map((text, i) => [String(i), text])),
  dot: '点', ten: '十', hundred: '百', thousand: '千', 'ten-thousand': '万',
  'hundred-million': '亿', yuan: '元', dollar: '美元',
})
export function decimalAmount(value) {
  let input = String(value).trim()
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(input)) throw new Error('INVALID_NONNEGATIVE_AMOUNT')
  if (input.length > 100) throw new Error('AMOUNT_TOO_LONG')
  const [coefficient, exponentRaw] = input.toLowerCase().split('e')
  const exponent = Number(exponentRaw || 0)
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 30) throw new Error('AMOUNT_OUT_OF_RANGE')
  const [whole = '', fraction = ''] = coefficient.split('.')
  const digits = whole + fraction
  const point = whole.length + exponent
  input = point <= 0 ? `0.${'0'.repeat(-point)}${digits}` : point >= digits.length ? digits + '0'.repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`
  let [a, b = ''] = input.split('.')
  a = a.replace(/^0+(?=\d)/, '') || '0'
  b = b.replace(/0+$/, '')
  if (a.length > 12 || b.length > 8) throw new Error('AMOUNT_OUT_OF_RANGE')
  return b ? `${a}.${b}` : a
}
function sectionTokens(value, omitInitialOne) {
  if (value === 0) return ['0']
  const result = []
  const units = ['', 'ten', 'hundred', 'thousand']
  let zero = false
  for (let place = 3; place >= 0; place--) {
    const digit = Math.floor(value / 10 ** place) % 10
    if (!digit) { if (result.length && value % 10 ** place) zero = true; continue }
    if (zero) { result.push('0'); zero = false }
    if (!(omitInitialOne && digit === 1 && place === 1 && result.length === 0)) result.push(String(digit))
    if (place) result.push(units[place])
  }
  return result
}
export function amountTokens(value) {
  const canonical = decimalAmount(value)
  const [a, b = ''] = canonical.split('.')
  const whole = BigInt(a)
  const groups = [Number(whole % 10000n), Number(whole / 10000n % 10000n), Number(whole / 100000000n)]
  const result = []
  let omittedGroup = false
  for (let i = 2; i >= 0; i--) {
    const group = groups[i]
    if (!group) { if (result.length) omittedGroup = true; continue }
    if (result.length && (omittedGroup || group < 1000)) result.push('0')
    result.push(...sectionTokens(group, result.length === 0))
    if (i) result.push(i === 2 ? 'hundred-million' : 'ten-thousand')
    omittedGroup = false
  }
  if (!result.length) result.push('0')
  if (b) result.push('dot', ...b.split(''))
  return result
}
export const amountText = (value) => amountTokens(value).map((key) => CLIP_TEXT[key]).join('')
export function amountSentence(value, currency = 'CNY') {
  if (!['CNY', 'USD'].includes(currency)) throw new Error('INVALID_CURRENCY')
  return `${CLIP_TEXT.prefix}，${amountText(value)}${CLIP_TEXT[currency === 'USD' ? 'dollar' : 'yuan']}！`
}
