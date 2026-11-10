// Never print, persist, or pass credentials on command lines.
// The documented private file location comes from the existing local narration tooling.
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
const repo = fileURLToPath(new URL('..', import.meta.url))
export function parseEnv(text) {
  const values = {}
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?(MIMO_API_KEY|MIMO_BASE_URL)\s*=\s*(.*?)\s*$/.exec(line)
    if (!match) continue
    let value = match[2]
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    else value = value.replace(/\s+#.*$/, '')
    values[match[1]] = value.trim()
  }
  return values
}
function privateFile(path) {
  const file = resolve(path)
  const rel = relative(repo, file)
  if (!rel.startsWith('..') && !isAbsolute(rel)) throw new Error('SECRET_FILE_MUST_BE_OUTSIDE_REPOSITORY')
  return file
}
function officialBase(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('INVALID_MIMO_BASE_URL')
  if (!['api.xiaomimimo.com', 'token-plan-cn.xiaomimimo.com'].includes(url.hostname)) throw new Error('MIMO_ENDPOINT_NOT_ALLOWLISTED')
  return value.replace(/\/+$/, '')
}
const keyOf = (row) => typeof row.api_key === 'string' ? row.api_key.trim() : Array.isArray(row.api_key) ? row.api_key.find((key) => typeof key === 'string' && key.trim())?.trim() : undefined
export function mimoProviders(config) {
  return (Array.isArray(config.provider) ? config.provider : []).flatMap((row, index) => {
    if (!row || typeof row !== 'object' || !/^mimo(?:_|$)/i.test(String(row.type || row.provider || '')) || !/^mimo-/i.test(String(row.model || ''))) return []
    let endpoint
    try { endpoint = officialBase(String(row.api_base || '')) } catch { return [] }
    return [{ row, index, endpoint, hasKey: Boolean(keyOf(row)) }]
  })
}
export function inspectMiMoConfig(path) {
  const file = privateFile(path)
  const config = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  return { source: file, matches: mimoProviders(config).map(({ row, index, endpoint, hasKey }) => ({ fieldPath: `$.provider[${index}]`, model: row.model, endpoint, keyFieldPath: `$.provider[${index}].api_key`, hasKey })) }
}
export function loadMiMoSecret(kind = 'tts') {
  let key = process.env.MIMO_API_KEY?.trim()
  let base = process.env.MIMO_BASE_URL?.trim()
  let source = 'Process:MIMO_API_KEY'
  if (!key && process.env.MIMO_CONFIG_FILE) {
    const file = privateFile(process.env.MIMO_CONFIG_FILE)
    const config = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    const candidates = mimoProviders(config).filter(({ row, hasKey }) => hasKey && (kind === 'asr' ? /^mimo-.*-asr$/.test(row.model) : /^mimo-.*-tts(?:-voiceclone)?$/.test(row.model)))
    candidates.sort((a, b) => Number(b.row.model.endsWith('-voiceclone')) - Number(a.row.model.endsWith('-voiceclone')))
    const selected = candidates[0]
    if (selected) { key = keyOf(selected.row); base ||= selected.endpoint; source = `${file}#$.provider[${selected.index}].api_key` }
  }
  const candidates = [...new Set([process.env.MIMO_ENV_FILE, resolve(homedir(), '.config/ai-teardown/mimo.env')].filter(Boolean))]
  if (!key) for (const candidate of candidates) {
    const file = privateFile(candidate)
    if (!existsSync(file)) continue
    const env = parseEnv(readFileSync(file, 'utf8'))
    if (env.MIMO_API_KEY) { key = env.MIMO_API_KEY; base ||= env.MIMO_BASE_URL; source = file; break }
  }
  if (!key) return { found: false }
  base ||= key.startsWith('tp-') ? 'https://token-plan-cn.xiaomimimo.com/v1' : 'https://api.xiaomimimo.com/v1'
  return { found: true, key, base: officialBase(base), source }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--inspect-config')) {
      if (!process.env.MIMO_CONFIG_FILE) throw new Error('MIMO_CONFIG_FILE_REQUIRED')
      console.log(JSON.stringify(inspectMiMoConfig(process.env.MIMO_CONFIG_FILE), null, 2))
    } else {
      const secret = loadMiMoSecret(process.argv.includes('--asr') ? 'asr' : 'tts')
      console.log(JSON.stringify({ found: secret.found, ...(secret.found ? { source: secret.source } : {}) }))
    }
  } catch { console.error(JSON.stringify({ found: false, error: 'SECRET_LOADING_FAILED' })); process.exitCode = 1 }
}
