"""
magicexe_drum_simulator_perfv2 dev server
Serves this directory directly (self-contained worktree — meshes/assets
live inside it, no parent-dir dependency needed).

Usage:
  python serve.py          → http://localhost:8085/
"""
import http.server, socketserver, os, webbrowser, threading

PORT = 8085
SERVE_DIR = os.path.dirname(os.path.abspath(__file__))

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=SERVE_DIR, **kwargs)

def open_browser():
    webbrowser.open(f'http://localhost:{PORT}/')

class ReusableTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

if __name__ == '__main__':
    os.chdir(SERVE_DIR)
    with ReusableTCPServer(('', PORT), QuietHandler) as httpd:
        print(f'Serving {SERVE_DIR}')
        print(f'Open → http://localhost:{PORT}/magicexe_drum_simulator/')
        threading.Timer(0.8, open_browser).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nStopped.')
