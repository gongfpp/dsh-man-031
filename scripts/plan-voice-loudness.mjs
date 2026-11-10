// Dry-run only. Reports source-level discrepancies before choosing volume processing.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const root = fileURLToPath(new URL('../', import.meta.url)), dir = join(root, 'dev/voice-loudness-v2')
const audit = JSON.parse(readFileSync(join(dir, 'audit-before.json')))
const rows = audit.clips.map(({ key, text, synthetic, metrics: m }) => ({ key, text, synthetic, duration: m.decodedDurationSeconds, integrated: m.integratedLUFS, usable: m.integratedUsable, activeRms: m.activeRmsDb, activeP75: m.activeFrameRmsP75Db, truePeak: m.truePeakDb, crestDb: m.truePeakDb - m.activeFrameRmsP75Db, proposedActiveGainDb: -19 - m.activeFrameRmsP75Db, limiterDemandDb: Math.max(0, m.truePeakDb - 19 - m.activeFrameRmsP75Db + 1.5) }))
writeFileSync(join(dir, 'level-table.json'), JSON.stringify({ calls: 0, assetsModified: false, initialCalibrationTargetActiveP75Db: -19, rows }, null, 2) + '\n')
console.log(JSON.stringify(rows, null, 2))
