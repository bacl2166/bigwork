import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from uuid import uuid4


class Store:
    def __init__(self, directory):
        directory.mkdir(parents=True, exist_ok=True)
        self.path = directory / 'careerlens.sqlite3'
        with self.connection() as c:
            c.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS analyses (
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    body TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS analyses_project ON analyses(project_id);
                CREATE INDEX IF NOT EXISTS sessions_project ON sessions(project_id);
            ''')

    @contextmanager
    def connection(self, write=False):
        c = sqlite3.connect(self.path, timeout=20)
        c.execute('PRAGMA foreign_keys=ON')
        try:
            if write:
                c.execute('BEGIN IMMEDIATE')
            yield c
            c.commit()
        except Exception:
            c.rollback()
            raise
        finally:
            c.close()

    def get(self, table, id, connection=None):
        self._table(table)
        if connection is None:
            with self.connection() as c:
                return self.get(table, id, c)
        row = connection.execute(f'SELECT body FROM {table} WHERE id=?', (id,)).fetchone()
        if not row:
            from fastapi import HTTPException
            raise HTTPException(404, '记录不存在或已删除')
        return json.loads(row[0])

    def list(self, table):
        self._table(table)
        with self.connection() as c:
            rows = [json.loads(r[0]) for r in c.execute(f'SELECT body FROM {table}')]
        return sorted(rows, key=lambda x: x['updated_at'], reverse=True)

    def save(self, table, body, connection):
        self._table(table)
        data = json.dumps(body, ensure_ascii=False)
        if table == 'projects':
            connection.execute('INSERT INTO projects(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body', (body['id'], data))
        else:
            connection.execute(f'INSERT INTO {table}(id,project_id,body) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body', (body['id'], body['project_id'], data))

    @staticmethod
    def _table(table):
        if table not in {'projects', 'analyses', 'sessions'}:
            raise ValueError('Invalid table')


def record():
    now = datetime.now(timezone.utc).isoformat()
    return {'id': uuid4().hex, 'created_at': now, 'updated_at': now}


def timestamp():
    return datetime.now(timezone.utc).isoformat()
