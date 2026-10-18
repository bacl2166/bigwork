"""Small local BM25 retriever; no remote embedding or model download."""
import math
import re
from collections import Counter
from .config import ROOT


def tokens(text):
    english = re.findall(r'[a-z0-9+#.]+', text.lower())
    chinese = re.findall(r'[\u4e00-\u9fff]+', text)
    return english + [s[i:i+2] for s in chinese for i in range(max(1, len(s)-1))]


def retrieve(query, resume, limit=4):
    guide = (ROOT / 'knowledge' / 'interview-guide.md').read_text(encoding='utf-8')
    chunks = []
    for kind, text in [('个人材料', resume), ('训练指南', guide)]:
        for line in re.split(r'\n\s*\n|\n', text):
            if line.strip():
                for offset in range(0, len(line), 500):
                    chunks.append({'source': kind, 'text': line[offset:offset+500]})
    docs = [Counter(tokens(c['text'])) for c in chunks]
    query_tokens = set(tokens(query))
    avg = sum(sum(d.values()) for d in docs) / max(len(docs), 1)
    scores = []
    for chunk, doc in zip(chunks, docs):
        score = 0.0
        for term in query_tokens:
            tf = doc[term]
            if tf:
                df = sum(term in d for d in docs)
                idf = math.log(1 + (len(docs)-df+0.5)/(df+0.5))
                score += idf * tf * 2.5 / (tf+1.5*(0.25+0.75*sum(doc.values())/max(avg, 1)))
        scores.append((score, chunk))
    return [dict(c, relevance=round(s, 3)) for s, c in sorted(scores, key=lambda x: x[0], reverse=True)[:limit] if s > 0]
