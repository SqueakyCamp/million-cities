#!/usr/bin/env python3
"""Million Cities: quiz + atlas of the world's 1M+ cities (stdlib only).

Serves static/ (pre-gzipped *.gz files are sent when the browser accepts gzip) and
keeps the learning progress in data/state.json, so laptop and phone share it.

GET  /api/state   -> {"rev": n, "state": {...}}
PUT  /api/state   <- {"rev": n, "state": {...}}   409 + current state if rev is stale
"""
import json
import os
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / 'static'
STATE = ROOT / 'data' / 'state.json'
SETTINGS = ROOT / 'settings.local.json'
CFG = json.loads(SETTINGS.read_text()) if SETTINGS.exists() else {}
TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
         '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
         '.json': 'application/json', '.geojson': 'application/geo+json', '.svg': 'image/svg+xml',
         '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.pbf': 'application/x-protobuf'}
lock = threading.Lock()


def load_state():
    try:
        return json.loads(STATE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {'rev': 0, 'state': {}}


def save_state(doc):
    STATE.parent.mkdir(exist_ok=True)
    tmp = STATE.with_suffix('.tmp')
    tmp.write_text(json.dumps(doc, ensure_ascii=False))
    os.replace(tmp, STATE)


class Handler(BaseHTTPRequestHandler):
    server_version = 'MillionCities'

    def log_message(self, fmt, *args):
        pass

    def send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if path == '/api/state':
            with lock:
                return self.send_json(200, load_state())
        if path == '/':
            path = '/index.html'
        f = (STATIC / path.lstrip('/')).resolve()
        if STATIC not in f.parents or not f.is_file():
            return self.send_json(404, {'error': 'not found'})
        gz = f.with_name(f.name + '.gz')
        use_gz = gz.is_file() and 'gzip' in self.headers.get('Accept-Encoding', '')
        src = gz if use_gz else f
        etag = f'"{int(src.stat().st_mtime)}-{src.stat().st_size}"'
        # fonts and the map library never change; everything else is revalidated (cheap 304s)
        cache = 'max-age=604800' if '/vendor/' in path or '/fonts/' in path else 'no-cache'
        if self.headers.get('If-None-Match') == etag:
            self.send_response(304)
            self.send_header('ETag', etag)
            self.send_header('Cache-Control', cache)
            self.end_headers()
            return
        data = src.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', TYPES.get(f.suffix, 'application/octet-stream'))
        if use_gz:
            self.send_header('Content-Encoding', 'gzip')
        self.send_header('ETag', etag)
        self.send_header('Cache-Control', cache)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_PUT(self):
        if urlparse(self.path).path != '/api/state':
            return self.send_json(404, {'error': 'not found'})
        try:
            n = int(self.headers.get('Content-Length', 0))
            doc = json.loads(self.rfile.read(n))
            assert isinstance(doc.get('state'), dict)
        except Exception:
            return self.send_json(400, {'error': 'bad request'})
        with lock:
            cur = load_state()
            if doc.get('rev') != cur['rev']:
                return self.send_json(409, cur)
            new = {'rev': cur['rev'] + 1, 'state': doc['state']}
            save_state(new)
        self.send_json(200, {'rev': new['rev']})


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def server_bind(self):
        # IP_FREEBIND: may start before tailscale0 is up
        self.socket.setsockopt(socket.SOL_IP, 15, 1)
        super().server_bind()


if __name__ == '__main__':
    host, port = CFG.get('host', '127.0.0.1'), CFG.get('port', 8170)
    print(f'Million Cities on http://{host}:{port}', flush=True)
    Server((host, port), Handler).serve_forever()
