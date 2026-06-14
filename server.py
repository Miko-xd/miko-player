import os
import time
import threading
import json
import uuid
import requests
import re
import urllib.parse

from flask import Flask, jsonify, request, send_from_directory, Response, stream_with_context
from flask_cors import CORS
from yt_dlp import YoutubeDL
import syncedlyrics

app = Flask(__name__, static_folder="web", static_url_path="")
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
CORS(app)

# ─── Data directory setup ───
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
PLAYLISTS_DIR = os.path.join(DATA_DIR, "playlists")
COVERS_DIR = os.path.join(DATA_DIR, "covers")
LIKED_FILE = os.path.join(DATA_DIR, "liked_songs.json")
PLAYLISTS_INDEX = os.path.join(PLAYLISTS_DIR, "_index.json")
HISTORY_FILE = os.path.join(DATA_DIR, "history.json")

for d in [DATA_DIR, PLAYLISTS_DIR, COVERS_DIR]:
    os.makedirs(d, exist_ok=True)

def _read_json(path, default=None):
    if default is None:
        default = {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default

def _write_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

# Init files if missing
if not os.path.exists(LIKED_FILE):
    _write_json(LIKED_FILE, {"songs": []})
if not os.path.exists(PLAYLISTS_INDEX):
    _write_json(PLAYLISTS_INDEX, [])
if not os.path.exists(HISTORY_FILE):
    _write_json(HISTORY_FILE, {"songs": []})

@app.after_request
def add_header(response):
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, post-check=0, pre-check=0, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '-1'
    return response

state_lock = threading.Lock()

# Cache for dashboard recommendations (stale after 10 mins)
dashboard_cache = {
    "data": None,
    "timestamp": 0
}

# Single global session — no login needed
session = {
    "current_song": {
        "title": "", "artist": "", "track": "", "thumbnail": "",
        "duration": 0, "lyrics": [], "state": "stopped", "position": 0
    },
    "play_queue": [],
    "play_queue_idx": -1,
    "audio_url": "",
    "video_id": "",
    "play_mode": "smart_shuffle"  # list, shuffle, smart_shuffle
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

GENRE_MAP = {
    "hip-hop/rap": "Hip-Hop",
    "hip-hop": "Hip-Hop",
    "rap": "Hip-Hop",
    "dhh": "DHH",
    "j-pop": "J-Pop",
    "jpop": "J-Pop",
    "anime": "J-Pop",
    "soundtrack": "Soundtracks",
    "tv soundtrack": "Soundtracks",
    "indian pop": "Bollywood",
    "indian": "Bollywood",
    "bollywood": "Bollywood",
    "electronic": "Electronic",
    "dance": "Electronic",
    "house": "Electronic",
    "techno": "Electronic",
    "jazz": "Jazz & Classical",
    "blues": "Jazz & Classical",
    "classical": "Jazz & Classical",
    "rock": "Rock",
    "metal": "Rock",
    "pop": "Pop",
    "lofi": "Lo-Fi",
    "lo-fi": "Lo-Fi"
}

def _clean_title_for_search(title):
    # Remove common video titles suffixes
    title = re.sub(r'\[.*?\]', '', title) # Remove [...]
    title = re.sub(r'\(.*?\)', '', title) # Remove (...)
    title = re.sub(r'\b(official|music|video|audio|lyrics|lyrical|hd|4k|cover|remix|prod by|produced by|prod\. by)\b', '', title, flags=re.IGNORECASE)
    title = re.sub(r'\s*\|\s*', ' ', title)
    title = re.sub(r'\s*-\s*', ' ', title)
    title = re.sub(r'\s+', ' ', title).strip()
    return title

def _query_itunes_genre(clean_query):
    encoded_query = urllib.parse.quote(clean_query)
    url = f"https://itunes.apple.com/search?term={encoded_query}&limit=3&media=music"
    try:
        r = requests.get(url, timeout=3)
        if r.status_code == 200:
            data = r.json()
            results = data.get("results", [])
            if results:
                return results[0].get("primaryGenreName")
    except Exception:
        pass
    return None

def _guess_genre_from_video(video):
    title = video.get("title", "").lower()
    channel = (video.get("channel") or video.get("uploader") or "").lower()
    tags = [t.lower() for t in video.get("tags", [])] if video.get("tags") else []
    
    # Combined search string
    search_str = f"{title} {channel} {' '.join(tags)}"
    
    # 1. High-Confidence Local Matches (e.g. Lo-Fi edits of pop/rock, DHH)
    if any(k in search_str for k in ["lofi", "lo-fi", "chillhop", "chill vibe", "chilledcow", "lopoly", "chillout", "sleep beats", "study beats"]):
        return "Lo-Fi"
    if any(k in search_str for k in ["dhh", "seedhe maut", "kr$na", "raftaar", "divine", "emiway", "mc stan", "yashraj", "hanumankind", "boyblanck", "wolf.cryman", "nanku", "natiq", "karun", "talha anjum", "talhah yunus", "young stunners", "calm", "encore abj"]):
        return "DHH"
    if any(k in search_str for k in ["yoasobi", "vocaloid", "ado", "eve", "radwimps", "kenshi yonezu", "fujii kaze", "lisa"]):
        return "J-Pop"

    # 2. iTunes API Match
    query = _clean_title_for_search(video.get("title", ""))
    itunes_genre = None
    if query:
        if channel and channel.lower() not in query.lower():
            itunes_genre = _query_itunes_genre(f"{query} {channel}")
        if not itunes_genre:
            itunes_genre = _query_itunes_genre(query)
        
    if itunes_genre:
        itunes_genre_lower = itunes_genre.lower()
        # Try to map iTunes genre to our standardized genres
        for k, standard in GENRE_MAP.items():
            if k in itunes_genre_lower:
                return standard
        return itunes_genre

    # 3. Fallback Keyword Match (Broader keywords)
    if any(k in search_str for k in ["jpop", "j-pop", "anime", "japanese"]):
        return "J-Pop"
    if any(k in search_str for k in ["bollywood", "hindi", "punjabi", "t-series", "zeemusic", "saregama", "arijit", "badshah", "nehakakkar", "indipop", "shreya ghoshal", "sonu nigam", "jubin nautiyal"]):
        return "Bollywood"
    if any(k in search_str for k in ["hiphop", "hip-hop", "rap", "rapper", "trap", "eminem", "drake", "lofi rap", "kendrick"]):
        return "Hip-Hop"
    if any(k in search_str for k in ["rock", "metal", "grunge", "punk", "linkin park", "nirvana", "queen", "ac/dc", "led zeppelin"]):
        return "Rock"
    if any(k in search_str for k in ["edm", "electronic", "synthwave", "techno", "house", "remix", "dubstep", "alan walker", "marshmello"]):
        return "Electronic"
    if any(k in search_str for k in ["jazz", "blues", "classical", "piano", "orchestra", "violin", "mozart", "beethoven"]):
        return "Jazz & Classical"
    if any(k in search_str for k in ["pop", "billboard", "taylor swift", "ariana grande", "justin bieber", "dualipa", "bts", "kpop", "k-pop"]):
        return "Pop"
        
    # Default fallback
    if video.get("genre"):
        g = video["genre"]
        if g and g.strip().lower() not in ["music", "unknown", "none"]:
            return g.strip()
            
    if video.get("categories"):
        cat = video["categories"][0]
        if cat and cat.strip().lower() not in ["music", "unknown", "none"]:
            return cat.strip()
            
    return "Pop"



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
    
    # Append to playback history
    try:
        # Resolve song genre
        genre = "Unknown"
        # 1. Check if liked
        liked = _read_json(LIKED_FILE, {"songs": []})
        for s in liked.get("songs", []):
            if s.get("video_id") == video_id and s.get("genre"):
                genre = s["genre"]
                break
        
        # 2. Check playlists
        if genre == "Unknown":
            for pfile in os.listdir(PLAYLISTS_DIR):
                if pfile.endswith(".json") and pfile != "_index.json":
                    pdata = _read_json(os.path.join(PLAYLISTS_DIR, pfile), {"songs": []})
                    for s in pdata.get("songs", []):
                        if s.get("video_id") == video_id and s.get("genre"):
                            genre = s["genre"]
                            break
                    if genre != "Unknown":
                        break
        
        # 3. Check video categories/genres
        if genre == "Unknown" or genre == "Music":
            genre = _guess_genre_from_video(video)

        hist = _read_json(HISTORY_FILE, {"songs": []})
        songs = hist.get("songs", [])
        songs = [s for s in songs if s.get("video_id") != video_id]
        songs.insert(0, {
            "video_id": video_id,
            "title": raw_title,
            "artist": artist,
            "thumbnail": thumb,
            "genre": genre
        })
        hist["songs"] = songs[:30]  # Keep last 30 played songs
        _write_json(HISTORY_FILE, hist)
        
        # Update dashboard cache recently played list instantly
        if dashboard_cache["data"] is not None:
            dashboard_cache["data"]["recently_played"] = hist["songs"]
    except Exception:
        pass
    
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

# ═══════════════════════ ROUTES ═══════════════════════

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

            # Only fetch mix in smart_shuffle mode
            if video_id and session.get("play_mode") == "smart_shuffle":
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

@app.route("/api/play_list", methods=["POST"])
def api_play_list():
    """Play a list of songs (from playlist or liked songs)."""
    data = request.get_json(force=True)
    songs = data.get("songs", [])
    start_idx = data.get("start_index", 0)
    mode = data.get("mode", "list")  # list, shuffle, smart_shuffle
    
    if not songs:
        return jsonify({"error": "No songs"}), 400
    
    import random
    if mode == "shuffle":
        # Keep the start song first, shuffle rest
        start_song = songs[start_idx] if start_idx < len(songs) else songs[0]
        rest = [s for i, s in enumerate(songs) if i != start_idx]
        random.shuffle(rest)
        songs = [start_song] + rest
        start_idx = 0
    
    with state_lock:
        session["play_mode"] = mode
        session["play_queue"] = [{"id": s["video_id"], "title": s["title"], "artist": s.get("artist", ""), "duration": 0, "thumbnail": s.get("thumbnail", "")} for s in songs]
        session["play_queue_idx"] = -1
    
    _play_queue_index(start_idx)
    return jsonify({"status": "ok"})

@app.route("/api/play_mode", methods=["POST"])
def api_play_mode():
    data = request.get_json(force=True)
    mode = data.get("mode", "smart_shuffle")
    if mode in ("list", "shuffle", "smart_shuffle"):
        session["play_mode"] = mode
    return jsonify({"status": "ok", "mode": session["play_mode"]})

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
        "video_id": session["video_id"],
        "play_mode": session.get("play_mode", "smart_shuffle")
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

# ═══════════════════════ LIKED SONGS ═══════════════════════

@app.route("/api/like", methods=["POST"])
def api_like():
    data = request.get_json(force=True)
    vid = data.get("video_id", "").strip()
    if not vid:
        return jsonify({"error": "Missing video_id"}), 400
    
    liked = _read_json(LIKED_FILE, {"songs": []})
    existing = [s for s in liked["songs"] if s["video_id"] == vid]
    
    if existing:
        liked["songs"] = [s for s in liked["songs"] if s["video_id"] != vid]
        _write_json(LIKED_FILE, liked)
        return jsonify({"status": "unliked", "liked": False})
    else:
        song = {
            "video_id": vid,
            "title": data.get("title", "Unknown"),
            "artist": data.get("artist", ""),
            "thumbnail": data.get("thumbnail", ""),
            "genre": "Unknown",
            "added_at": time.strftime("%Y-%m-%dT%H:%M:%S")
        }
        liked["songs"].insert(0, song)
        _write_json(LIKED_FILE, liked)
        return jsonify({"status": "liked", "liked": True})

@app.route("/api/liked")
def api_liked():
    genre = request.args.get("genre", "").strip()
    liked = _read_json(LIKED_FILE, {"songs": []})
    songs = liked.get("songs", [])
    if genre and genre.lower() != "all":
        songs = [s for s in songs if s.get("genre", "Unknown").lower() == genre.lower()]
    return jsonify({"songs": songs})

@app.route("/api/liked/genres")
def api_liked_genres():
    liked = _read_json(LIKED_FILE, {"songs": []})
    genres = list(set(s.get("genre", "Unknown") for s in liked.get("songs", [])))
    genres.sort()
    return jsonify({"genres": genres})

@app.route("/api/is_liked")
def api_is_liked():
    vid = request.args.get("video_id", "")
    liked = _read_json(LIKED_FILE, {"songs": []})
    is_liked = any(s["video_id"] == vid for s in liked.get("songs", []))
    return jsonify({"liked": is_liked})

def _search_recommendations(query, count=8):
    ydl_opts = {
        "quiet": True, "noplaylist": True, "extract_flat": True, "skip_download": True,
        "extractor_args": {"youtube": {"player_client": ["android", "web"]}},
    }
    try:
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"ytsearch{count}:{query}", download=False)
        results = []
        for entry in info.get("entries", []):
            if entry.get("id"):
                results.append({
                    "video_id": entry.get("id", ""),
                    "title": entry.get("title", "Unknown"),
                    "artist": entry.get("channel") or entry.get("uploader") or "",
                    "thumbnail": entry.get("thumbnail") or f"https://i.ytimg.com/vi/{entry.get('id', '')}/hqdefault.jpg"
                })
        return results
    except Exception:
        return []

def _generate_dashboard_data():
    hist = _read_json(HISTORY_FILE, {"songs": []})
    liked = _read_json(LIKED_FILE, {"songs": []})
    
    # Combine history and liked songs to analyze tastes
    all_user_songs = hist.get("songs", []) + liked.get("songs", [])
    
    # Count genres and track artists
    genre_counts = {}
    genre_artists = {}
    
    for s in all_user_songs:
        g = s.get("genre", "Unknown")
        if not g or g == "Unknown":
            continue
        genre_counts[g] = genre_counts.get(g, 0) + 1
        
        artist = s.get("artist")
        if artist:
            if g not in genre_artists:
                genre_artists[g] = {}
            genre_artists[g][artist] = genre_artists[g].get(artist, 0) + 1
            
    # Sort genres by frequency
    sorted_genres = sorted(genre_counts.items(), key=lambda x: x[1], reverse=True)
    top_genres = [g for g, count in sorted_genres[:3]]
    
    genre_mixes = []
    
    # Fallback to default genres if user has no genre history
    if not top_genres:
        top_genres = ["Pop", "Lo-Fi"]
        
    for g in top_genres:
        fav_artist = ""
        if g in genre_artists and genre_artists[g]:
            sorted_artists = sorted(genre_artists[g].items(), key=lambda x: x[1], reverse=True)
            fav_artist = sorted_artists[0][0]
            
        # Build search query based on favorite artist + genre
        if fav_artist:
            query = f"{fav_artist} {g} mix"
        else:
            query = f"{g} music playlist official"
            
        songs = _search_recommendations(query, count=8)
        if songs:
            genre_mixes.append({
                "genre": g,
                "title": f"{g} Mix",
                "songs": songs
            })
            
    return {
        "recently_played": hist.get("songs", []),
        "genre_mixes": genre_mixes
    }

@app.route("/api/dashboard")
def api_dashboard():
    global dashboard_cache
    now = time.time()
    # Cache valid for 10 minutes (600 seconds)
    if dashboard_cache["data"] is not None and (now - dashboard_cache["timestamp"]) < 600:
        return jsonify(dashboard_cache["data"])
        
    try:
        data = _generate_dashboard_data()
        dashboard_cache = {
            "data": data,
            "timestamp": now
        }
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/history")
def api_history():
    hist = _read_json(HISTORY_FILE, {"songs": []})
    return jsonify(hist)

@app.route("/api/liked/genre", methods=["POST"])
def api_update_genre():
    """Manually update genre for a liked song."""
    data = request.get_json(force=True)
    vid = data.get("video_id", "")
    genre = data.get("genre", "Unknown")
    liked = _read_json(LIKED_FILE, {"songs": []})
    for s in liked["songs"]:
        if s["video_id"] == vid:
            s["genre"] = genre
            break
    _write_json(LIKED_FILE, liked)
    return jsonify({"status": "ok"})

# ═══════════════════════ PLAYLISTS ═══════════════════════

@app.route("/api/playlists")
def api_playlists_list():
    index = _read_json(PLAYLISTS_INDEX, [])
    # Add song count to each
    result = []
    for p in index:
        pfile = os.path.join(PLAYLISTS_DIR, f"{p['id']}.json")
        pdata = _read_json(pfile, {"songs": []})
        result.append({**p, "song_count": len(pdata.get("songs", []))})
    return jsonify(result)

@app.route("/api/playlists", methods=["POST"])
def api_playlists_create():
    data = request.get_json(force=True)
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Missing name"}), 400
    
    pid = str(uuid.uuid4())[:8]
    playlist = {
        "id": pid,
        "name": name,
        "cover": "",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S")
    }
    
    index = _read_json(PLAYLISTS_INDEX, [])
    index.append(playlist)
    _write_json(PLAYLISTS_INDEX, index)
    _write_json(os.path.join(PLAYLISTS_DIR, f"{pid}.json"), {"id": pid, "name": name, "cover": "", "songs": []})
    
    return jsonify(playlist)

@app.route("/api/playlists/<pid>")
def api_playlist_get(pid):
    pfile = os.path.join(PLAYLISTS_DIR, f"{pid}.json")
    pdata = _read_json(pfile, None)
    if pdata is None:
        return jsonify({"error": "Not found"}), 404
    return jsonify(pdata)

@app.route("/api/playlists/<pid>", methods=["DELETE"])
def api_playlist_delete(pid):
    index = _read_json(PLAYLISTS_INDEX, [])
    index = [p for p in index if p["id"] != pid]
    _write_json(PLAYLISTS_INDEX, index)
    
    pfile = os.path.join(PLAYLISTS_DIR, f"{pid}.json")
    if os.path.exists(pfile):
        os.remove(pfile)
    return jsonify({"status": "ok"})

@app.route("/api/playlists/<pid>/songs", methods=["POST"])
def api_playlist_add_song(pid):
    data = request.get_json(force=True)
    pfile = os.path.join(PLAYLISTS_DIR, f"{pid}.json")
    pdata = _read_json(pfile, None)
    if pdata is None:
        return jsonify({"error": "Not found"}), 404
    
    vid = data.get("video_id", "")
    if any(s["video_id"] == vid for s in pdata.get("songs", [])):
        return jsonify({"status": "already_exists"})
    
    song = {
        "video_id": vid,
        "title": data.get("title", "Unknown"),
        "artist": data.get("artist", ""),
        "thumbnail": data.get("thumbnail", ""),
        "genre": data.get("genre", "Unknown")
    }
    pdata["songs"].append(song)
    _write_json(pfile, pdata)
    return jsonify({"status": "ok"})

@app.route("/api/playlists/<pid>/songs", methods=["DELETE"])
def api_playlist_remove_song(pid):
    data = request.get_json(force=True)
    vid = data.get("video_id", "")
    pfile = os.path.join(PLAYLISTS_DIR, f"{pid}.json")
    pdata = _read_json(pfile, None)
    if pdata is None:
        return jsonify({"error": "Not found"}), 404
    
    pdata["songs"] = [s for s in pdata["songs"] if s["video_id"] != vid]
    _write_json(pfile, pdata)
    return jsonify({"status": "ok"})

@app.route("/api/playlists/<pid>/cover", methods=["POST"])
def api_playlist_cover(pid):
    pfile = os.path.join(PLAYLISTS_DIR, f"{pid}.json")
    pdata = _read_json(pfile, None)
    if pdata is None:
        return jsonify({"error": "Not found"}), 404
    
    # Check if it's a file upload or a URL
    if "file" in request.files:
        f = request.files["file"]
        ext = os.path.splitext(f.filename)[1] or ".jpg"
        fname = f"{pid}{ext}"
        fpath = os.path.join(COVERS_DIR, fname)
        f.save(fpath)
        cover_url = f"/api/covers/{fname}"
    else:
        data = request.get_json(force=True)
        cover_url = data.get("url", "")
    
    pdata["cover"] = cover_url
    _write_json(pfile, pdata)
    
    # Also update index
    index = _read_json(PLAYLISTS_INDEX, [])
    for p in index:
        if p["id"] == pid:
            p["cover"] = cover_url
            break
    _write_json(PLAYLISTS_INDEX, index)
    
    return jsonify({"status": "ok", "cover": cover_url})

@app.route("/api/playlists/<pid>/genre", methods=["POST"])
def api_playlist_song_genre(pid):
    """Update genre for a song inside a playlist."""
    data = request.get_json(force=True)
    vid = data.get("video_id", "")
    genre = data.get("genre", "Unknown")
    pfile = os.path.join(PLAYLISTS_DIR, f"{pid}.json")
    pdata = _read_json(pfile, None)
    if pdata is None:
        return jsonify({"error": "Not found"}), 404
    for s in pdata["songs"]:
        if s["video_id"] == vid:
            s["genre"] = genre
            break
    _write_json(pfile, pdata)
    return jsonify({"status": "ok"})

@app.route("/api/covers/<filename>")
def api_serve_cover(filename):
    return send_from_directory(COVERS_DIR, filename)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, threaded=True)
