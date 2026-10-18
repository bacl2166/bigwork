import logging
from pathlib import Path
from urllib.parse import urlparse
from fastapi import FastAPI, UploadFile, File, Request, Response, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from .config import Settings, ROOT
from .service import CareerService
from .schemas import ProjectInput, ProjectUpdate, SessionInput, AnswerInput, StateInput
from .llm import ModelError
from .parser import parse_document, MAX_FILE
from .report import render_report


def create_app(settings=None):
    settings = settings or Settings()
    app = FastAPI(title='CareerLens 本地求职训练', version='1.0.0')
    service = CareerService(settings)
    app.state.service = service

    @app.middleware('http')
    async def local_browser_guard(request: Request, call_next):
        origin = request.headers.get('origin')
        allowed_origins = {str(request.base_url).rstrip('/')}
        if settings.public_origin:
            allowed_origins.add(settings.public_origin)
        if request.method not in ('GET', 'HEAD', 'OPTIONS') and origin and origin not in allowed_origins:
            return JSONResponse({'detail': '仅允许同源页面提交操作；通过反向代理访问时请核对 CAREERLENS_PUBLIC_ORIGIN 配置'}, status_code=403)
        response = await call_next(request)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'"
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.exception_handler(ModelError)
    async def model_error(request, exc):
        return JSONResponse({'detail': str(exc)}, status_code=503)

    @app.get('/api/health')
    def health():
        return service.health()

    @app.get('/api/examples')
    def examples():
        return {'resume': (ROOT/'examples'/'resume.txt').read_text(encoding='utf-8'), 'job': (ROOT/'examples'/'job.txt').read_text(encoding='utf-8')}

    @app.post('/api/parse')
    async def parse(file: UploadFile = File(...)):
        try:
            return parse_document(file.filename, await file.read(MAX_FILE+1))
        finally:
            await file.close()

    @app.get('/api/projects')
    def projects():
        return service.projects()

    @app.post('/api/projects', status_code=201)
    def create(data: ProjectInput):
        return service.create_project(data)

    @app.get('/api/projects/{id}')
    def project(id: str):
        return service.project(id)

    @app.patch('/api/projects/{id}')
    def update(id: str, data: ProjectUpdate):
        return service.update_project(id, data)

    @app.delete('/api/projects/{id}', status_code=204)
    def delete(id: str):
        service.delete_project(id)
        return Response(status_code=204)

    @app.post('/api/projects/{id}/analyze')
    def analyze(id: str):
        return service.analyze(id)

    @app.post('/api/projects/{id}/sessions', status_code=201)
    def start(id: str, data: SessionInput):
        return service.create_session(id, data.rounds)

    @app.get('/api/sessions')
    def sessions():
        return service.sessions()

    @app.get('/api/sessions/{id}')
    def session(id: str):
        return service.store.get('sessions', id)

    @app.post('/api/sessions/{id}/answer')
    def answer(id: str, data: AnswerInput):
        return service.answer(id, data)

    @app.post('/api/sessions/{id}/state')
    def state(id: str, data: StateInput):
        return service.state(id, data)

    @app.get('/api/projects/{id}/report', response_class=HTMLResponse)
    def project_report(id: str):
        p = service.project(id)
        if not p['analysis']:
            raise HTTPException(409, '请先完成分析')
        return render_report(p['analysis'])

    @app.get('/api/sessions/{id}/report', response_class=HTMLResponse)
    def session_report(id: str):
        s = service.store.get('sessions', id)
        return render_report(service.store.get('analyses', s['analysis_id']), s)

    @app.get('/', response_class=HTMLResponse)
    def index():
        return (ROOT/'static'/'index.html').read_text(encoding='utf-8')

    app.mount('/static', StaticFiles(directory=ROOT/'static'), name='static')
    return app
