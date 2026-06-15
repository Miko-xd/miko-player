import time
import webview
import socket
import urllib.request
import json
import subprocess
import sys
import os

def is_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0

# Start server as a separate background process only if it's not already running
if not is_port_in_use(5000):
    workspace_dir = os.path.dirname(os.path.abspath(__file__))
    server_py = os.path.join(workspace_dir, "server.py")
    
    python_exe = sys.executable
    if python_exe.endswith("pythonw.exe"):
        pythonw_exe = python_exe
    else:
        pythonw_exe = python_exe.replace("python.exe", "pythonw.exe")
        
    if not os.path.exists(pythonw_exe):
        pythonw_exe = python_exe
        
    subprocess.Popen(
        [pythonw_exe, server_py],
        cwd=workspace_dir,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    )
    time.sleep(1.5)

def on_closed():
    # Notify backend to pause the song when client UI is closed
    try:
        req = urllib.request.Request(
            "http://127.0.0.1:5000/api/report_state",
            data=json.dumps({"state": "paused"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=1) as resp:
            pass
    except Exception:
        pass

window = webview.create_window(
    "Miko Music Player",
    "http://127.0.0.1:5000",
    frameless=True,
    easy_drag=False,
    fullscreen=True    
)

window.events.closed += on_closed

webview.start(private_mode=False)
