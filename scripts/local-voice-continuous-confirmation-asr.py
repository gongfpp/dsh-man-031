"""Single cached offline English ASR pass per raw; numeric/ending observations are NOT unit or quality approval."""
import os, sys, json, subprocess, hashlib, re
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dev' / 'voice-continuous-confirmation'
sys.path.insert(0, str(ROOT / 'dev' / 'classic-man' / 'asr-tools'))
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
from faster_whisper import WhisperModel
import numpy as np
model = WhisperModel('base.en', device='cpu', compute_type='int8', download_root=str(ROOT / 'dev' / 'classic-man' / 'asr-models'), cpu_threads=6, local_files_only=True)
report = json.loads((OUT / 'samples.json').read_text(encoding='utf8'))
patterns = {'0': r'\bzero\b|(?<![\d.])0(?![\d.])', '0.01': r'zero\s+point\s+zero\s+one|(?<![\d.])0\.01(?!\d)', '1.27': r'one\s+point\s+two\s+seven|(?<![\d.])1\.27(?!\d)'}
results = []
for s in report['samples']:
    if not s.get('sha256') or s.get('error'):
        continue
    source = OUT / s['file']
    if hashlib.sha256(source.read_bytes()).hexdigest() != s['sha256']:
        raise ValueError('RAW_SHA_MISMATCH')
    audio = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(source), '-f', 'f32le', '-ar', '16000', '-ac', '1', '-'], capture_output=True, check=True).stdout
    segments, info = model.transcribe(np.frombuffer(audio, dtype=np.float32), language='en', beam_size=5, word_timestamps=True, condition_on_previous_text=False)
    rows = [{'start': r.start, 'end': r.end, 'text': r.text, 'words': [{'start': w.start, 'end': w.end, 'word': w.word, 'probability': w.probability} for w in r.words or []]} for r in segments]
    heard = ' '.join(r['text'].strip() for r in rows)
    formatted = re.sub(r'(\d)\s*\.\s*(\d+)', r'\1.\2', heard.lower())
    row = {'id': s['id'], 'expectedAmount': s['amount'], 'expectedCurrency': s['currency'], 'rawSha256': s['sha256'], 'heard': heard, 'segments': rows, 'expectedNumberPresentInLocalAsr': bool(re.search(patterns[s['amount']], formatted)), 'endingJobsNotFinishedPresentInLocalAsr': bool(re.search(r"jobs?['’]?s?\s+not\s+finished", formatted)), 'currencyVerified': False, 'humanListeningVerified': False, 'qualityPassed': False, 'caveat': 'One English base.en pass only, no unit judgement, no manual listening or phonetic boundary assertion. Previous CNY0.31 C acceptance does not approve this new amount.'}
    results.append(row)
    (OUT / (s['id'] + '.local-asr.json')).write_text(json.dumps(row, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print(json.dumps({k: row[k] for k in ['id', 'heard', 'expectedNumberPresentInLocalAsr', 'endingJobsNotFinishedPresentInLocalAsr', 'currencyVerified', 'qualityPassed']}, ensure_ascii=False), flush=True)
(OUT / 'local-asr-summary.json').write_text(json.dumps({'model': 'existing cached base.en CPU int8', 'cloudAsrCalls': 0, 'onePassPerRawOnly': True, 'qualityPassed': False, 'samples': results}, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
