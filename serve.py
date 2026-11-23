#!/usr/bin/env python3
"""Serves ErgExplorer Lite from this folder on http://localhost:8080 (or the port given).

   python3 serve.py [port]

Pages are linked as /transactions/<id> and /token/<id>, so those paths are answered with the
page's .html file, like the .htaccess rules do on Apache. Open the address it prints, then pick
your node; a node on your own network over plain http works from here.
"""
import http.server
import os
import sys

PAGES = ('addresses', 'transactions', 'boxes', 'blocks', 'mempool', 'issued-tokens', 'token',
         'latest-blocks', 'connect', 'oracles', 'about', 'index')
ROOT = os.path.dirname(os.path.abspath(__file__))


class LiteHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def translate_path(self, path):
        clean = path.split('?', 1)[0].split('#', 1)[0]
        first = clean.strip('/').split('/', 1)[0]

        if first in PAGES:
            return os.path.join(ROOT, first + '.html')

        return super().translate_path(path)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    server = http.server.ThreadingHTTPServer(('127.0.0.1', port), LiteHandler)
    print('ErgExplorer Lite on http://localhost:%d (Ctrl+C to stop)' % port)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
