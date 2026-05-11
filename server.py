import os
import time
import threading
import json
import requests

from flask import Flask, jsonify, request, send_from_directory, Response, stream_with_context
from flask_cors import CORS
from yt_dlp import YoutubeDL
import syncedlyrics

app = Flask(__name__, static_folder="web", static_url_path="")
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
CORS(app)

@app.after_request
def add_header(response):
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, post-check=0, pre-check=0, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '-1'
    return response

state_lock = threading.Lock()

# Single global session — no login needed
session = {
    "current_song": {
        "title": "", "artist": "", "track": "", "thumbnail": "",
        "duration": 0, "lyrics": [], "state": "stopped", "position": 0
    },
    "play_queue": [],
    "play_queue_idx": -1,
    "audio_url": "",
    "video_id": ""
}


def _search_youtube(query):
    ydl_opts = {
        "format": "bestaudio/best",
        "quiet": True,
        "noplaylist": True,
        "extractor_args": {"youtube": {"player_client": ["android", "web"]}},
    }
    with YoutubeDL(ydl_opts) as ydl:
        if "youtube.com/watch" in query or "youtu.be" in query:
            info = ydl.extract_info(query, download=False)
        else:
            info = ydl.extract_info(f"ytsearch1:{query} official audio", download=False)
            info = info["entries"][0]
    return info

def _fetch_youtube_mix(video_id):
    ydl_opts = {
        "extract_flat": True,
        "quiet": True,
        "extractor_args": {"youtube": {"player_client": ["android", "web"]}},
    }
    mix_url = f"https://www.youtube.com/watch?v={video_id}&list=RD{video_id}"
    try:
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(mix_url, download=False)
            if "entries" in info:
                return info["entries"]
    except Exception as e:
        pass
    return []

def _fetch_lyrics(query):
    try:
        raw = syncedlyrics.search(query, synced_only=True)
    except Exception:
        raw = None
    if not raw: return []
    parsed = []
    for line in raw.splitlines():
        if line.startswith("[") and "]" in line:
            try:
                ts = line[1:line.index("]")]
                text = line[line.index("]") + 1:].strip()
                mins, secs = ts.split(":")
                total = int(mins) * 60 + float(secs)
                if text: parsed.append({"time": total, "text": text})
            except Exception: pass
    return parsed

def _play_video_obj(video, is_prefetched=False):
    raw_title = video.get("title", "Unknown")
    artist = video.get("artist", "") or video.get("channel", "")
    track = video.get("track", "")
    thumb = video.get("thumbnail", "")
    duration = video.get("duration", 0)
    video_id = video.get("id", "")

    lyrics_q = raw_title
    if artist and track: lyrics_q = f"{artist} {track}"
    elif " - " in raw_title: lyrics_q = raw_title.replace(" - ", " ")

    audio_url = None
    for f in video.get("formats", []):
        if f.get("acodec") != "none" and f.get("vcodec") == "none":
            audio_url = f.get("url")
            break
    if not audio_url: audio_url = video.get("url")

    with state_lock:
        session["audio_url"] = audio_url
        session["video_id"] = video_id
        session["current_song"].update({
            "title": raw_title,
            "artist": artist,
            "track": track,
            "thumbnail": thumb,
            "duration": duration,
            "state": "playing",
            "position": 0,
            "lyrics": []
        })
    
    def fetch_l():
        lyrics = _fetch_lyrics(lyrics_q)
        with state_lock:
            session["current_song"]["lyrics"] = lyrics
    threading.Thread(target=fetch_l, daemon=True).start()

def _prefetch_next_song():
    with state_lock:
        if session["play_queue_idx"] + 1 >= len(session["play_queue"]): return
        next_item = session["play_queue"][session["play_queue_idx"] + 1]
    
    if "prefetched_data" not in next_item:
        try:
            video = _search_youtube(f"https://www.youtube.com/watch?v={next_item['id']}")
            audio_url = None
            for f in video.get("formats", []):
                if f.get("acodec") != "none" and f.get("vcodec") == "none":
                    audio_url = f.get("url")
                    break
            if not audio_url: audio_url = video.get("url")
            
            if audio_url:
                with state_lock:
                    if session["play_queue_idx"] + 1 < len(session["play_queue"]) and session["play_queue"][session["play_queue_idx"] + 1]["id"] == next_item["id"]:
                        session["play_queue"][session["play_queue_idx"] + 1]["prefetched_data"] = video
        except Exception: pass

def _play_queue_index(idx):
    with state_lock:
        if idx < 0 or idx >= len(session["play_queue"]): return
        session["play_queue_idx"] = idx
        q_item = session["play_queue"][idx]
        session["current_song"].update({"state": "loading", "title": f"Loading: {q_item.get('title')}...", "artist": "", "duration": 0})
        session["audio_url"] = ""

    def _do():
        try:
            video = q_item.get("prefetched_data")
            if video:
                try: _play_video_obj(video)
                except Exception: video = None
            if not video:
                video = _search_youtube(f"https://www.youtube.com/watch?v={q_item['id']}")
                _play_video_obj(video)
            threading.Thread(target=_prefetch_next_song, daemon=True).start()
        except Exception as e:
            with state_lock: session["current_song"]["state"] = "stopped"

    threading.Thread(target=_do, daemon=True).start()

# ROUTES

@app.route("/")
def index():
    return send_from_directory("web", "index.html")

@app.route("/api/search")
def api_search():
    q = request.args.get("q", "").strip()
    if not q: return jsonify([])
    ydl_opts = {
        "quiet": True, "noplaylist": True, "extract_flat": True, "skip_download": True,
        "extractor_args": {"youtube": {"player_client": ["android", "web"]}},
    }
    try:
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"ytsearch8:{q}", download=False)
        results = []
        for entry in info.get("entries", []):
            results.append({
                "title": entry.get("title", "Unknown"),
                "channel": entry.get("channel") or entry.get("uploader") or "",
                "thumbnail": entry.get("thumbnail") or f"https://i.ytimg.com/vi/{entry.get('id', '')}/hqdefault.jpg",
                "duration": entry.get("duration") or 0,
                "video_id": entry.get("id", ""),
            })
        return jsonify(results)
    except Exception as e: return jsonify({"error": str(e)}), 500

@app.route("/api/play", methods=["POST"])
def api_play():
    data = request.get_json(force=True)
    query = data.get("query", "").strip()
    if not query: return jsonify({"error": "Missing query"}), 400
    
    with state_lock:
        session["current_song"].update({"state": "loading", "title": "Searching…", "artist": ""})
        session["play_queue"] = []
        session["play_queue_idx"] = -1
        session["audio_url"] = ""

    def _do_play():
        try:
            video = _search_youtube(query)
            video_id = video.get("id")
            with state_lock:
                session["play_queue"] = [{
                    "id": video_id, "title": video.get("title", "Unknown"),
                    "artist": video.get("channel", ""), "duration": video.get("duration", 0),
                    "thumbnail": video.get("thumbnail", "")
                }]
                session["play_queue_idx"] = 0
            
            _play_video_obj(video)

            if video_id:
                mix_entries = _fetch_youtube_mix(video_id)
                with state_lock:
                    if session["play_queue"] and session["play_queue"][0]["id"] == video_id:
                        for e in mix_entries[1:]:
                            if e.get("id"):
                                session["play_queue"].append({
                                    "id": e.get("id"), "title": e.get("title", "Unknown"),
                                    "artist": e.get("uploader", ""), "duration": e.get("duration", 0),
                                    "thumbnail": f"https://i.ytimg.com/vi/{e.get('id')}/hqdefault.jpg"
                                })
                        threading.Thread(target=_prefetch_next_song, daemon=True).start()
        except Exception as e:
            with state_lock: session["current_song"]["state"] = "stopped"

    threading.Thread(target=_do_play, daemon=True).start()
    return jsonify({"status": "ok"})

@app.route("/api/next", methods=["POST"])
def api_next():
    if session["play_queue_idx"] + 1 < len(session["play_queue"]):
        _play_queue_index(session["play_queue_idx"] + 1)
    return jsonify({"status": "ok"})

@app.route("/api/prev", methods=["POST"])
def api_prev():
    if session["play_queue_idx"] > 0:
        _play_queue_index(session["play_queue_idx"] - 1)
    return jsonify({"status": "ok"})

@app.route("/api/jump_queue", methods=["POST"])
def api_jump_queue():
    data = request.get_json(force=True)
    idx = data.get("index", -1)
    _play_queue_index(idx)
    return jsonify({"status": "ok"})

@app.route("/api/add_next", methods=["POST"])
def api_add_next():
    data = request.get_json(force=True)
    video_id = data.get("id")
    
    if video_id:
        with state_lock:
            insert_idx = session["play_queue_idx"] + 1 if session["play_queue_idx"] >= 0 else 0
            session["play_queue"].insert(insert_idx, {
                "id": video_id, "title": data.get("title", "Unknown"),
                "artist": data.get("artist", ""), "duration": 0,
                "thumbnail": data.get("thumbnail", f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg")
            })
        if insert_idx == session["play_queue_idx"] + 1:
            threading.Thread(target=_prefetch_next_song, daemon=True).start()
    return jsonify({"status": "ok"})

@app.route("/api/report_state", methods=["POST"])
def api_report_state():
    data = request.get_json(force=True)
    with state_lock:
        session["current_song"]["state"] = data.get("state", session["current_song"]["state"])
        session["current_song"]["position"] = data.get("position", session["current_song"]["position"])
    return jsonify({"status": "ok"})

@app.route("/api/status")
def api_status():
    return jsonify({
        "current_song": session["current_song"],
        "queue": session["play_queue"],
        "queue_index": session["play_queue_idx"],
        "video_id": session["video_id"]
    })

@app.route("/api/stream")
def api_stream():
    audio_url = session.get("audio_url")
    if not audio_url: return "No audio", 404
    try:
        headers = {}
        range_header = request.headers.get("Range")
        if range_header: headers["Range"] = range_header
        
        req = requests.get(audio_url, headers=headers, stream=True, timeout=10)
        
        resp = Response(stream_with_context(req.iter_content(chunk_size=1024*64)), status=req.status_code, content_type=req.headers.get('content-type', 'audio/webm'))
        if "Content-Range" in req.headers: resp.headers["Content-Range"] = req.headers["Content-Range"]
        if "Accept-Ranges" in req.headers: resp.headers["Accept-Ranges"] = req.headers["Accept-Ranges"]
        if "Content-Length" in req.headers: resp.headers["Content-Length"] = req.headers["Content-Length"]
        return resp
    except Exception as e:
        return str(e), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, threaded=True)
