"use strict";

const main = document.getElementById("main");
let state;
let tab = "photos";
let filter = "all";
let search = "";
let limit = 36;
let selected = new Set();
let busy = false;
let formDirty = false;
let photoDirty = false;
let queue = [];
let uploading = false;
let pauseUpload = false;
let pollTimer;
let toastTimer;

function escape(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function archived(photo) {
  return photo.source ? /[\\/]/.test(photo.source) : photo.album && photo.album !== "点滴回忆";
}

function albums() {
  return Array.from(new Set(state.photos.filter(archived).map(photo => photo.album)));
}

function photoName(photo) {
  return archived(photo) ? photo.album.replaceAll(" / ", " · ") : photo.caption;
}

function toast(message, error = false) {
  const target = document.getElementById("toast");
  target.textContent = message;
  target.classList.toggle("error", error);
  target.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { target.hidden = true; }, error ? 10000 : 4000);
}

async function api(endpoint, options = {}) {
  const headers = { ...options.headers };
  let body = options.body;
  if (options.method && options.method !== "GET") {
    headers["X-Manager-Token"] = state.csrf;
    headers["If-Match"] = '"' + state.revision + '"';
  }
  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  const response = await fetch(endpoint, { ...options, headers, body });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "操作失败，请重试");
  return value;
}

function acceptState(next) {
  state = next;
  const currentIds = new Set(state.photos.map(photo => photo.id));
  selected = new Set(Array.from(selected).filter(id => currentIds.has(id)));
  document.getElementById("site-name").textContent = state.config.title;
  document.getElementById("album-names").innerHTML = albums().map(album => `<option value="${escape(album)}"></option>`).join("");
  document.getElementById("draft-status").textContent = state.dirty ? "本地草稿待发布" : "网站内容已同步";
  document.getElementById("publish").disabled = busy || state.publishing.status === "publishing";
  if (state.publishing.status === "publishing") startPublishPolling();
}

async function perform(action) {
  if (busy) return;
  if (uploading) { toast("请先完成或暂停当前上传"); return; }
  busy = true;
  document.getElementById("publish").disabled = true;
  try { await action(); }
  catch (error) { toast(error.message, true); }
  finally {
    busy = false;
    if (state) document.getElementById("publish").disabled = state.publishing.status === "publishing";
  }
}

async function refresh() {
  acceptState(await api("/api/state"));
  formDirty = false;
  render();
}

function heading(title, subtitle, action = "") {
  return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`;
}

function visiblePhotos() {
  return state.photos.filter(photo => {
    const groupMatches = filter === "all" || (filter === "single" ? !archived(photo) : photo.album === filter && archived(photo));
    const words = `${photo.caption} ${photo.album} ${photo.source}`.toLowerCase();
    return groupMatches && words.includes(search.toLowerCase());
  });
}

function renderPhotos() {
  main.innerHTML = heading("照片与相册", `${state.photos.length} 张照片 · ${albums().length} 本相册，修改先保存为本地草稿。`, '<button class="primary" data-action="upload">＋ 上传照片</button>') +
    `<div class="filters"><select id="photo-filter" aria-label="筛选相册"><option value="all">全部照片</option><option value="single">独立照片与配文</option>${albums().map(album => `<option value="${escape(album)}"${filter === album ? " selected" : ""}>${escape(album)}</option>`).join("")}</select><input id="photo-search" placeholder="搜索配文或文件名" aria-label="搜索照片" value="${escape(search)}"><button data-action="rename" id="rename-album">重命名相册</button></div>
    <div class="selection-bar"><span id="selection-count"></span><button data-action="select-all">全选当前列表</button><button data-action="download" data-selection>打包下载</button><button data-action="move" data-selection>移动到相册</button><button data-action="remove" data-selection>移出相册</button></div><div class="photo-grid" id="photo-grid"></div><div class="more-row"><button data-action="more" id="more-photos">再显示一些照片</button></div>`;
  document.getElementById("photo-filter").value = filter;
  document.getElementById("photo-filter").addEventListener("change", event => {
    filter = event.target.value;
    limit = 36;
    selected.clear();
    renderPhotoGrid();
  });
  document.getElementById("photo-search").addEventListener("input", event => { search = event.target.value; limit = 36; renderPhotoGrid(); });
  renderPhotoGrid();
}

function renderPhotoGrid() {
  const filtered = visiblePhotos();
  document.getElementById("photo-grid").innerHTML = filtered.slice(0, limit).map(photo =>
    `<article class="photo-tile${selected.has(photo.id) ? " selected" : ""}" data-id="${escape(photo.id)}"><input type="checkbox" data-select="${escape(photo.id)}" aria-label="选择 ${escape(photoName(photo))}"${selected.has(photo.id) ? " checked" : ""}><button class="tile-image" data-edit="${escape(photo.id)}" aria-label="编辑 ${escape(photoName(photo))}"><img src="${escape(photo.previewUrl)}" alt="${escape(photoName(photo))}" loading="lazy"></button><div class="tile-caption"><strong>${escape(photoName(photo))}</strong><small>${photo.fullResolution ? "原图阅读" : `${photo.width} × ${photo.height}`}${state.hero.src === photo.src ? " · 首页照片" : ""}</small></div><div class="tile-actions"><button data-edit="${escape(photo.id)}">编辑</button><a class="button" href="/api/download/${encodeURIComponent(photo.id)}">${photo.originalAvailable ? "下载原图" : "下载照片"}</a></div></article>`
  ).join("") || '<div class="empty">这里等着收藏新的回忆。</div>';
  document.getElementById("more-photos").hidden = filtered.length <= limit;
  document.getElementById("rename-album").disabled = filter === "all" || filter === "single";
  updateSelection();
}

function updateSelection() {
  document.getElementById("selection-count").textContent = selected.size ? `已选择 ${selected.size} 张` : `当前列表 ${visiblePhotos().length} 张照片`;
  document.querySelectorAll("[data-selection]").forEach(button => { button.disabled = selected.size === 0; });
}

function storyRows(stories) {
  return stories.map((story, index) => `<div class="record" data-record="${index}"><label>日期<input type="date" name="date" value="${escape(story.date)}" required></label><label>小事标题<input name="title" value="${escape(story.title)}" required><textarea name="text" rows="2" placeholder="想记下的话">${escape(story.text)}</textarea></label><div class="record-actions"><label>状态<select name="status">${["", "待实现", "计划中", "已实现"].map(status => `<option value="${status}"${story.status === status ? " selected" : ""}>${status || "已记录"}</option>`).join("")}</select></label><button type="button" data-remove-story="${index}">移除</button></div></div>`).join("");
}

function renderStories() {
  main.innerHTML = heading("重要的小事", "按日期整理故事，保存后会自动排好顺序。") + `<form data-editor="stories" class="panel"><div id="story-records">${storyRows(state.config.stories)}</div><div class="form-footer"><button type="button" data-action="add-story">＋ 添加小事</button><button type="submit" class="primary">保存时间轴</button></div></form>`;
}

function collectStories() {
  return Array.from(document.querySelectorAll("#story-records .record"), record => ({ date: record.querySelector('[name="date"]').value, title: record.querySelector('[name="title"]').value, text: record.querySelector('[name="text"]').value, status: record.querySelector('[name="status"]').value }));
}

function wishRows(wishes) {
  return wishes.map((wish, index) => `<div class="wish-record"><label><input name="done" type="checkbox" aria-label="心愿已实现"${wish.done ? " checked" : ""}><input name="text" type="text" value="${escape(wish.text)}" placeholder="想一起做的事" required></label><button type="button" data-remove-wish="${index}">移除</button></div>`).join("");
}

function collectWishes() {
  return Array.from(document.querySelectorAll(".wish-record"), row => ({ text: row.querySelector('[name="text"]').value, done: row.querySelector('[name="done"]').checked }));
}

function renderWishes() {
  main.innerHTML = heading("共同心愿", "把期待写下来，实现以后打个勾。") + `<form data-editor="wishes" class="panel"><div id="wish-records">${wishRows(state.config.wishes)}</div><div class="form-footer"><button type="button" data-action="add-wish">＋ 添加心愿</button><button type="submit" class="primary">保存心愿</button></div></form>`;
}

function renderSettings() {
  const config = state.config;
  main.innerHTML = heading("网站设置", "编辑你们的名字、纪念日和首页文字。") + `<form data-editor="settings" class="panel"><div class="form-grid"><label class="wide">网站标题<input name="title" value="${escape(config.title)}" required></label><label>男生昵称<input name="personOne" value="${escape(config.personOne)}" required></label><label>女生昵称<input name="personTwo" value="${escape(config.personTwo)}" required></label><label>恋爱纪念日<input name="startDate" type="date" value="${escape(config.startDate)}" required></label><label>首页照片配文<input name="heroCaption" value="${escape(state.hero.caption)}" required></label><label class="wide">首页介绍<textarea name="introduction" rows="4">${escape(config.introduction)}</textarea></label></div><p class="hint">在“照片与相册”中打开任意照片，可以把它设为首页照片。</p><div class="form-footer"><button type="submit" class="primary">保存网站设置</button></div></form>`;
}

function render() {
  document.querySelectorAll("[data-tab]").forEach(button => {
    button.classList.toggle("active", button.dataset.tab === tab);
    button.setAttribute("aria-pressed", String(button.dataset.tab === tab));
  });
  ({ photos: renderPhotos, stories: renderStories, wishes: renderWishes, settings: renderSettings })[tab]();
}

function editPhoto(id) {
  photoDirty = false;
  const photo = state.photos.find(item => item.id === id);
  const form = document.getElementById("photo-form");
  form.elements.id.value = id;
  form.elements.caption.value = photo.caption;
  form.elements.album.value = archived(photo) ? photo.album : "";
  form.elements.date.value = photo.date || "";
  form.elements.fullResolution.checked = Boolean(photo.fullResolution);
  document.getElementById("editor-preview").src = photo.imageUrl;
  document.getElementById("editor-download").href = `/api/download/${encodeURIComponent(id)}`;
  document.getElementById("editor-download").textContent = photo.originalAvailable ? "下载原图" : "下载照片";
  document.getElementById("photo-dialog").showModal();
}

async function savePhoto() {
  const form = document.getElementById("photo-form");
  if (!form.reportValidity()) return false;
  acceptState(await api("/api/photos", { method: "PATCH", body: { ids: [form.elements.id.value], caption: form.elements.caption.value, album: form.elements.album.value, date: form.elements.date.value, fullResolution: form.elements.fullResolution.checked } }));
  photoDirty = false;
  return true;
}

function renderQueue() {
  document.getElementById("upload-queue").innerHTML = queue.map((item, index) => `<div class="queue-item"><span>${escape(item.relative || item.file.name)}</span><button type="button" data-remove-upload="${index}" aria-label="移除 ${escape(item.file.name)}"${uploading ? " disabled" : ""}>×</button></div>`).join("");
  document.getElementById("start-upload").disabled = !queue.length || uploading;
}

function addFiles(files) {
  if (uploading) { toast("请先完成或暂停当前上传"); return; }
  for (const file of files) {
    if (!file.type.startsWith("image/") && !/\.(jpe?g|png|webp|gif|avif|heic|tiff?)$/i.test(file.name)) continue;
    const relative = file.webkitRelativePath || file.name;
    if (!queue.some(item => item.relative === relative && item.file.size === file.size && item.file.lastModified === file.lastModified)) queue.push({ file, relative });
  }
  renderQueue();
}

async function uploadFiles(event) {
  event.preventDefault();
  if (uploading || !queue.length) return;
  uploading = true;
  pauseUpload = false;
  const form = event.currentTarget;
  const baseAlbum = form.elements.album.value.trim();
  const mode = form.elements.mode.value;
  const folders = form.elements.folders.checked;
  let count = 0;
  const total = queue.length;
  document.getElementById("pause-upload").hidden = false;
  document.querySelector('[data-close="upload-dialog"]').disabled = true;
  renderQueue();
  try {
    while (queue.length && !pauseUpload) {
      const item = queue[0];
      const directory = folders && item.relative.includes("/") ? item.relative.split("/").slice(0, -1).join(" / ") : "";
      const album = [baseAlbum, directory].filter(Boolean).join(" / ");
      const data = new FormData();
      data.set("options", JSON.stringify({ album, caption: item.file.name.replace(/\.[^.]+$/, ""), mode }));
      data.set("file", item.file);
      document.getElementById("upload-status").textContent = `正在保存 ${count + 1} / ${total} · ${item.file.name}`;
      acceptState(await api("/api/photos", { method: "POST", body: data }));
      queue.shift();
      count += 1;
      renderQueue();
    }
    document.getElementById("upload-status").textContent = `已保存 ${count} 张，${queue.length ? `还有 ${queue.length} 张待上传。` : "可以预览或发布了。"}`;
    toast(`已保存 ${count} 张照片到本地草稿`);
    renderPhotos();
    if (!queue.length) document.getElementById("upload-dialog").close();
  } catch (error) {
    document.getElementById("upload-status").textContent = `已保存 ${count} 张。${error.message}`;
    toast(error.message, true);
  } finally {
    uploading = false;
    document.getElementById("pause-upload").hidden = true;
    document.querySelector('[data-close="upload-dialog"]').disabled = false;
    renderQueue();
  }
}

function startPublishPolling() {
  if (pollTimer) return;
  const banner = document.getElementById("publish-progress");
  banner.hidden = false;
  banner.textContent = state.publishing.message;
  pollTimer = setInterval(async () => {
    try {
      const job = await api("/api/publish-status");
      state.publishing = job;
      banner.textContent = job.message;
      if (job.status !== "publishing") {
        clearInterval(pollTimer);
        pollTimer = null;
        document.getElementById("publish").disabled = false;
        if (job.status === "complete") {
          const link = document.createElement("a");
          link.href = job.url + "?v=" + job.commit.slice(0, 8);
          link.target = "_blank";
          link.rel = "noopener";
          link.textContent = "打开网站 ↗";
          banner.append(link);
          acceptState(await api("/api/state"));
          toast("网站已发布");
        } else toast(job.message, true);
      }
    } catch (error) { banner.textContent = error.message; }
  }, 2000);
}

document.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => {
  if (uploading) { toast("请先完成或暂停当前上传"); return; }
  if (formDirty && !window.confirm("当前输入待保存，切换页面会放弃这次输入。继续切换？")) return;
  formDirty = false;
  tab = button.dataset.tab;
  render();
}));

main.addEventListener("input", event => { if (event.target.closest("[data-editor]")) formDirty = true; });
main.addEventListener("change", event => {
  if (event.target.dataset.select) {
    const id = event.target.dataset.select;
    if (event.target.checked) selected.add(id); else selected.delete(id);
    event.target.closest(".photo-tile").classList.toggle("selected", event.target.checked);
    updateSelection();
  }
});

main.addEventListener("click", event => {
  const edit = event.target.closest("[data-edit]");
  if (edit) return editPhoto(edit.dataset.edit);
  const removeStory = event.target.closest("[data-remove-story]");
  if (removeStory) {
    document.getElementById("story-records").innerHTML = storyRows(collectStories().filter((_, index) => index !== Number(removeStory.dataset.removeStory)));
    formDirty = true;
    return;
  }
  const removeWish = event.target.closest("[data-remove-wish]");
  if (removeWish) {
    document.getElementById("wish-records").innerHTML = wishRows(collectWishes().filter((_, index) => index !== Number(removeWish.dataset.removeWish)));
    formDirty = true;
    return;
  }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "upload") {
    const uploadForm = document.getElementById("upload-form");
    uploadForm.elements.album.value = ["all", "single"].includes(filter) ? "" : filter;
    document.getElementById("upload-dialog").showModal();
    renderQueue();
  }
  if (action === "more") { limit += 36; renderPhotoGrid(); }
  if (action === "select-all") { selected = new Set(visiblePhotos().map(photo => photo.id)); renderPhotoGrid(); }
  if (action === "move") document.getElementById("move-dialog").showModal();
  if (action === "rename") {
    document.getElementById("rename-form").elements.name.value = filter;
    document.getElementById("rename-dialog").showModal();
  }
  if (action === "download") perform(async () => {
    const ticket = await api("/api/download-ticket", { method: "POST", body: { ids: Array.from(selected) } });
    const link = document.createElement("a");
    link.href = ticket.url;
    link.download = "我们的回忆.zip";
    link.click();
    toast("正在准备相册下载");
  });
  if (action === "remove" && window.confirm(`从相册移出选中的 ${selected.size} 张照片？发布后相册会同步更新。`)) perform(async () => {
    acceptState(await api("/api/photos", { method: "PATCH", body: { ids: Array.from(selected), remove: true } }));
    selected.clear();
    render();
    toast("已保存移除操作到本地草稿");
  });
  if (action === "add-story") {
    document.getElementById("story-records").innerHTML = storyRows([...collectStories(), { date: "", title: "", text: "", status: "" }]);
    formDirty = true;
  }
  if (action === "add-wish") {
    document.getElementById("wish-records").innerHTML = wishRows([...collectWishes(), { text: "", done: false }]);
    formDirty = true;
  }
});

main.addEventListener("submit", event => {
  event.preventDefault();
  const form = event.target;
  if (!form.dataset.editor) return;
  perform(async () => {
    let body;
    if (form.dataset.editor === "stories") body = { values: { stories: collectStories() } };
    if (form.dataset.editor === "wishes") body = { values: { wishes: collectWishes() } };
    if (form.dataset.editor === "settings") {
      const values = Object.fromEntries(new FormData(form));
      const heroCaption = values.heroCaption;
      delete values.heroCaption;
      body = { values, heroCaption };
    }
    acceptState(await api("/api/config", { method: "PATCH", body }));
    formDirty = false;
    render();
    toast("已保存到本地草稿");
  });
});

document.getElementById("photo-form").addEventListener("submit", event => {
  event.preventDefault();
  perform(async () => {
    if (await savePhoto()) {
      document.getElementById("photo-dialog").close();
      renderPhotos();
      toast("照片修改已保存");
    }
  });
});
document.getElementById("set-hero").addEventListener("click", () => perform(async () => {
  if (!await savePhoto()) return;
  const photo = state.photos.find(item => item.id === document.getElementById("photo-form").elements.id.value);
  acceptState(await api("/api/config", { method: "PATCH", body: { heroId: photo.id, heroCaption: photoName(photo) } }));
  document.getElementById("photo-dialog").close();
  renderPhotos();
  toast("首页照片已保存，可预览效果");
}));
document.getElementById("move-form").addEventListener("submit", event => {
  event.preventDefault();
  const album = event.target.elements.album.value;
  perform(async () => {
    acceptState(await api("/api/photos", { method: "PATCH", body: { ids: Array.from(selected), album } }));
    selected.clear();
    filter = album || "single";
    document.getElementById("move-dialog").close();
    renderPhotos();
    toast("照片已移入目标相册");
  });
});
document.getElementById("rename-form").addEventListener("submit", event => {
  event.preventDefault();
  const newName = event.target.elements.name.value;
  perform(async () => {
    acceptState(await api("/api/album", { method: "PATCH", body: { name: filter, newName } }));
    filter = newName.trim();
    document.getElementById("rename-dialog").close();
    renderPhotos();
    toast("相册名称已保存");
  });
});

document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => {
  if (button.dataset.close === "photo-dialog" && photoDirty && !window.confirm("照片修改待保存，关闭会放弃这次输入。继续关闭？")) return;
  document.getElementById(button.dataset.close).close();
  photoDirty = false;
}));
document.getElementById("photo-form").addEventListener("input", () => { photoDirty = true; });
document.getElementById("photo-dialog").addEventListener("cancel", event => {
  if (photoDirty && !window.confirm("照片修改待保存，关闭会放弃这次输入。继续关闭？")) event.preventDefault();
});
document.getElementById("upload-dialog").addEventListener("cancel", event => { if (uploading) event.preventDefault(); });
document.getElementById("upload-files").addEventListener("change", event => { addFiles(event.target.files); event.target.value = ""; });
document.getElementById("upload-folder").addEventListener("change", event => { addFiles(event.target.files); event.target.value = ""; });
document.getElementById("upload-queue").addEventListener("click", event => {
  const button = event.target.closest("[data-remove-upload]");
  if (button && !uploading) { queue.splice(Number(button.dataset.removeUpload), 1); renderQueue(); }
});
const dropZone = document.getElementById("drop-zone");
dropZone.addEventListener("dragover", event => { event.preventDefault(); dropZone.classList.add("dragging"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragging"));
dropZone.addEventListener("drop", event => { event.preventDefault(); dropZone.classList.remove("dragging"); if (!uploading) addFiles(event.dataTransfer.files); });
document.getElementById("upload-form").addEventListener("submit", uploadFiles);
document.getElementById("pause-upload").addEventListener("click", () => { pauseUpload = true; document.getElementById("upload-status").textContent = "当前这张保存完成后暂停。"; });
document.getElementById("refresh").addEventListener("click", () => {
  if (formDirty && !window.confirm("当前输入待保存，刷新会放弃这次输入。继续刷新？")) return;
  perform(refresh);
});
document.getElementById("publish").addEventListener("click", () => perform(async () => {
  if (formDirty) throw new Error("请先保存当前页面的编辑内容");
  if (uploading) throw new Error("请等照片保存完成后再发布");
  state.publishing = await api("/api/publish", { method: "POST" });
  startPublishPolling();
}));
window.addEventListener("beforeunload", event => { if (formDirty || photoDirty || uploading) { event.preventDefault(); event.returnValue = ""; } });
refresh().catch(error => {
  main.innerHTML = `<div class="panel"><h2>管理台连接待恢复</h2><p class="hint">请双击项目中的“启动管理台.cmd”，然后打开本机管理地址。</p><p>${escape(error.message)}</p><button type="button" onclick="location.reload()">重新连接</button></div>`;
});
