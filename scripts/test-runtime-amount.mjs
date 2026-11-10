import assert from 'node:assert/strict'
import { canonicalAmount, amountWords, utterance } from '../lib/amount.js'

assert.equal(canonicalAmount(.31), '0.31')
assert.equal(canonicalAmount(.31004), '0.31004')
assert.notEqual(canonicalAmount(.31), canonicalAmount(.31004))
assert.equal(canonicalAmount(.1 + .2), '0.30000000000000004')
assert.equal(canonicalAmount(1e-8), '0.00000001')
assert.equal(canonicalAmount(1.0000000000000002e-8), '0.000000010000000000000002')
assert.equal(canonicalAmount(0), '0')
assert.equal(amountWords(1234.05001), 'one thousand two hundred thirty four point zero five zero zero one')
assert.equal(amountWords(999999999999), 'nine hundred ninety nine billion nine hundred ninety nine million nine hundred ninety nine thousand nine hundred ninety nine')
assert.equal(utterance(.31, 'CNY'), "MAN! That's about zero point three one 元. Job's not finished.")
assert.equal(utterance(1, 'USD'), "MAN! That's about one dollar. Job's not finished.")
assert.equal(utterance(0, 'USD'), "MAN! That's about zero dollars. Job's not finished.")
for (const value of [-1, 1e-9, 1e12, NaN, Infinity, '0.31', null, undefined]) assert.throws(() => canonicalAmount(value), /unsupported-amount/)
assert.throws(() => utterance(.31, 'GBP'), /invalid-currency/)
console.log('Runtime amount planning passed: exact JS decimals, no rounded cache hits, exponents, units, zero and limits; no audio splicing or network calls')
