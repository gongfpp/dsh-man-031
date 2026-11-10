// Acoustic activity proxy, not speech-only VAD. All operations are local.
import { spawnSync } from 'node:child_process'
export const LOUDNESS_VERSION = 'voice-active-loudness-v2.1'
export const SETTINGS = Object.freeze({ sampleRate: 24000, channels: 1, frameMs: 20, hopMs: 10, absoluteGateDb: -48, relativeGateDb: 18, targetLUFS: -18, truePeakCeilingDb: -1.5, targetLRA: 5 })
export function media(args, binary = false) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...args], { encoding: binary ? undefined : 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 64 * 1024 * 1024 })
  if (r.error || r.status !== 0) throw new Error('LOCAL_FFMPEG_FAILED:' + (r.error?.code || r.status))
  return r
}
const finite = (x) => Number.isFinite(Number(x)) ? Number(x) : null
const db = (x) => x > 0 ? 20 * Math.log10(x) : null
export function percentile(values, p) {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b), i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i)
  return s[lo] + (s[hi] - s[lo]) * (i - lo)
}
export function measureVoice(file) {
  const data = media(['-v', 'error', '-i', file, '-f', 'f32le', '-ar', '24000', '-ac', '1', 'pipe:1'], true).stdout
  if (!data.length || data.length % 4) throw new Error('INVALID_DECODED_AUDIO')
  const n = data.length / 4, samples = new Float32Array(n); let peak = 0
  for (let i = 0; i < n; i++) { const x = data.readFloatLE(i * 4); samples[i] = x; peak = Math.max(peak, Math.abs(x)) }
  const frame = 480, hop = 240, rms = []
  for (let start = 0; start < n; start += hop) {
    const end = Math.min(n, start + frame); let energy = 0
    for (let i = start; i < end; i++) energy += samples[i] * samples[i]
    rms.push(Math.sqrt(energy / (end - start)))
  }
  const nonzero = rms.map(db).filter((x) => x !== null), p95 = percentile(nonzero, .95)
  const threshold = p95 === null ? null : Math.max(SETTINGS.absoluteGateDb, p95 - SETTINGS.relativeGateDb)
  const active = threshold === null ? [] : rms.filter((x) => db(x) !== null && db(x) >= threshold), activeDb = active.map(db)
  const scan = media(['-i', file, '-af', `aformat=sample_rates=24000:channel_layouts=mono,loudnorm=I=${SETTINGS.targetLUFS}:TP=${SETTINGS.truePeakCeilingDb}:LRA=${SETTINGS.targetLRA}:print_format=json`, '-f', 'null', '-']).stderr
  const found = /\{\s*"input_i"[\s\S]*?\}/.exec(scan)
  if (!found) throw new Error('LOUDNORM_MEASUREMENT_MISSING')
  const ebu = JSON.parse(found[0]), duration = n / 24000, activeDuration = Math.min(duration, active.length * .01)
  const integrated = finite(ebu.input_i), truePeak = finite(ebu.input_tp)
  return { decodedDurationSeconds: duration, frameCount: rms.length, activeFrames: active.length, activityThresholdDb: threshold, activeDurationApproxSeconds: activeDuration, activityFraction: rms.length ? active.length / rms.length : 0, activeRmsDb: active.length ? db(Math.sqrt(active.reduce((s, x) => s + x * x, 0) / active.length)) : null, activeFrameRmsP50Db: percentile(activeDb, .5), activeFrameRmsP75Db: percentile(activeDb, .75), activeFrameRmsP90Db: percentile(activeDb, .9), allFrameRmsP95Db: p95, samplePeakDb: db(peak), integratedLUFS: integrated, integratedUsable: integrated !== null && duration >= .4 && activeDuration >= .4, truePeakDb: truePeak, loudnessRangeLU: finite(ebu.input_lra), integratedThresholdLUFS: finite(ebu.input_thresh), loudnormTargetOffsetDb: finite(ebu.target_offset), ebuInvalidReason: integrated === null ? 'non-finite integrated loudness; NOT converted to zero' : duration < .4 || activeDuration < .4 ? 'short duration/activity; gated active-frame RMS used for matching' : null }
}
export function range(rows, key) { const values = rows.map((r) => r[key]).filter((v) => v !== null && Number.isFinite(v)); return { min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null, span: values.length ? Math.max(...values) - Math.min(...values) : null, count: values.length, unavailable: rows.length - values.length } }
