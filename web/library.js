/* ═══════════════════════════════════════════════════════════════
   MIKO PLAYER  ·  Library (Playlists, Liked Songs, Widescreen center)
   ═══════════════════════════════════════════════════════════════ */
(() => {
  "use strict";
  const API = window.MikoAPI;
  const esc = window.MikoEscape;
  const fmt = window.MikoFormatTime;
  const sidebarContent = document.getElementById("sidebarContent");
  const playlistView = document.getElementById("playlistView");
  const homeView = document.getElementById("homeView");

  function showPlaylistView() {
    if (homeView) homeView.style.display = "none";
    if (playlistView) playlistView.style.display = "flex";
  }

  function showHomeView() {
    if (playlistView) playlistView.style.display = "none";
    if (homeView) homeView.style.display = "block";
  }

  // Expose showHomeView globally so app.js can trigger it if needed
  window.MikoShowHomeView = showHomeView;

  async function renderMain() {
    const [playlists, likedData] = await Promise.all([API("/playlists"), API("/liked")]);
    const likedCount = likedData.songs ? likedData.songs.length : 0;
    
    // Render left icon bar
    renderIconsSidebar(playlists, likedCount);

    if (sidebarContent) {
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
      renderLiked();
    });

    container.querySelectorAll(".playlist-icon-item[data-pid]").forEach(el => {
      el.addEventListener("click", () => {
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
    
    showPlaylistView();

    let h = `
      <button class="playlist-back-btn" id="sbBack">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
        Back to Home
      </button>
      
      <div class="playlist-header">
        <div class="playlist-cover-art" style="background: linear-gradient(135deg, #311042, #7c2d12);">
          <span style="font-size: 3.5rem;">❤️</span>
        </div>
        <div class="playlist-header-info">
          <span class="playlist-badge">Playlist</span>
          <h1 class="playlist-name">Liked Songs</h1>
          <p class="playlist-metadata">
            <span class="playlist-creator">Miko</span> • ${songs.length} song${songs.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>
    `;

    // Action bar
    h += `
      <div class="playlist-actions-bar">
        ${songs.length > 0 ? `
          <button class="play-playlist-btn" id="sbPlayLikedList" title="Play All">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <button class="playlist-action-btn" id="sbShuffleLiked" title="Shuffle">🔀 Shuffle</button>
        ` : ''}
      </div>
    `;

    // Genre filters
    if (genres.length > 0) {
      h += `<div style="margin-top: 16px; display: flex; gap: 8px; flex-wrap: wrap;">
        <button class="genre-pill ${!filterGenre || filterGenre === "All" ? "active" : ""}" data-genre="All" style="border: 1px solid var(--border); background: var(--surface-2); color: var(--text); padding: 6px 14px; border-radius: 20px; cursor: pointer; font-size:0.75rem;">All</button>`;
      genres.forEach(g => { 
        h += `<button class="genre-pill ${filterGenre === g ? "active" : ""}" data-genre="${esc(g)}" style="border: 1px solid var(--border); background: var(--surface-2); color: var(--text); padding: 6px 14px; border-radius: 20px; cursor: pointer; font-size:0.75rem;">${esc(g)}</button>`; 
      });
      h += `</div>`;
    }

    // Songs Table
    if (songs.length === 0) {
      h += `<p style="color:var(--text-dim);text-align:center;padding:40px 0;font-size:0.88rem;">No liked songs${filterGenre && filterGenre !== "All" ? " in this genre" : ""}</p>`;
    } else {
      h += `
        <table class="playlist-songs-table">
          <thead>
            <tr>
              <th style="width: 50px; text-align: center;">#</th>
              <th>Title</th>
              <th>Genre</th>
              <th style="width: 100px;"></th>
              <th style="width: 80px; text-align: right;"><svg class="clock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></th>
            </tr>
          </thead>
          <tbody>
      `;

      songs.forEach((s, i) => {
        h += `
          <tr class="song-row" data-idx="${i}">
            <td class="song-index" style="text-align: center;">${i + 1}</td>
            <td class="song-title-cell">
              <img class="song-row-thumb" src="${s.thumbnail || ""}" alt="" loading="lazy">
              <div class="song-row-details">
                <div class="song-row-title">${esc(s.title)}</div>
                <div class="song-row-artist">${esc(s.artist || "")}</div>
              </div>
            </td>
            <td class="song-row-genre">
              <button class="sidebar-song-genre" data-vid="${s.video_id}" title="Change genre">${esc(s.genre || "Unknown")}</button>
            </td>
            <td class="song-row-actions" style="text-align: right;">
              <button class="sidebar-song-btn sidebar-remove-btn" data-vid="${s.video_id}" title="Remove">✕</button>
            </td>
            <td class="song-row-duration" style="text-align: right; color: var(--text-dim);">—</td>
          </tr>
        `;
      });

      h += `
          </tbody>
        </table>
      `;
    }

    playlistView.innerHTML = h;

    // Attach Listeners
    document.getElementById("sbBack").addEventListener("click", () => showHomeView());
    
    playlistView.querySelectorAll(".genre-pill").forEach(el => {
      el.addEventListener("click", () => renderLiked(el.dataset.genre));
    });

    playlistView.querySelectorAll(".song-row").forEach(el => {
      el.addEventListener("click", (e) => {
        if (e.target.closest(".sidebar-song-genre") || e.target.closest(".sidebar-remove-btn")) return;
        const idx = +el.dataset.idx;
        API("/play_list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ songs, start_index: idx, mode: "list" }) });
      });
    });

    playlistView.querySelectorAll(".sidebar-remove-btn").forEach(el => {
      el.addEventListener("click", async (e) => {
        e.stopPropagation();
        await API("/like", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ video_id: el.dataset.vid }) });
        renderLiked(filterGenre);
      });
    });

    playlistView.querySelectorAll(".sidebar-song-genre").forEach(el => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        showGenreEditModal(el.dataset.vid, el.textContent, "liked", null, filterGenre);
      });
    });

    const playAllBtn = document.getElementById("sbPlayLikedList");
    if (playAllBtn) {
      playAllBtn.addEventListener("click", () => {
        API("/play_list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ songs, start_index: 0, mode: "list" }) });
      });
    }

    const shuffleBtn = document.getElementById("sbShuffleLiked");
    if (shuffleBtn) {
      shuffleBtn.addEventListener("click", () => {
        API("/play_list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ songs, start_index: 0, mode: "shuffle" }) });
      });
    }
  }

  async function renderPlaylistDetail(pid) {
    const pdata = await API(`/playlists/${pid}`);
    if (!pdata || pdata.error) { showHomeView(); return; }
    const songs = pdata.songs || [];
    
    showPlaylistView();

    let h = `
      <button class="playlist-back-btn" id="sbBack">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
        Back to Home
      </button>
      
      <div class="playlist-header">
        <div class="playlist-cover-art" id="sbCoverArea">
          ${pdata.cover ? `<img src="${pdata.cover}" alt="">` : `<span style="font-size:3.5rem;">🎵</span>`}
          <div class="cover-overlay">📷 Change Cover</div>
        </div>
        <div class="playlist-header-info">
          <span class="playlist-badge">Playlist</span>
          <h1 class="playlist-name">${esc(pdata.name)}</h1>
          <p class="playlist-metadata">
            <span class="playlist-creator">Miko</span> • ${songs.length} song${songs.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>
    `;

    // Action bar
    h += `
      <div class="playlist-actions-bar">
        ${songs.length > 0 ? `
          <button class="play-playlist-btn" id="sbPlayPl" title="Play All">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <button class="playlist-action-btn" id="sbShufflePl" title="Shuffle">🔀 Shuffle</button>
        ` : ''}
        <button class="playlist-action-btn" id="sbAddSongs" title="Add Songs">➕ Add Songs</button>
        <button class="playlist-action-btn btn-danger" id="sbDeletePl" title="Delete Playlist">🗑️ Delete</button>
      </div>
    `;

    // Songs Table
    if (songs.length === 0) {
      h += `<p style="color:var(--text-dim);text-align:center;padding:40px 0;font-size:0.88rem;">No songs in this playlist yet. Click "+ Add Songs" to search and add tracks!</p>`;
    } else {
      h += `
        <table class="playlist-songs-table">
          <thead>
            <tr>
              <th style="width: 50px; text-align: center;">#</th>
              <th>Title</th>
              <th>Genre</th>
              <th style="width: 100px;"></th>
              <th style="width: 80px; text-align: right;"><svg class="clock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></th>
            </tr>
          </thead>
          <tbody>
      `;

      songs.forEach((s, i) => {
        h += `
          <tr class="song-row" data-idx="${i}">
            <td class="song-index" style="text-align: center;">${i + 1}</td>
            <td class="song-title-cell">
              <img class="song-row-thumb" src="${s.thumbnail || ""}" alt="" loading="lazy">
              <div class="song-row-details">
                <div class="song-row-title">${esc(s.title)}</div>
                <div class="song-row-artist">${esc(s.artist || "")}</div>
              </div>
            </td>
            <td class="song-row-genre">
              <button class="sidebar-song-genre" data-vid="${s.video_id}" title="Change genre">${esc(s.genre || "Unknown")}</button>
            </td>
            <td class="song-row-actions" style="text-align: right;">
              <button class="sidebar-remove-btn" data-vid="${s.video_id}">✕</button>
            </td>
            <td class="song-row-duration" style="text-align: right; color: var(--text-dim);">—</td>
          </tr>
        `;
      });

      h += `
          </tbody>
        </table>
      `;
    }

    playlistView.innerHTML = h;

    // Attach Listeners
    document.getElementById("sbBack").addEventListener("click", () => showHomeView());
    document.getElementById("sbCoverArea").addEventListener("click", () => showCoverModal(pid));
    
    const playBtn = document.getElementById("sbPlayPl");
    if (playBtn) {
      playBtn.addEventListener("click", () => {
        if (songs.length) API("/play_list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ songs, start_index: 0, mode: "list" }) });
      });
    }

    const shuffleBtn = document.getElementById("sbShufflePl");
    if (shuffleBtn) {
      shuffleBtn.addEventListener("click", () => {
        if (songs.length) API("/play_list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ songs, start_index: 0, mode: "shuffle" }) });
      });
    }

    document.getElementById("sbAddSongs").addEventListener("click", () => showAddSongsModal(pid));
    
    document.getElementById("sbDeletePl").addEventListener("click", async () => {
      if (confirm("Delete this playlist?")) { 
        await API(`/playlists/${pid}`, { method: "DELETE" }); 
        showHomeView();
        renderMain(); 
      }
    });

    playlistView.querySelectorAll(".song-row").forEach(el => {
      el.addEventListener("click", (e) => {
        if (e.target.closest(".sidebar-song-genre") || e.target.closest(".sidebar-remove-btn")) return;
        const idx = +el.dataset.idx;
        API("/play_list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ songs, start_index: idx, mode: "list" }) });
      });
    });

    playlistView.querySelectorAll(".sidebar-remove-btn").forEach(el => {
      el.addEventListener("click", async (e) => {
        e.stopPropagation();
        await API(`/playlists/${pid}/songs`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ video_id: el.dataset.vid }) });
        renderPlaylistDetail(pid);
      });
    });

    playlistView.querySelectorAll(".sidebar-song-genre").forEach(el => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        showGenreEditModal(el.dataset.vid, el.textContent, "playlist", pid);
      });
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
    const presets = ["Pop", "Rock", "Hip-Hop", "R&B", "Electronic", "Jazz", "Classical", "Country", "Latin", "K-Pop", "Bollywood", "Indie", "Metal", "Folk", "Lo-Fi", "DHH", "Unknown"];
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

  // Logo click triggers Home Dashboard
  const logo = document.querySelector(".logo");
  if (logo) {
    logo.style.cursor = "pointer";
    logo.addEventListener("click", () => {
      showHomeView();
    });
  }
})();
