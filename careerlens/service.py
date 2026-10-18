import re
import time
from fastapi import HTTPException
from .llm import OllamaClient, DemoClient, ModelError
from .schemas import AnalysisDraft, Question, Feedback
from .store import Store, record, timestamp
from .retrieval import retrieve

LABELS = {'proven': '有行动证据', 'mentioned': '仅提及技能', 'missing': '尚缺材料证据'}
DIMENSIONS = {'relevance': '回答相关性', 'completeness': '内容完整性', 'consistency': '事实一致性', 'clarity': '表达清晰度', 'star': 'STAR 结构', 'competency': '岗位能力'}
NEGATIVE = re.compile(r'尚未|没有.*(?:经验|学习|使用|掌握)|不会|未掌握|未学习|不熟悉|未使用')
ACTION = re.compile(r'开发|实现|设计|编写|完成|优化|搭建|部署|测试|组织|解决|分析|负责|建立|使用|implement|develop|built|design|test', re.I)


class CareerService:
    def __init__(self, settings):
        self.settings = settings
        self.store = Store(settings.data_dir)
        self.model = DemoClient(settings) if settings.mode == 'demo' else OllamaClient(settings)

    def health(self):
        return {'app': 'CareerLens', 'mode': self.settings.mode, 'model': self.settings.model, 'local_only': True, **self.model.health()}

    def create_project(self, data):
        p = {**record(), **data.model_dump(), 'revision': 0, 'analysis_id': None}
        with self.store.connection(write=True) as c:
            self.store.save('projects', p, c)
        return self.project(p['id'])

    def project(self, id):
        p = self.store.get('projects', id)
        p['analysis'] = self.store.get('analyses', p['analysis_id']) if p['analysis_id'] else None
        return p

    def projects(self):
        return [{k: v for k, v in p.items() if k not in ('resume', 'job')} for p in self.store.list('projects')]

    def update_project(self, id, data):
        with self.store.connection(write=True) as c:
            p = self.store.get('projects', id, c)
            self.check_version(p['revision'], data.revision)
            p.update(data.model_dump(exclude={'revision'}))
            p.update(revision=p['revision']+1, analysis_id=None, updated_at=timestamp())
            self.store.save('projects', p, c)
        return self.project(id)

    def delete_project(self, id):
        with self.store.connection(write=True) as c:
            self.store.get('projects', id, c)
            c.execute('DELETE FROM projects WHERE id=?', (id,))

    def analyze(self, id):
        p = self.store.get('projects', id)
        start = time.monotonic()
        draft = self.model.generate(AnalysisDraft, 'analysis', {'resume': p['resume'], 'job': p['job']})
        warnings, requirements, seen = [], [], set()
        for r in draft.requirements:
            if r.name.casefold() in seen:
                continue
            seen.add(r.name.casefold())
            if r.job_quote not in p['job']:
                warnings.append(f'已剔除无法定位岗位原文的要求：{r.name}')
                continue
            evidence = []
            for e in r.evidence:
                offset = p['resume'].find(e.quote)
                if offset < 0 or NEGATIVE.search(e.quote):
                    warnings.append(f'{r.name}：已剔除无效或否定性证据')
                    continue
                if e.quote in [x['quote'] for x in evidence]:
                    continue
                evidence.append({**e.model_dump(), 'start': offset, 'end': offset+len(e.quote)})
            status = 'proven' if any(ACTION.search(e['quote']) for e in evidence) else ('mentioned' if evidence else 'missing')
            requirements.append({**r.model_dump(), 'evidence': evidence, 'status': status, 'status_label': LABELS[status], 'weight': 2 if r.importance == 'required' else 1})
        if not requirements:
            raise ModelError('模型未提供可定位到岗位原文的要求，请精简岗位描述后重试')
        values = {'proven': 1, 'mentioned': 0.4, 'missing': 0}
        score = round(100 * sum(r['weight']*values[r['status']] for r in requirements)/sum(r['weight'] for r in requirements))
        issues = []
        for issue in draft.issues:
            if issue.quote in p['resume']:
                issues.append(issue.model_dump())
            else:
                warnings.append('已剔除无法在简历定位的问题引用')
        analysis = {**record(), 'project_id': id, 'project_name': p['name'], 'revision': p['revision'], 'resume': p['resume'], 'job': p['job'], 'summary': draft.summary, 'requirements': requirements, 'issues': issues, 'match_score': score, 'validation_warnings': warnings, 'mode': self.settings.mode, 'model': self.settings.model if self.settings.mode == 'ollama' else '规则演示', 'elapsed_seconds': round(time.monotonic()-start, 2), 'retrieved': retrieve(p['job'], p['resume'])}
        with self.store.connection(write=True) as c:
            current = self.store.get('projects', id, c)
            self.check_version(current['revision'], p['revision'])
            if current['analysis_id'] != p['analysis_id']:
                raise HTTPException(409, '分析已由另一请求更新，请刷新查看')
            self.store.save('analyses', analysis, c)
            current.update(analysis_id=analysis['id'], updated_at=timestamp())
            self.store.save('projects', current, c)
        return analysis

    @staticmethod
    def model_context(a):
        return {'resume': a['resume'], 'requirements': [{'name': r['name'], 'status': r['status']} for r in a['requirements']]}

    def create_session(self, id, rounds):
        p = self.store.get('projects', id)
        if not p['analysis_id']:
            raise HTTPException(409, '请先完成当前材料的岗位分析')
        a = self.store.get('analyses', p['analysis_id'])
        question = self.model.generate(Question, 'question', self.model_context(a))
        s = {**record(), 'project_id': id, 'project_name': p['name'], 'analysis_id': a['id'], 'rounds': rounds, 'turns': [], 'question': question.model_dump(), 'status': 'active', 'version': 0, 'mode': self.settings.mode, 'model': self.settings.model if self.settings.mode == 'ollama' else '规则演示'}
        with self.store.connection(write=True) as c:
            current = self.store.get('projects', id, c)
            if current['analysis_id'] != a['id']:
                raise HTTPException(409, '材料分析已变化，请刷新后开始面试')
            self.store.save('sessions', s, c)
        return s

    def answer(self, id, data):
        s = self.store.get('sessions', id)
        self.check_version(s['version'], data.version)
        if s['status'] != 'active':
            raise HTTPException(409, '面试已暂停或完成')
        if s['mode'] != self.settings.mode or s['model'] != (self.settings.model if self.settings.mode == 'ollama' else '规则演示'):
            raise HTTPException(409, '该会话使用了不同引擎或模型，请切换回原配置，或新建面试')
        a = self.store.get('analyses', s['analysis_id'])
        context = {**self.model_context(a), 'round': len(s['turns'])+1, 'question': s['question'], 'answer': data.answer,
                   'recent_turns': [{'question': t['question']['question'], 'answer': t['answer']} for t in s['turns'][-2:]],
                   'previous_questions': [t['question']['question'] for t in s['turns']],
                   'retrieved': [r for r in retrieve(s['question']['question']+' '+data.answer, a['resume'], 4) if r['source'] == '训练指南'][:1]}
        start = time.monotonic()
        feedback = self.model.generate(Feedback, 'feedback', context).model_dump()
        previous = {t['question']['question'] for t in s['turns']} | {s['question']['question']}
        if feedback['next_question']['question'] in previous:
            feedback['next_question'] = {'question': f'请结合尚未讨论的一个具体经历，说明你将怎样改进“{s["question"]["focus"]}”并验证效果？（第 {len(s["turns"])+2} 轮）', 'focus': '改进与验证', 'category': '行为面试'}
        s['turns'].append({'question': s['question'], 'answer': data.answer, 'feedback': feedback, 'answered_at': timestamp(), 'elapsed_seconds': round(time.monotonic()-start, 2)})
        done = len(s['turns']) >= s['rounds']
        s.update(question=None if done else feedback['next_question'], status='completed' if done else 'active', version=s['version']+1, updated_at=timestamp())
        with self.store.connection(write=True) as c:
            current = self.store.get('sessions', id, c)
            self.check_version(current['version'], data.version)
            self.store.save('sessions', s, c)
        return s

    def state(self, id, data):
        with self.store.connection(write=True) as c:
            s = self.store.get('sessions', id, c)
            self.check_version(s['version'], data.version)
            expected = 'active' if data.action == 'pause' else 'paused'
            if s['status'] != expected:
                raise HTTPException(409, '当前会话状态不允许此操作')
            s.update(status='paused' if data.action == 'pause' else 'active', version=s['version']+1, updated_at=timestamp())
            self.store.save('sessions', s, c)
        return s

    def sessions(self):
        return [{**{k: v for k, v in s.items() if k not in ('turns', 'question')}, 'answered': len(s['turns'])} for s in self.store.list('sessions')]

    @staticmethod
    def check_version(current, provided):
        if current != provided:
            raise HTTPException(409, '内容已更新或本次操作已提交，请刷新后重试')
