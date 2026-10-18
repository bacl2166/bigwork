"""Integration contracts: real SQLite, parsing, services and HTTP boundaries."""
import io
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from fastapi.testclient import TestClient

from careerlens.app import create_app
from careerlens.config import Settings
from careerlens.llm import OllamaClient, ModelError
from careerlens.schemas import AnalysisDraft


RESUME = "张同学\n教育背景：计算机科学本科\n技能：Python、SQL、Git\n项目经历：使用 Python 和 SQL 开发图书管理系统，实现借阅接口，编写了 20 个测试。"
JOB = "Python 后端实习生\n要求熟悉 Python 和 SQL，掌握 Docker，具备接口开发与团队协作能力。"


@pytest.fixture
def client(tmp_path):
    app = create_app(Settings(data_dir=tmp_path, mode="demo"))
    with TestClient(app) as c:
        yield c


def project(client):
    result = client.post('/api/projects', json={"name": "后端实习", "resume": RESUME, "job": JOB})
    assert result.status_code == 201, result.text
    return result.json()


def analyzed(client):
    p = project(client)
    r = client.post(f'/api/projects/{p["id"]}/analyze')
    assert r.status_code == 200, r.text
    return p, r.json()


def test_analysis_links_requirements_to_real_evidence(client):
    p, a = analyzed(client)
    python = next(r for r in a['requirements'] if r['name'] == 'Python')
    docker = next(r for r in a['requirements'] if r['name'] == 'Docker')
    assert python['status'] == 'proven'
    assert docker['status'] == 'missing'
    assert all(e['quote'] in RESUME for e in python['evidence'])
    assert 0 < a['match_score'] < 100
    assert a['mode'] == 'demo'
    assert client.get(f'/api/projects/{p["id"]}').json()['analysis']['id'] == a['id']


def test_invalid_model_evidence_is_dropped(client):
    p = project(client)
    model = client.app.state.service.model
    original = model.generate
    def generate(schema, task, payload):
        if task == 'analysis':
            return AnalysisDraft.model_validate({
                "requirements": [{"name": "Docker", "importance": "required", "job_quote": "掌握 Docker", "evidence": [{"quote": "我负责百万用户平台", "reason": "经验"}]}],
                "issues": [], "summary": "test"
            })
        return original(schema, task, payload)
    model.generate = generate
    a = client.post(f'/api/projects/{p["id"]}/analyze').json()
    assert a['requirements'][0]['evidence'] == []
    assert a['requirements'][0]['status'] == 'missing'
    assert a['match_score'] == 0
    assert a['validation_warnings']


def test_material_update_invalidates_analysis_but_preserves_interview_snapshot(client):
    p, a = analyzed(client)
    s = client.post(f'/api/projects/{p["id"]}/sessions', json={"rounds": 5}).json()
    r = client.patch(f'/api/projects/{p["id"]}', json={"name": "新目标", "resume": "新的真实材料", "job": JOB, "revision": p['revision']})
    assert r.status_code == 200
    assert r.json()['analysis'] is None
    assert client.get(f'/api/sessions/{s["id"]}').json()['analysis_id'] == a['id']
    assert client.post(f'/api/projects/{p["id"]}/sessions', json={"rounds": 5}).status_code == 409


def test_five_round_interview_persists_feedback_and_completes(client):
    p, _ = analyzed(client)
    s = client.post(f'/api/projects/{p["id"]}/sessions', json={"rounds": 5}).json()
    for turn in range(5):
        r = client.post(f'/api/sessions/{s["id"]}/answer', json={"answer": "我负责图书管理接口。为减少重复查询，我增加索引并编写测试，最终完成了借阅流程。", "version": turn})
        assert r.status_code == 200, r.text
        s = r.json()
        assert len(s['turns']) == turn + 1
        assert s['turns'][-1]['feedback']['reason']
        assert all(0 <= x <= 5 for x in s['turns'][-1]['feedback']['scores'].values())
    assert s['status'] == 'completed'
    assert s['question'] is None
    assert len(client.get('/api/sessions').json()) == 1
    assert client.post(f'/api/sessions/{s["id"]}/answer', json={"answer": "继续", "version": 5}).status_code == 409


def test_pause_resume_and_duplicate_answer_protection(client):
    p, _ = analyzed(client)
    s = client.post(f'/api/projects/{p["id"]}/sessions', json={"rounds": 5}).json()
    assert client.post(f'/api/sessions/{s["id"]}/state', json={"action": "pause", "version": 0}).json()['status'] == 'paused'
    assert client.post(f'/api/sessions/{s["id"]}/answer', json={"answer": "回答", "version": 1}).status_code == 409
    s = client.post(f'/api/sessions/{s["id"]}/state', json={"action": "resume", "version": 1}).json()
    assert s['status'] == 'active'
    assert client.post(f'/api/sessions/{s["id"]}/answer', json={"answer": "回答", "version": 2}).status_code == 200
    assert client.post(f'/api/sessions/{s["id"]}/answer', json={"answer": "重复", "version": 2}).status_code == 409


def test_report_escapes_user_html_and_has_interview_evidence(client):
    p = client.post('/api/projects', json={"name": '<script>alert(1)</script>', "resume": RESUME, "job": JOB}).json()
    client.post(f'/api/projects/{p["id"]}/analyze')
    s = client.post(f'/api/projects/{p["id"]}/sessions', json={"rounds": 5}).json()
    client.post(f'/api/sessions/{s["id"]}/answer', json={"answer": "<script>bad()</script> 我负责接口", "version": 0})
    r = client.get(f'/api/sessions/{s["id"]}/report')
    assert r.status_code == 200
    assert '<script>' not in r.text
    assert '&lt;script&gt;' in r.text
    assert '岗位证据矩阵' in r.text
    assert '回答相关性' in r.text
    assert '规则演示' in r.text


def test_delete_project_removes_sessions_and_analyses(client):
    p, _ = analyzed(client)
    s = client.post(f'/api/projects/{p["id"]}/sessions', json={"rounds": 5}).json()
    assert client.delete(f'/api/projects/{p["id"]}').status_code == 204
    assert client.get(f'/api/sessions/{s["id"]}').status_code == 404
    assert client.get('/api/projects').json() == []


def test_parser_txt_docx_pdf_and_rejection(client):
    from docx import Document
    from pypdf import PdfWriter
    r = client.post('/api/parse', files={"file": ('resume.txt', RESUME.encode(), 'text/plain')})
    assert r.status_code == 200
    assert '图书管理' in r.json()['text']
    doc = Document()
    doc.add_paragraph(RESUME)
    stream = io.BytesIO()
    doc.save(stream)
    assert 'SQL' in client.post('/api/parse', files={"file": ('resume.docx', stream.getvalue())}).json()['text']
    writer = PdfWriter()
    writer.add_blank_page(width=400, height=400)
    stream = io.BytesIO()
    writer.write(stream)
    r = client.post('/api/parse', files={"file": ('scanned.pdf', stream.getvalue())})
    assert r.status_code == 422
    assert 'OCR' in r.json()['detail']
    assert client.post('/api/parse', files={"file": ('bad.exe', b'123')}).status_code == 415
    assert client.post('/api/parse', files={"file": ('bad.docx', b'bad')}).status_code == 422


def test_validation_and_missing_resources(client):
    assert client.post('/api/projects', json={"name": "a", "resume": "", "job": JOB}).status_code == 422
    assert client.get('/api/projects/not-an-id').status_code == 404
    p = project(client)
    assert client.post(f'/api/projects/{p["id"]}/sessions', json={"rounds": 5}).status_code == 409
    assert client.patch(f'/api/projects/{p["id"]}', json={"name": "a", "resume": RESUME, "job": JOB, "revision": 99}).status_code == 409
    assert client.post(f'/api/projects/{p["id"]}/sessions', json={"rounds": 100}).status_code == 422


def test_database_persists_between_app_instances(tmp_path):
    config = Settings(data_dir=tmp_path, mode='demo')
    with TestClient(create_app(config)) as c:
        p = project(c)
    with TestClient(create_app(config)) as c:
        assert c.get(f'/api/projects/{p["id"]}').json()['resume'] == RESUME


def test_health_exposes_mode_and_model_failure_is_not_silently_demo(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path, ollama_url='http://127.0.0.1:1', timeout=0.1))) as c:
        h = c.get('/api/health').json()
        assert h['mode'] == 'ollama'
        assert h['model_ready'] is False
        p = project(c)
        assert c.post(f'/api/projects/{p["id"]}/analyze').status_code == 503
        assert c.get(f'/api/projects/{p["id"]}').json()['analysis'] is None


def test_model_json_over_http_validated_and_bad_response_rejected():
    responses = [json.dumps({"message": {"role": "assistant", "content": json.dumps({"requirements": [{"name": "Python", "importance": "required", "job_quote": "Python", "evidence": []}], "issues": [], "summary": "test"})}, "done": True}), '{"message":{"content":"not-json"},"done":true}']
    received = []
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            received.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
            self.send_response(200)
            self.end_headers()
            self.wfile.write(responses.pop(0).encode())
        def log_message(self, *args):
            pass
    server = HTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        model = OllamaClient(Settings(ollama_url=f'http://127.0.0.1:{server.server_port}'))
        assert model.generate(AnalysisDraft, 'analysis', {'resume': RESUME, 'job': JOB}).summary == 'test'
        assert received[0]['stream'] is False
        assert received[0]['format']['type'] == 'object'
        with pytest.raises(ModelError):
            model.generate(AnalysisDraft, 'analysis', {})
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def test_remote_model_host_is_rejected():
    with pytest.raises(ValueError):
        Settings(ollama_url='https://example.com')
