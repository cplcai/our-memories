(() => {
  "use strict";
  const endpoint = "https://cplbjx-memory-notes.littlehinny16.chatgpt.site/api/notes";
  const form = document.getElementById("note-form");
  const text = document.getElementById("note-text");
  const password = document.getElementById("note-password");
  const submit = document.getElementById("note-submit");
  const submitStatus = document.getElementById("note-submit-status");
  const readStatus = document.getElementById("notes-read-status");
  const list = document.getElementById("notes-list");
  const scroll = document.getElementById("notes-scroll");
  const refresh = document.getElementById("notes-refresh");
  const more = document.getElementById("notes-more");
  const postedNotes = new Map();
  let notes = new Map();
  let nextCursor = null;
  let reading = false;
  let publishing = false;
  let draftId = null;
  let draftText = "";

  async function request(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const result = await fetch(url, { ...options, signal: controller.signal, credentials: "omit", cache: "no-store" });
      let data;
      try { data = await result.json(); }
      catch { throw new Error("便签服务暂时不可用，请稍后重试"); }
      if (!result.ok) throw new Error(data.error || "便签暂时保存失败，请重试");
      return data;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("连接便签服务超时，请稍后重试");
      if (error instanceof TypeError) throw new Error("便签服务连接暂时中断，请稍后重试");
      throw error;
    } finally { clearTimeout(timeout); }
  }

  function render() {
    const previousScroll = scroll.scrollTop;
    list.replaceChildren();
    const ordered = Array.from(notes.values()).sort((first, second) => second.createdAt.localeCompare(first.createdAt) || second.id.localeCompare(first.id));
    for (const note of ordered) {
      const paper = document.createElement("article");
      paper.className = "sticky-note";
      paper.dataset.tone = String(parseInt(note.id[0], 16) % 4);
      const content = document.createElement("p");
      content.textContent = note.text;
      const date = document.createElement("time");
      date.dateTime = note.createdAt;
      date.textContent = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(note.createdAt));
      paper.append(content, date);
      list.append(paper);
    }
    if (!ordered.length) {
      const empty = document.createElement("p");
      empty.className = "notes-empty";
      empty.textContent = "第一张便签，等你来写。";
      list.append(empty);
    }
    more.hidden = !nextCursor;
    scroll.scrollTop = previousScroll;
  }

  async function load(older = false) {
    if (reading || (older && !nextCursor)) return;
    reading = true;
    refresh.disabled = true;
    more.disabled = true;
    readStatus.textContent = older ? "正在翻看更早的便签……" : "正在读取便签……";
    try {
      const data = await request(endpoint + (older ? "?cursor=" + encodeURIComponent(nextCursor) : ""));
      if (!older) notes = new Map(postedNotes);
      for (const note of data.notes) notes.set(note.id, note);
      nextCursor = data.nextCursor;
      render();
      if (!older) scroll.scrollTop = 0;
      readStatus.textContent = "";
    } catch (error) { readStatus.textContent = error.message; }
    finally {
      reading = false;
      refresh.disabled = false;
      more.disabled = false;
    }
  }

  text.addEventListener("input", () => {
    if (text.value !== draftText) draftId = null;
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (publishing || !form.reportValidity()) return;
    if (!text.value.trim()) { submitStatus.textContent = "请先写下想说的话"; return; }
    const content = text.value;
    if (!draftId || draftText !== content) draftId = crypto.randomUUID();
    draftText = content;
    publishing = true;
    submit.disabled = true;
    submitStatus.textContent = "正在贴上便签……";
    try {
      const data = await request(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: draftId, text: content, password: password.value }) });
      notes.set(data.note.id, data.note);
      postedNotes.set(data.note.id, data.note);
      render();
      scroll.scrollTop = 0;
      if (text.value === content) text.value = "";
      password.value = "";
      draftId = null;
      submitStatus.textContent = "便签贴好啦 ♡";
    } catch (error) { submitStatus.textContent = error.message; }
    finally { publishing = false; submit.disabled = false; }
  });
  refresh.addEventListener("click", () => load());
  more.addEventListener("click", () => load(true));
  load();
})();
