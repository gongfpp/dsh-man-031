"""Read one long output, cached local ASR only; no cuts, normalization or cloud calls."""
import os, sys, json, re, hashlib, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dev' / 'voice-batch40-capacity'
sys.path.insert(0, str(ROOT / 'dev' / 'classic-man' / 'asr-tools'))
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
from faster_whisper import WhisperModel
import numpy as np
model = WhisperModel('base.en', device='cpu', compute_type='int8', download_root=str(ROOT / 'dev' / 'classic-man' / 'asr-models'), cpu_threads=6, local_files_only=True)
source = OUT / 'raw-batch40.wav'
plan = json.loads((OUT / 'samples.json').read_text(encoding='utf8'))
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
if source_hash != plan['raw']['sha256']:
    raise ValueError('RAW_HASH_MISMATCH')
raw = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(source), '-f', 'f32le', '-ar', '16000', '-ac', '1', '-'], capture_output=True, check=True).stdout
segments, info = model.transcribe(np.frombuffer(raw, dtype=np.float32), language='en', beam_size=5, word_timestamps=True, condition_on_previous_text=False)
rows = [{'start': s.start, 'end': s.end, 'text': s.text, 'words': [{'start': w.start, 'end': w.end, 'word': w.word, 'probability': w.probability} for w in s.words or []]} for s in segments]
words = [w for row in rows for w in row['words']]
tokens = [re.sub(r'[^a-z0-9.]', '', w['word'].lower()).strip('.') for w in words]
endings = [i for i, t in enumerate(tokens) if t in ('finished', 'finish') and i >= 2 and tokens[i-1] == 'not' and tokens[i-2] in ('job', 'jobs')]
normalize = lambda s: re.sub(r'[^a-z0-9]', '', s.lower())
number_map = {normalize(re.search(r"That's about (.+?) dollars?\.", s['text']).group(1)): int(s['amount']) for s in plan['sentences']}
number_map.update({str(i): i for i in range(1, 41)})
parts, start = [], 0
for i in endings:
    part = words[start:i+1]
    text = ' '.join(w['word'].strip() for w in part)
    match = re.match(r"^that'?s\s+about\s+(.+?)\s+(dollars?)\b", text.lower())
    encoded = re.match(r"^that'?s\s+about\s+\$([0-9]+)(?:\.|\s|$)", text.lower()) if not match else None
    amount_text = match.group(1) if match else encoded.group(1) if encoded else None
    amount = number_map.get(normalize(amount_text)) if amount_text else None
    parts.append({'index': len(parts), 'start': part[0]['start'], 'end': part[-1]['end'], 'text': text, 'words': part, 'amountText': amount_text, 'recognizedAmount': amount, 'unitAsrEncoding': match.group(2) if match else '$ sign' if encoded else None, 'prefixAmountUnitStructureMatched': bool(match or encoded), 'endingExactFinished': tokens[i] == 'finished', 'humanListeningVerified': False})
    start = i+1
observed = [p['recognizedAmount'] for p in parts]
coverage = sorted({x for x in observed if x is not None})
report = {'source': str(source), 'sourceSha256': source_hash, 'durationSeconds': len(raw)/4/16000, 'finishReasons': plan['finishReasons'], 'outputLengthRequestSettings': plan['outputLengthRequestSettings'], 'model': 'existing cached base.en CPU int8', 'cloudAsrCalls': 0, 'offline': True, 'wordTimesApproximate': True, 'humanListeningVerified': False, 'heard': ' '.join(r['text'].strip() for r in rows), 'segments': rows, 'completionAnchorCount': len(endings), 'completeStructureCount': sum(p['prefixAmountUnitStructureMatched'] and p['endingExactFinished'] for p in parts), 'expectedAmounts': list(range(1, 41)), 'observedAmountSequence': observed, 'coveredAmounts': coverage, 'missingAmounts': [i for i in range(1, 41) if i not in coverage], 'duplicateAmounts': sorted({x for x in observed if x is not None and observed.count(x) > 1}), 'exactOrderedCoverage': observed == list(range(1, 41)), 'paragraphCandidates': parts, 'unassignedTrailingWords': words[start:], 'allAmountsHumanVerified': False, 'note': 'One concrete request only; do not infer an official hard duration cap from this output. No audio was modified or cut.'}
(OUT / 'raw-batch40.local-asr.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
print(json.dumps({k: report[k] for k in ['durationSeconds', 'finishReasons', 'completionAnchorCount', 'completeStructureCount', 'observedAmountSequence', 'missingAmounts', 'duplicateAmounts', 'exactOrderedCoverage', 'unassignedTrailingWords', 'cloudAsrCalls']}, ensure_ascii=False), flush=True)
