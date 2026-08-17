#!/usr/bin/env python3
"""
Antigravity PDF Studio - Local Development Web Server
Runs a lightweight HTTP server with Range-Header and CORS support for PDF.js streaming.
"""
import http.server
import socketserver
import os
import sys

PORT = 8080

class PDFStudioHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Enable Cross-Origin isolation & CORS for PDF worker streaming
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Range')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

def run_server():
    dir_path = os.path.dirname(os.path.realpath(__file__))
    os.chdir(dir_path)
    
    handler = PDFStudioHTTPRequestHandler
    with socketserver.TCPServer(("", PORT), handler) as httpd:
        print("============================================================")
        print(f"[INFO] Antigravity PDF Studio Server Started!")
        print(f"[URL]  http://localhost:{PORT}")
        print("============================================================")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")
            sys.exit(0)

if __name__ == "__main__":
    run_server()
