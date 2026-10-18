import io
import threading
import zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from fastapi.testclient import TestClient

from careerlens.app import create_app
from careerlens.config import Settings
from careerlens.llm import OllamaClient, ModelError
from careerlens.schemas import AnalysisDraft, Feedback
from careerlens.retrieval import retrieve
from careerlens.parser import parse_document
from fastapi import HTTPException


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path, mode='demo'))) as c:
        yield c


def test_home_and_assets_are_self_contained(client):
    r = client.get('/')
    assert r.status_code == 200
    assert 'CareerLens' in r.text
    for url in ('/static/app.js', '/static/style.css'):
        assert client.get(url).status_code == 200
    assert "frame-ancestors 'none'" in r.headers['content-security-policy']


def test_external_browser_writes_blocked_but_same_origin_allowed(client):
    body = {'name': 'x', 'resume': 'Python 项目', 'job': '要求 Python'}
    assert client.post('/api/projects', json=body, headers={'Origin': 'https://evil.example'}).status_code == 403
    assert client.post('/api/projects', json=body, headers={'Origin': 'http://testserver'}).status_code == 201


def test_negative_evidence_and_invalid_job_quote_do_not_inflate_score(client):
    p = client.post('/api/projects', json={'name': 'x', 'resume': '没有 Docker 使用经验。技能：Python。', 'job': '要求 Docker 和 Python'}).json()
    client.app.state.service.model.generate = lambda *args: AnalysisDraft.model_validate({
        'summary': '诊断', 'issues': [], 'requirements': [
            {'name':'Docker', 'importance':'required', 'job_quote':'Docker', 'evidence':[{'quote':'没有 Docker 使用经验。', 'reason':'错误引用'}]},
            {'name':'Python', 'importance':'preferred', 'job_quote':'Python', 'evidence':[{'quote':'技能：Python。', 'reason':'仅技能'}]},
            {'name':'Java', 'importance':'required', 'job_quote':'Java 是必须的', 'evidence':[]}
        ]})
    a = client.post(f'/api/projects/{p["id"]}/analyze').json()
    assert len(a['requirements']) == 2
    assert a['requirements'][0]['status'] == 'missing'
    assert a['requirements'][1]['status'] == 'mentioned'
    # Independently calculated: (2*0 + 1*0.4) / 3 * 100 = 13.333…
    assert a['match_score'] == 13
    assert len(a['validation_warnings']) == 2


def test_all_invalid_requirements_dont_save_analysis(client):
    p = client.post('/api/projects', json={'name':'x', 'resume':'Python', 'job':'Python'}).json()
    client.app.state.service.model.generate = lambda *args: AnalysisDraft.model_validate({'summary':'test','issues':[], 'requirements':[{'name':'Java','importance':'required','job_quote':'不存在的岗位原句','evidence':[]}]})
    assert client.post(f'/api/projects/{p["id"]}/analyze').status_code == 503
    assert client.get(f'/api/projects/{p["id"]}').json()['analysis'] is None


def test_model_failure_does_not_consume_interview_round(client):
    p = client.post('/api/projects', json={'name':'x', 'resume':'Python 开发项目', 'job':'要求 Python'}).json()
    client.post(f'/api/projects/{p["id"]}/analyze')
    s = client.post(f'/api/projects/{p["id"]}/sessions', json={'rounds':5}).json()
    def fail(*args):
        raise ModelError('测试连接失败')
    client.app.state.service.model.generate = fail
    assert client.post(f'/api/sessions/{s["id"]}/answer', json={'answer':'本人编写了接口','version':0}).status_code == 503
    after = client.get(f'/api/sessions/{s["id"]}').json()
    assert after['version'] == 0
    assert after['turns'] == []
    assert after['question'] == s['question']


def test_retrieval_separates_user_facts_and_guide():
    rows = retrieve('Docker 容器部署', '我的项目使用 Docker 容器部署，完成接口测试。')
    assert rows[0]['source'] == '个人材料'
    assert 'Docker' in rows[0]['text']
    assert all(r['source'] in ('个人材料', '训练指南') for r in rows)


def test_gb18030_and_oversize_files():
    assert parse_document('中文.TXT', '教育背景与项目经历'.encode('gb18030'))['text'] == '教育背景与项目经历'
    with pytest.raises(HTTPException) as exc:
        parse_document('large.txt', b'a'*(10*1024*1024+1))
    assert exc.value.status_code == 413


def test_blank_and_overlong_inputs_rejected(client):
    for resume in ('   ', 'a'*5001):
        assert client.post('/api/projects', json={'name':'x','resume':resume,'job':'要求'}).status_code == 422
    assert client.post('/api/projects', json={'name':'x','resume':'abc','job':'b'*3001}).status_code == 422


def test_context_budget_rejects_instead_of_truncating():
    client=OllamaClient(Settings())
    with pytest.raises(ModelError, match='上下文预算'):
        client.generate(AnalysisDraft,'analysis',{'resume':'中'*15000,'job':'职位'})


def test_http_failure_and_truncated_generation_rejected():
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            self.rfile.read(int(self.headers['Content-Length']))
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"done":true,"done_reason":"length","message":{"content":"{}"}}')
        def log_message(self,*args):
            pass
    server=HTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    try:
        c=OllamaClient(Settings(ollama_url=f'http://127.0.0.1:{server.server_port}'))
        with pytest.raises(ModelError, match='长度上限'):
            c.generate(AnalysisDraft,'analysis',{'resume':'Python','job':'Python'})
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def test_example_five_round_flow_fits_default_model_budget(tmp_path, monkeypatch):
    """A synthetic HTTP transport verifies context assembly, not model quality."""
    import json
    import httpx
    from careerlens.config import ROOT
    from careerlens.llm import DemoClient
    from careerlens.schemas import Question
    real_client = httpx.Client
    demo = DemoClient(Settings(mode='demo'))
    schemas = {'analysis': AnalysisDraft, 'question': Question, 'feedback': Feedback}
    def respond(request):
        body = json.loads(request.content)
        task = json.loads(body['messages'][1]['content'])
        output = demo.generate(schemas[task['task']], task['task'], task['data'])
        return httpx.Response(200, json={'done':True, 'message':{'role':'assistant','content':output.model_dump_json()}})
    monkeypatch.setattr('careerlens.llm.httpx.Client', lambda **kw: real_client(transport=httpx.MockTransport(respond)))
    with TestClient(create_app(Settings(data_dir=tmp_path))) as c:
        p=c.post('/api/projects', json={'name':'测试', 'resume':(ROOT/'examples/resume.txt').read_text(encoding='utf-8'), 'job':(ROOT/'examples/job.txt').read_text(encoding='utf-8')}).json()
        result=c.post(f'/api/projects/{p["id"]}/analyze')
        assert result.status_code == 200, result.text
        s=c.post(f'/api/projects/{p["id"]}/sessions', json={'rounds':5}).json()
        assert 'id' in s, s
        for n in range(5):
            result=c.post(f'/api/sessions/{s["id"]}/answer', json={'answer':'我负责借阅接口开发，使用参数校验处理非法输入，并编写 20 个测试验证重复借阅与库存不足场景。', 'version':n})
            assert result.status_code == 200, result.text
        assert result.json()['status'] == 'completed'
