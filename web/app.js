/* ═══════════════════════════════════════════════════════════════
   MIKO PLAYER  ·  Client-side Logic (Single Account, No Login)
   ═══════════════════════════════════════════════════════════════ */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const searchInput = $("#searchInput"), searchBtn = $("#searchBtn");
  const songTitle = $("#songTitle"), songArtist = $("#songArtist");
  const artworkImg = $("#artworkImg"), artworkContainer = $("#artworkContainer");
  const artwork = $("#artwork"), discRing = $("#discRing");
  const lyricsScroll = $("#lyricsScroll");
  const progressFill = $("#progressFill"), progressThumb = $("#progressThumb"), progressTrack = $("#progressTrack");
  const timeElapsed = $("#timeElapsed"), timeDuration = $("#timeDuration");
  const playPauseBtn = $("#playPauseBtn"), iconPlay = $("#iconPlay"), iconPause = $("#iconPause");
  const stopBtn = $("#stopBtn"), prevBtn = $("#prevBtn"), nextBtn = $("#nextBtn");
  const volumeSlider = $("#volumeSlider"), playerSection = $("#playerSection");
  const suggestionsDropdown = $("#suggestionsDropdown");
  const queueToggleBtn = $("#queueToggleBtn"), queuePanel = $("#queuePanel");
  const closeQueueBtn = $("#closeQueueBtn"), queueList = $("#queueList");
  const clientAudio = $("#clientAudio");

  let currentLyrics = [], activeLyricIdx = -1, statusPoll = null;
  let searchDebounce = null, selectedSuggestionIdx = -1, currentSuggestions = [];
  let lastPlayedVideoId = null, isDragging = false;

  let audioUnlocked = false;
  function unlockAudio() { if (!audioUnlocked) audioUnlocked = true; }
  document.addEventListener("click", unlockAudio, { once: true });
  document.addEventListener("keydown", unlockAudio, { once: true });

  const API = (path, opts = {}) => {
    const url = new URL(`/api${path}`, window.location.origin);
    return fetch(url, opts).then(r => r.json());
  };

  clientAudio.addEventListener("ended", () => API("/next", { method: "POST" }));
  clientAudio.addEventListener("timeupdate", () => {
    if (!isDragging) {
      const dur = (clientAudio.duration && clientAudio.duration !== Infinity) ? clientAudio.duration : (window.lastKnownDuration || 0);
      const pos = clientAudio.currentTime;
      if (dur > 0) { const pct = Math.min((pos / dur) * 100, 100); progressFill.style.width = pct + "%"; progressThumb.style.left = pct + "%"; }
      timeElapsed.textContent = formatTime(pos);
      highlightLyric(pos);
    }
  });

  setInterval(() => {
    if (clientAudio.src && !clientAudio.paused) {
      API("/report_state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: "playing", position: clientAudio.currentTime }) }).catch(()=>{});
    }
  }, 5000);

  function formatTime(sec) { if (!sec || sec < 0) return "0:00"; const m = Math.floor(sec / 60); const s = Math.floor(sec % 60); return `${m}:${s.toString().padStart(2, "0")}`; }

  async function playSong(query, displayTitle) {
    const q = query || searchInput.value.trim();
    const display = displayTitle || (q.includes("youtube.com") ? "YouTube Link" : q);
    if (!q) return;
    hideSuggestions();
    songTitle.textContent = "Searching…"; songArtist.textContent = display;
    playerSection.classList.add("loading"); artworkContainer.classList.remove("active");
    discRing.classList.remove("spinning"); artworkImg.classList.remove("visible");
    lyricsScroll.innerHTML = '<p class="lyrics-placeholder">Loading…</p>';
    await API("/play", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) });
    searchInput.value = ""; startPolling();
  }

  searchBtn.addEventListener("click", () => playSong());
  searchInput.addEventListener("keydown", (e) => {
    const items = suggestionsDropdown.querySelectorAll(".suggestion-item");
    const isOpen = suggestionsDropdown.classList.contains("visible") && items.length > 0;
    if (e.key === "ArrowDown" && isOpen) { e.preventDefault(); selectedSuggestionIdx = Math.min(selectedSuggestionIdx + 1, items.length - 1); updateSuggestionSelection(items); return; }
    if (e.key === "ArrowUp" && isOpen) { e.preventDefault(); selectedSuggestionIdx = Math.max(selectedSuggestionIdx - 1, -1); updateSuggestionSelection(items); return; }
    if (e.key === "Enter" && e.altKey && isOpen && selectedSuggestionIdx >= 0) {
      e.preventDefault(); const s = currentSuggestions[selectedSuggestionIdx];
      if (s) { API("/add_next", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: s.video_id, title: s.title, artist: s.channel, thumbnail: s.thumbnail }) }); searchInput.value = ""; hideSuggestions(); } return;
    }
    if (e.key === "Enter" && !e.altKey && isOpen && selectedSuggestionIdx >= 0) {
      e.preventDefault(); const s = currentSuggestions[selectedSuggestionIdx];
      if (s) { searchInput.value = s.title; playSong(`https://www.youtube.com/watch?v=${s.video_id}`, s.title); } return;
    }
    if (e.key === "Enter") { playSong(); return; }
    if (e.key === "Escape") hideSuggestions();
  });

  queueToggleBtn.addEventListener("click", () => queuePanel.classList.add("open"));
  closeQueueBtn.addEventListener("click", () => queuePanel.classList.remove("open"));

  function updateSuggestionSelection(items) {
    items.forEach((el, i) => el.classList.toggle("selected", i === selectedSuggestionIdx));
    if (selectedSuggestionIdx >= 0 && items[selectedSuggestionIdx]) items[selectedSuggestionIdx].scrollIntoView({ block: "nearest" });
  }

  searchInput.addEventListener("input", () => { clearTimeout(searchDebounce); const q = searchInput.value.trim(); if (!q) { hideSuggestions(); return; } searchDebounce = setTimeout(() => fetchSuggestions(q), 500); });

  async function fetchSuggestions(q) {
    suggestionsDropdown.innerHTML = '<div class="suggestions-loading">Searching YouTube…</div>'; suggestionsDropdown.classList.add("visible");
    try { const results = await API(`/search?q=${encodeURIComponent(q)}`); if (!Array.isArray(results) || results.length === 0) { suggestionsDropdown.innerHTML = '<div class="suggestions-loading">No results found</div>'; currentSuggestions = []; return; } currentSuggestions = results; renderSuggestions(results); } catch { currentSuggestions = []; hideSuggestions(); }
  }

  function renderSuggestions(results) {
    suggestionsDropdown.innerHTML = "";
    results.forEach((r) => {
      const item = document.createElement("div"); item.className = "suggestion-item";
      item.innerHTML = `<img class="suggestion-thumb" src="${r.thumbnail}" alt="" loading="lazy" /><div class="suggestion-info" style="flex:1;"><div class="suggestion-title">${escapeHtml(r.title)}</div><div class="suggestion-meta">${escapeHtml(r.channel)}</div></div><div style="display:flex;align-items:center;gap:10px;"><span class="suggestion-duration">${formatTime(r.duration)}</span><button class="add-queue-btn" title="Add to Queue" style="background:none;border:none;color:var(--text);font-size:1.2rem;cursor:pointer;padding:5px;">+</button></div>`;
      item.querySelector('.suggestion-info').parentElement.addEventListener("click", (e) => { if (e.target.closest('.add-queue-btn')) return; searchInput.value = r.title; playSong(`https://www.youtube.com/watch?v=${r.video_id}`, r.title); });
      item.querySelector('.add-queue-btn').addEventListener("click", (e) => { e.stopPropagation(); API("/add_next", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.video_id, title: r.title, artist: r.channel, thumbnail: r.thumbnail }) }); hideSuggestions(); });
      suggestionsDropdown.appendChild(item);
    });
    suggestionsDropdown.classList.add("visible");
  }

  function hideSuggestions() { suggestionsDropdown.classList.remove("visible"); selectedSuggestionIdx = -1; }
  function escapeHtml(str) { const d = document.createElement("div"); d.textContent = str; return d.innerHTML; }
  document.addEventListener("click", (e) => { if (!e.target.closest(".search-section")) hideSuggestions(); });

  document.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName; const inInput = tag === "INPUT" || tag === "TEXTAREA";
    if (e.key === " " && !inInput) { e.preventDefault(); playPauseBtn.click(); return; }
    if (e.key === "ArrowRight" && e.shiftKey) { e.preventDefault(); clientAudio.currentTime += 5; return; }
    if (e.key === "ArrowLeft" && e.shiftKey) { e.preventDefault(); clientAudio.currentTime -= 5; return; }
  });

  playPauseBtn.addEventListener("click", () => {
    if (clientAudio.paused) { clientAudio.play().catch(()=>{}); API("/report_state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: "playing" }) }); }
    else { clientAudio.pause(); API("/report_state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: "paused" }) }); }
  });
  stopBtn.addEventListener("click", () => { clientAudio.pause(); clientAudio.currentTime = 0; API("/report_state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: "stopped" }) }); });
  prevBtn.addEventListener("click", () => API("/prev", { method: "POST" }));
  nextBtn.addEventListener("click", () => API("/next", { method: "POST" }));
  volumeSlider.addEventListener("input", () => { clientAudio.volume = +volumeSlider.value / 100; });

  function getSeekPos(e) { const rect = progressTrack.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)); }
  function updateProgressVisual(pos) { const pct = pos * 100; progressFill.style.width = pct + "%"; progressThumb.style.left = pct + "%"; progressThumb.style.opacity = "1"; }
  function seekTo(pos) { const dur = (clientAudio.duration && clientAudio.duration !== Infinity) ? clientAudio.duration : (window.lastKnownDuration || 0); if (dur > 0) { clientAudio.currentTime = pos * dur; API("/report_state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ position: clientAudio.currentTime }) }); } }

  progressTrack.addEventListener("mousedown", (e) => { isDragging = true; progressTrack.classList.add("dragging"); updateProgressVisual(getSeekPos(e)); e.preventDefault(); });
  document.addEventListener("mousemove", (e) => { if (!isDragging) return; updateProgressVisual(getSeekPos(e)); });
  document.addEventListener("mouseup", (e) => { if (!isDragging) return; isDragging = false; progressTrack.classList.remove("dragging"); seekTo(getSeekPos(e)); });

  function startPolling() { if (statusPoll) clearInterval(statusPoll); statusPoll = setInterval(pollStatus, 400); }
  async function pollStatus() { try { const d = await API("/status"); updateUI(d); } catch { /* ignore */ } }

  function updateUI(data) {
    if (!data || !data.current_song) return;
    const d = data.current_song;
    if (data.video_id && data.video_id !== lastPlayedVideoId) { lastPlayedVideoId = data.video_id; clientAudio.src = `/api/stream?t=${Date.now()}`; clientAudio.play().catch(e => console.warn("Autoplay prevented:", e)); }
    if (d.state === "playing" && clientAudio.paused) { clientAudio.play().catch(()=>{}); } else if (d.state !== "playing" && !clientAudio.paused) { clientAudio.pause(); }
    songTitle.textContent = d.title || "Search a song to play"; songArtist.textContent = d.artist || "—";
    if ("mediaSession" in navigator && d.title) { navigator.mediaSession.metadata = new MediaMetadata({ title: d.title, artist: d.artist || "Miko Player", artwork: d.thumbnail ? [{ src: d.thumbnail, sizes: "512x512", type: "image/jpeg" }] : [] }); navigator.mediaSession.playbackState = d.state === "playing" ? "playing" : "paused"; }
    if (data.queue && data.queue.length > 0) {
      const queueHash = data.queue.length + "-" + data.queue_index;
      if (queueList.dataset.hash !== queueHash) {
        queueList.dataset.hash = queueHash; queueList.innerHTML = "";
        data.queue.forEach((item, idx) => {
          const el = document.createElement("div"); el.className = "queue-item" + (idx === data.queue_index ? " active" : "");
          el.innerHTML = `<img src="${item.thumbnail}" class="queue-item-thumb" alt="thumb"><div class="queue-item-info"><span class="queue-item-title">${item.title}</span><span class="queue-item-artist">${item.artist || ""}</span></div>`;
          el.addEventListener("click", () => API("/jump_queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ index: idx }) }));
          queueList.appendChild(el);
          if (idx === data.queue_index) el.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      }
    } else { if (queueList.dataset.hash !== "empty") { queueList.dataset.hash = "empty"; queueList.innerHTML = '<div style="color:var(--text-dim);text-align:center;padding:20px;">Queue is empty</div>'; } }
    if (d.state === "loading") playerSection.classList.add("loading"); else playerSection.classList.remove("loading");
    if (d.thumbnail) { artworkImg.src = d.thumbnail; artworkImg.classList.add("visible"); artworkContainer.classList.add("active"); } else { artworkImg.classList.remove("visible"); artworkContainer.classList.remove("active"); }
    if (d.state === "playing") { discRing.classList.add("spinning"); artwork.classList.add("spinning"); } else { discRing.classList.remove("spinning"); artwork.classList.remove("spinning"); }
    if (d.state === "playing") { iconPlay.style.display = "none"; iconPause.style.display = "block"; } else { iconPlay.style.display = "block"; iconPause.style.display = "none"; }
    window.lastKnownDuration = d.duration || 0; timeDuration.textContent = formatTime(window.lastKnownDuration);
    if (d.lyrics && d.lyrics.length > 0) { if (JSON.stringify(d.lyrics) !== JSON.stringify(currentLyrics)) { currentLyrics = d.lyrics; renderLyrics(); } } else if (d.state === "playing" && currentLyrics.length === 0) { lyricsScroll.innerHTML = '<p class="lyrics-placeholder">No synced lyrics available</p>'; }
    const ambientBgImg = document.getElementById("ambientBgImg");
    if (d.thumbnail && ambientBgImg.dataset.src !== d.thumbnail) { ambientBgImg.dataset.src = d.thumbnail; ambientBgImg.style.backgroundImage = `url('${d.thumbnail}')`; }
    if (d.state === "playing") ambientBgImg.style.opacity = "1"; else if (d.state === "stopped" || !d.thumbnail) ambientBgImg.style.opacity = "0"; else ambientBgImg.style.opacity = "0.4";
  }

  function renderLyrics() { lyricsScroll.innerHTML = ""; currentLyrics.forEach((l, i) => { const el = document.createElement("p"); el.className = "lyric-line"; el.textContent = l.text; el.dataset.idx = i; lyricsScroll.appendChild(el); }); activeLyricIdx = -1; }

  function highlightLyric(pos) {
    let idx = -1;
    for (let i = currentLyrics.length - 1; i >= 0; i--) { if (pos >= currentLyrics[i].time) { idx = i; break; } }
    if (idx === activeLyricIdx) return; activeLyricIdx = idx;
    const lines = lyricsScroll.querySelectorAll(".lyric-line");
    lines.forEach((el, i) => { el.classList.remove("active", "past"); if (i === idx) el.classList.add("active"); else if (i < idx) el.classList.add("past"); });
    if (idx >= 0 && lines[idx]) { const panel = document.getElementById("lyricsPanel"); const lineTop = lines[idx].offsetTop; const panelH = panel.clientHeight; const scrollTarget = lineTop - panelH / 2 + lines[idx].clientHeight / 2; lyricsScroll.style.transform = `translateY(-${Math.max(0, scrollTarget)}px)`; }
  }

  clientAudio.volume = +volumeSlider.value / 100;
  if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("play", () => playPauseBtn.click());
    navigator.mediaSession.setActionHandler("pause", () => playPauseBtn.click());
    navigator.mediaSession.setActionHandler("seekforward", () => { clientAudio.currentTime += 5; });
    navigator.mediaSession.setActionHandler("seekbackward", () => { clientAudio.currentTime -= 5; });
    navigator.mediaSession.setActionHandler("nexttrack", () => nextBtn.click());
    navigator.mediaSession.setActionHandler("previoustrack", () => prevBtn.click());
  }

  // No login — start immediately
  startPolling();
  clientAudio.src = `/api/stream`;
  searchInput.focus();
})();
