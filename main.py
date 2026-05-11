import syncedlyrics
from yt_dlp import YoutubeDL
import vlc
import os
import time
import keyboard

# -------------------------
# VLC PATH
# -------------------------

os.add_dll_directory(r"C:\Program Files\VideoLAN\VLC")

# -------------------------
# IMPORTS
# -------------------------


# -------------------------
# GLOBAL PLAYER
# -------------------------

player = None

# -------------------------
# PLAY SONG FUNCTION
# -------------------------


def play_song(query):

    global player
    query = query + " official audio"
    print(f"\nSearching: {query}")

    # -------------------------
    # YOUTUBE SEARCH
    # -------------------------

    ydl_opts = {
        "format": "bestaudio/best",
        "quiet": True,
        "noplaylist": True
    }

    with YoutubeDL(ydl_opts) as ydl:

        info = ydl.extract_info(
            f"ytsearch1:{query}",
            download=False
        )

    video = info["entries"][0]

    # -------------------------
    # METADATA
    # -------------------------

    raw_title = video.get("title", "Unknown")

    artist = video.get("artist")
    track = video.get("track")

    # Better lyrics search query

    if artist and track:

        lyrics_query = f"{artist} {track}"

    else:

        if " - " in raw_title:

            parts = raw_title.split(" - ", 1)

            guessed_artist = parts[0]
            guessed_track = parts[1]

            lyrics_query = f"{guessed_artist} {guessed_track}"

        else:

            lyrics_query = raw_title

    print(f"\nNow Playing: {raw_title}")
    print(f"Lyrics Search: {lyrics_query}")

    # -------------------------
    # AUDIO URL
    # -------------------------

    audio_url = video["url"]

    # -------------------------
    # STOP OLD SONG
    # -------------------------

    if player:
        player.stop()

    # -------------------------
    # START NEW SONG
    # -------------------------

    player = vlc.MediaPlayer(audio_url)

    player.play()

    # Give VLC time to initialize

    time.sleep(2)

    # -------------------------
    # FETCH LYRICS
    # -------------------------

    print("\nFetching synced lyrics...\n")

    try:

        lyrics = syncedlyrics.search(
            lyrics_query,
            synced_only=True
        )

    except Exception as e:

        print("Lyrics Error:", e)

        lyrics = None

    # -------------------------
    # NO LYRICS MODE
    # -------------------------

    if not lyrics:

        print("No synced lyrics found")

        while True:

            # -------------------------
            # HOTKEY
            # -------------------------

            if keyboard.is_pressed("ctrl+b"):
                print("\nPaused")

                player.pause()

                time.sleep(0.5)

                new_song = input("\nEnter next song: ")

                play_song(new_song)

                return

            # -------------------------
            # SONG ENDED
            # -------------------------

            state = player.get_state()

            if state == vlc.State.Ended:
                break

            time.sleep(0.1)

        return

    # -------------------------
    # PARSE LRC
    # -------------------------

    parsed_lyrics = []

    for line in lyrics.splitlines():

        if line.startswith("[") and "]" in line:

            try:

                timestamp = line[1:line.index("]")]
                lyric_text = line[line.index("]") + 1:]

                minutes, seconds = timestamp.split(":")

                total_seconds = (
                    int(minutes) * 60 + float(seconds)
                )

                parsed_lyrics.append(
                    (total_seconds, lyric_text)
                )

            except:
                pass

    # -------------------------
    # REAL-TIME LOOP
    # -------------------------

    current_index = 0

    while True:

        # -------------------------
        # HOTKEY
        # -------------------------

        if keyboard.is_pressed("ctrl+b"):

            print("\nPaused")

            player.pause()

            time.sleep(0.5)

            new_song = input("\nEnter next song: ")

            play_song(new_song)

            return

        # -------------------------
        # CURRENT PLAYBACK TIME
        # -------------------------

        current_time = player.get_time() / 1000

        # -------------------------
        # SHOW CURRENT LYRIC
        # -------------------------

        if current_index < len(parsed_lyrics):

            lyric_time, lyric_text = parsed_lyrics[current_index]

            if current_time >= lyric_time:

                print(lyric_text)

                current_index += 1

        # -------------------------
        # SONG ENDED
        # -------------------------

        state = player.get_state()

        if state == vlc.State.Ended:
            break

        time.sleep(0.05)

# -------------------------
# START APP
# -------------------------


song = input("Enter song: ")

play_song(song)
