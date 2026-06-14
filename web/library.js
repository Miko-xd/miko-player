/* ═══════════════════════════════════════════════════════════════
   MIKO PLAYER  ·  Library (Playlists, Liked Songs, Sidebar)
   ═══════════════════════════════════════════════════════════════ */
(() => {
  "use strict";
  const API = window.MikoAPI;
  const esc = window.MikoEscape;
  const fmt = window.MikoFormatTime;
  const sidebarContent = document.getElementById("sidebarContent");

  async function renderMain() {
    const [playlists, likedData] = await Promise.all([API("/playlists"), API("/liked")]);
    const likedCount = likedData.songs ? likedData.songs.length : 0;
    
    // Render left icon bar
    renderIconsSidebar(playlists, likedCount);

    let h = `<div class="sidebar-liked-card" id="sbLikedCard"><div class="sidebar-liked-icon">❤️</div><div class="sidebar-liked-info"><h4>Liked Songs</h4><p>${likedCount} song${likedCount !== 1 ? "s" : ""}</p></div></div>`;
    h += `<div style="margin:12px 0 6px;font-size:0.78rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;">Playlists</div>`;
    playlists.forEach(p => {
      const cover = p.cover ? `<img src="${p.cover}" alt="">` : "🎵";
      h += `<div class="sidebar-playlist-card" data-pid="${p.id}"><div class="sidebar-playlist-cover">${cover}</div><div class="sidebar-playlist-info"><h4>${esc(p.name)}</h4><p>${p.song_count || 0} song${(p.song_count || 0) !== 1 ? "s" : ""}</p></div></div>`;
    });
    h += `<button class="sidebar-create-btn" id="sbCreateBtn">➕ Create Playlist</button>`;
    sidebarContent.innerHTML = h;
    document.getElementById("sbLikedCard").addEventListener("click", () => renderLiked());
    sidebarContent.querySelectorAll(".sidebar-playlist-card").forEach(el => {
      el.addEventListener("click", () => renderPlaylistDetail(el.dataset.pid));
    });
    document.getElementById("sbCreateBtn").addEventListener("click", () => window.MikoCreatePlaylist());
  }

  function renderIconsSidebar(playlists, likedCount) {
    const container = document.getElementById("playlistIconsSidebar");
    if (!container) return;

    let html = `
      <div class="playlist-icon-item" id="iconLikedSongs" data-tooltip="Liked Songs" style="color: var(--rose);">
        ❤️
      </div>
    `;

    playlists.forEach(p => {
      const cover = p.cover ? `<img src="${p.cover}" alt="">` : "🎵";
      html += `
        <div class="playlist-icon-item" data-pid="${p.id}" data-tooltip="${esc(p.name)}">
          ${cover}
        </div>
      `;
    });

    html += `
      <div class="playlist-icon-item" id="iconCreatePlaylist" data-tooltip="Create Playlist" style="color: var(--accent);">
        ➕
      </div>
    `;

    container.innerHTML = html;

    // Listeners
    document.getElementById("iconLikedSongs").addEventListener("click", () => {
      document.getElementById("sidebarPanel").classList.add("open");
      renderLiked();
    });

    container.querySelectorAll(".playlist-icon-item[data-pid]").forEach(el => {
      el.addEventListener("click", () => {
        document.getElementById("sidebarPanel").classList.add("open");
        renderPlaylistDetail(el.dataset.pid);
      });
    });

    document.getElementById("iconCreatePlaylist").addEventListener("click", () => {
      window.MikoCreatePlaylist();
    });
  }

  async function renderLiked(filterGenre) {
    const gParam = filterGenre && filterGenre !== "All" ? `?genre=${encodeURIComponent(filterGenre)}` : "";
    const [likedData, genresData] = await Promise.all([API(`/liked${gParam}`), API("/liked/genres")]);
    const songs = likedData.songs || [];
    const genres = genresData.genres || [];
    let h = `<div class="sidebar-detail-header"><button class="sidebar-back-btn" id="sbBack"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg></button><h3 style="font-family:var(--font-display);font-weight:700;font-size:1.1rem;">Liked Songs</h3></div>`;
    if (genres.length > 0) {
      h += `<div class="genre-pills"><button class="genre-pill ${!filterGenre || filterGenre === "All" ? "active" : ""}" data-genre="All">All</button>`;
      genres.forEach(g => { h += `<button class="genre-pill ${filterGenre === g ? "active" : ""}" data-genre="${esc(g)}">${esc(g)}</button>`; });
      h += `</div>`;
    }
    if (songs.length === 0) { h += `<p style="color:var(--text-dim);text-align:center;padding:30px 0;font-size:0.85rem;">No liked songs${filterGenre && filterGenre !== "All" ? " in this genre" : ""}</p>`; }
    songs.forEach((s, i) => {
      h += `<div class="sidebar-song-item"><img class="sidebar-song-thumb" src="${s.thumbnail || ""}" alt=""><div class="sidebar-song-info" data-idx="${i}"><div class="sidebar-song-title">${esc(s.title)}</div><div class="sidebar-song-artist">${esc(s.artist || "")}</div></div><div class="sidebar-song-actions"><button class="sidebar-song-genre" data-vid="${s.video_id}" title="Change genre">${esc(s.genre || "Unknown")}</button><button class="sidebar-song-btn" data-vid="${s.video_id}" title="Remove">🗑️</button></div></div>`;
    });
    // Play all buttons
    if (songs.length > 0) {
      h += `<div class="sidebar-detail-actions" style="margin-top:12px"><button class="modal-btn modal-btn-primary" id="sbPlayLikedList">▶ Play All</button><button class="modal-btn modal-btn-ghost" id="sbShuffleLiked">🔀 Shuffle</button></div>`;
    }
    sidebarContent.innerHTML = h;
    document.getElementById("sbBack").addEventListener("click", () => renderMain());
    sidebarContent.querySelectorAll(".genre-pill").forEach(el => {
      el.addEventListener("click", () => renderLiked(el.dataset.genre));
    });
    sidebarContent.querySelectorAll(".sidebar-song-info").forEach(el => {
      el.addEventListener("click", () => {
        const idx = +el.dataset.idx;
        API("/play_list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ songs, start_index: idx, mode: "list" }) });
      });
    });
    sidebarContent.querySelectorAll(".sidebar-song-btn").forEach(el => {
      el.addEventListener("click", async () => {
        await API("/like", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ video_id: el.dataset.vid }) });
        renderLiked(filterGenre);
      });
    });
    sidebarContent.querySelectorAll(".sidebar-song-genre").forEach(el => {
      el.addEventListener("click", () => showGenreEditModal(el.dataset.vid, el.textContent, "liked", null, filterGenre));
    });
    const playAllBtn = document.getElementById("sbPlayLikedList");
    if (playAllBtn) playAllBtn.addEventListener("click", () => {
      API("/play_list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ songs, start_index: 0, mode: "list" }) });
    });
    const shuffleBtn = document.getElementById("sbShuffleLiked");
    if (shuffleBtn) shuffleBtn.addEventListener("click", () => {
      API("/play_list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ songs, start_index: 0, mode: "shuffle" }) });
    });
  }

  async function renderPlaylistDetail(pid) {
    const pdata = await API(`/playlists/${pid}`);
    if (!pdata || pdata.error) { renderMain(); return; }
    const songs = pdata.songs || [];
    let h = `<div class="sidebar-detail-header"><button class="sidebar-back-btn" id="sbBack"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg></button><h3 style="font-family:var(--font-display);font-weight:700;font-size:1.1rem;">${esc(pdata.name)}</h3></div>`;
    h += `<div class="sidebar-detail-cover" id="sbCoverArea">`;
    if (pdata.cover) h += `<img src="${pdata.cover}" alt="">`;
    else h += `<span style="font-size:3rem;">🎵</span>`;
    h += `<div class="cover-overlay">📷 Change Cover</div></div>`;
    h += `<div class="sidebar-detail-meta">${songs.length} song${songs.length !== 1 ? "s" : ""}</div>`;
    h += `<div class="sidebar-detail-actions"><button class="modal-btn modal-btn-primary" id="sbPlayPl">▶ Play</button><button class="modal-btn modal-btn-ghost" id="sbShufflePl">🔀 Shuffle</button><button class="modal-btn modal-btn-ghost" id="sbAddSongs">+ Add Songs</button><button class="modal-btn modal-btn-danger" id="sbDeletePl">🗑️</button></div>`;
    songs.forEach((s, i) => {
      h += `<div class="sidebar-song-item"><img class="sidebar-song-thumb" src="${s.thumbnail || ""}" alt=""><div class="sidebar-song-info" data-idx="${i}"><div class="sidebar-song-title">${esc(s.title)}</div><div class="sidebar-song-artist">${esc(s.artist || "")}</div></div><div class="sidebar-song-actions"><button class="sidebar-song-genre" data-vid="${s.video_id}" title="Change genre">${esc(s.genre || "Unknown")}</button><button class="sidebar-song-btn sidebar-remove-btn" data-vid="${s.video_id}" title="Remove">✕</button></div></div>`;
    });
    sidebarContent.innerHTML = h;
    document.getElementById("sbBack").addEventListener("click", () => renderMain());
    document.getElementById("sbCoverArea").addEventListener("click", () => showCoverModal(pid));
    const playBtn = document.getElementById("sbPlayPl");
    if (playBtn) playBtn.addEventListener("click", () => {
      if (songs.length) API("/play_list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ songs, start_index: 0, mode: "list" }) });
    });
    const shuffleBtn = document.getElementById("sbShufflePl");
    if (shuffleBtn) shuffleBtn.addEventListener("click", () => {
      if (songs.length) API("/play_list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ songs, start_index: 0, mode: "shuffle" }) });
    });
    document.getElementById("sbAddSongs").addEventListener("click", () => showAddSongsModal(pid));
    document.getElementById("sbDeletePl").addEventListener("click", async () => {
      if (confirm("Delete this playlist?")) { await API(`/playlists/${pid}`, { method: "DELETE" }); renderMain(); }
    });
    sidebarContent.querySelectorAll(".sidebar-song-info").forEach(el => {
      el.addEventListener("click", () => {
        const idx = +el.dataset.idx;
        API("/play_list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ songs, start_index: idx, mode: "list" }) });
      });
    });
    sidebarContent.querySelectorAll(".sidebar-remove-btn").forEach(el => {
      el.addEventListener("click", async () => {
        await API(`/playlists/${pid}/songs`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ video_id: el.dataset.vid }) });
        renderPlaylistDetail(pid);
      });
    });
    sidebarContent.querySelectorAll(".sidebar-song-genre").forEach(el => {
      el.addEventListener("click", () => showGenreEditModal(el.dataset.vid, el.textContent, "playlist", pid));
    });
  }

  function showAddSongsModal(pid) {
    let html = `<h3 class="modal-title">Add Songs to Playlist</h3><input class="modal-input" id="modalSearchInput" placeholder="Search for songs..." autofocus /><div id="modalSearchResults" style="max-height:300px;overflow-y:auto;"></div><div class="modal-actions"><button class="modal-btn modal-btn-ghost" onclick="window.MikoModal.hide()">Done</button></div>`;
    window.MikoModal.show(html);
    let debounce = null;
    const input = document.getElementById("modalSearchInput");
    const results = document.getElementById("modalSearchResults");
    input.addEventListener("input", () => {
      clearTimeout(debounce);
      const q = input.value.trim();
      if (!q) { results.innerHTML = ""; return; }
      debounce = setTimeout(async () => {
        results.innerHTML = '<div style="color:var(--text-dim);text-align:center;padding:16px;font-size:0.82rem;">Searching…</div>';
        const data = await API(`/search?q=${encodeURIComponent(q)}`);
        if (!Array.isArray(data)) { results.innerHTML = ""; return; }
        results.innerHTML = "";
        data.forEach(r => {
          const item = document.createElement("div"); item.className = "modal-song-item";
          item.innerHTML = `<img class="modal-song-thumb" src="${r.thumbnail}" alt=""><div class="modal-song-info"><div class="modal-song-title">${esc(r.title)}</div><div class="modal-song-artist">${esc(r.channel)}</div></div><button class="modal-song-action" title="Add">+</button>`;
          item.querySelector(".modal-song-action").addEventListener("click", async (e) => {
            e.stopPropagation();
            await API(`/playlists/${pid}/songs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ video_id: r.video_id, title: r.title, artist: r.channel, thumbnail: r.thumbnail }) });
            e.target.textContent = "✓"; e.target.style.color = "#22d3ee"; e.target.disabled = true;
          });
          results.appendChild(item);
        });
      }, 400);
    });
  }

  function showCoverModal(pid) {
    let html = `<h3 class="modal-title">Change Playlist Cover</h3><p style="color:var(--text-dim);font-size:0.82rem;margin-bottom:16px;">Upload an image or use a song's thumbnail</p>`;
    html += `<input type="file" id="coverFileInput" accept="image/*" style="display:none"><button class="modal-btn modal-btn-primary" id="coverUploadBtn" style="width:100%;margin-bottom:10px;">📁 Upload Image</button>`;
    html += `<div style="text-align:center;color:var(--text-dim);font-size:0.78rem;margin:8px 0;">— or pick from playlist songs —</div>`;
    html += `<div id="coverSongList"></div>`;
    html += `<div class="modal-actions"><button class="modal-btn modal-btn-ghost" onclick="window.MikoModal.hide()">Cancel</button></div>`;
    window.MikoModal.show(html);

    document.getElementById("coverUploadBtn").addEventListener("click", () => document.getElementById("coverFileInput").click());
    document.getElementById("coverFileInput").addEventListener("change", async (e) => {
      const file = e.target.files[0]; if (!file) return;
      const fd = new FormData(); fd.append("file", file);
      await fetch(`/api/playlists/${pid}/cover`, { method: "POST", body: fd });
      window.MikoModal.hide(); renderPlaylistDetail(pid);
    });

    // Load playlist songs for thumbnail selection
    API(`/playlists/${pid}`).then(pdata => {
      const list = document.getElementById("coverSongList");
      if (!list) return;
      (pdata.songs || []).forEach(s => {
        if (!s.thumbnail) return;
        const item = document.createElement("div"); item.className = "modal-song-item";
        item.innerHTML = `<img class="modal-song-thumb" src="${s.thumbnail}" alt=""><div class="modal-song-info"><div class="modal-song-title">${esc(s.title)}</div></div>`;
        item.addEventListener("click", async () => {
          await API(`/playlists/${pid}/cover`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: s.thumbnail }) });
          window.MikoModal.hide(); renderPlaylistDetail(pid);
        });
        list.appendChild(item);
      });
    });
  }

  function showGenreEditModal(videoId, currentGenre, source, pid, filterGenre) {
    const presets = ["Pop", "Rock", "Hip-Hop", "R&B", "Electronic", "Jazz", "Classical", "Country", "Latin", "K-Pop", "Bollywood", "Indie", "Metal", "Folk", "Lo-Fi", "Unknown"];
    let html = `<h3 class="modal-title">Set Genre</h3>`;
    html += `<input class="modal-input" id="genreInput" placeholder="Type a genre..." value="${esc(currentGenre || "")}" autofocus />`;
    html += `<div class="genre-pills" style="margin-bottom:16px;">`;
    presets.forEach(g => { html += `<button class="genre-pill" data-g="${g}">${g}</button>`; });
    html += `</div>`;
    html += `<div class="modal-actions"><button class="modal-btn modal-btn-ghost" onclick="window.MikoModal.hide()">Cancel</button><button class="modal-btn modal-btn-primary" id="genreSaveBtn">Save</button></div>`;
    window.MikoModal.show(html);
    const input = document.getElementById("genreInput");
    document.querySelectorAll("#modalCard .genre-pill").forEach(el => {
      el.addEventListener("click", () => { input.value = el.dataset.g; });
    });
    document.getElementById("genreSaveBtn").addEventListener("click", async () => {
      const genre = input.value.trim() || "Unknown";
      if (source === "liked") {
        await API("/liked/genre", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ video_id: videoId, genre }) });
        window.MikoModal.hide(); renderLiked(filterGenre);
      } else if (source === "playlist" && pid) {
        await API(`/playlists/${pid}/genre`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ video_id: videoId, genre }) });
        window.MikoModal.hide(); renderPlaylistDetail(pid);
      }
    });
  }

  window.MikoLibrary = { renderMain };
  
  // Auto-render library on load to show left icon bar
  setTimeout(renderMain, 100);
})();
