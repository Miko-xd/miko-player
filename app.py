import threading
import time
import webview

from server import app


def run_flask():
    app.run(
        host="127.0.0.1",
        port=5000,
        threaded=True,
        use_reloader=False
    )


threading.Thread(target=run_flask, daemon=True).start()

time.sleep(2)

window = webview.create_window(
    "Miko Music Player",
    "http://127.0.0.1:5000",
    frameless=True,
    easy_drag=False,
    fullscreen=True
)
# window.maximize()

webview.start()
