"""One offline cached base.en pass per unmodified raw. All text is inference, not pronunciation/identity approval."""
import os, sys, json, hashlib, subprocess, re
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dev' / 'voice-whole-man-trial'
if (OUT / 'local-asr-summary.json').exists():
    raise RuntimeError('NO_REPEATED_ASR')
report = json.loads((OUT / 'samples.json').read_text(encoding='utf8'))
ledger = json.loads((OUT / 'calls.json').read_text(encoding='utf8'))
if len(ledger['calls']) != 4 or any(r['status'] == 'started' for r in ledger['calls']):
    raise RuntimeError('AWAIT_FOUR_TERMINAL_REQUESTS')
sys.path.insert(0, str(ROOT / 'dev' / 'classic-man' / 'asr-tools'))
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
from faster_whisper import WhisperModel
import numpy as np
model = WhisperModel('base.en', device='cpu', compute_type='int8', download_root=str(ROOT / 'dev' / 'classic-man' / 'asr-models'), cpu_threads=6, local_files_only=True)
results = []
for s in report['samples']:
    if not s.get('sha256') or s.get('error'):
        continue
    file = OUT / s['file']
    if hashlib.sha256(file.read_bytes()).hexdigest() != s['sha256']:
        raise RuntimeError('RAW_SHA_MISMATCH')
    pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(file), '-ar', '16000', '-ac', '1', '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    segments, info = model.transcribe(np.frombuffer(pcm, dtype=np.float32), language='en', beam_size=5, word_timestamps=True, condition_on_previous_text=False)
    rows = [{'start': r.start, 'end': r.end, 'text': r.text, 'words': [{'word': w.word, 'start': w.start, 'end': w.end, 'probability': w.probability} for w in r.words or []]} for r in segments]
    heard = ' '.join(r['text'].strip() for r in rows)
    normal = re.sub(r'(\d)\s*\.\s*(\d+)', r'\1.\2', heard.lower())
    row = {'id': s['id'], 'rawSha256': s['sha256'], 'heardInferenceOnly': heard, 'segments': rows, 'manWordPresentInAsr': bool(re.search(r'\bman\b', normal)), 'amountTextPresentInAsr': bool(re.search(r'zero\s+point\s+three\s+one|(?<![\d.])0\.31(?!\d)', normal)), 'endingTextPresentInAsr': bool(re.search(r"jobs?['’]?s?\s+not\s+finished", normal)), 'possibleStyleWordsInAsr': bool(re.search(r'raising|shouting|unhurried', normal)), 'currencyVerified': False, 'manPerformanceVerified': False, 'humanListeningVerified': False, 'qualityPassed': False, 'caveat': 'One offline English base.en inference. Presence/absence may be ASR error; not a human verdict on MAN, yuan, continuity, emotion, slow pace or identity.'}
    results.append(row)
    (OUT / (s['id'] + '.local-asr.json')).write_text(json.dumps(row, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(json.dumps({key: row[key] for key in ['id', 'heardInferenceOnly', 'manWordPresentInAsr', 'amountTextPresentInAsr', 'endingTextPresentInAsr', 'possibleStyleWordsInAsr', 'qualityPassed']}, ensure_ascii=False), flush=True)
(OUT / 'local-asr-summary.json').write_text(json.dumps({'model': 'existing cached base.en CPU int8, offline', 'cloudAsrCalls': 0, 'onePassPerRaw': True, 'allObservationsAreInference': True, 'samples': results}, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
