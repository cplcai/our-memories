"use strict";

const memories = window.MEMORIES;
const dayMilliseconds = 86400000;

function dateNumber(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const [year, month, day] = value.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day));
  if (result.getUTCFullYear() !== year || result.getUTCMonth() !== month - 1 || result.getUTCDate() !== day) return NaN;
  return result.getTime();
}

function formattedDate(value) {
  return value.replaceAll("-", ".");
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

document.title = memories.title;
document.querySelectorAll("[data-site-title]").forEach(node => { node.textContent = memories.title; });
document.getElementById("person-one").textContent = memories.personOne;
document.getElementById("person-two").textContent = memories.personTwo;
document.getElementById("intro").textContent = memories.introduction;
document.getElementById("signature").textContent = `${memories.personOne} & ${memories.personTwo}`;
document.querySelector('meta[name="description"]').content = `${memories.personOne}与${memories.personTwo}的回忆小站，收藏一起走过的日子。`;
for (const id of ["start-date", "footer-date"]) {
  const date = document.getElementById(id);
  date.dateTime = memories.startDate;
  date.textContent = formattedDate(memories.startDate);
}

function updateCounter() {
  const nowInShanghai = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const days = Math.floor((dateNumber(nowInShanghai) - dateNumber(memories.startDate)) / dayMilliseconds);
  document.getElementById("days").textContent = Number.isFinite(days) && days >= 0 ? String(days) : "—";
}
updateCounter();
setInterval(updateCounter, 60000);

const timeline = document.getElementById("timeline");
for (const story of memories.stories) {
  const article = element("article", "timeline-entry");
  const date = element("time", "story-date", formattedDate(story.date));
  date.dateTime = story.date;
  const body = element("div", "story-body");
  body.append(element("h3", "", story.title), element("p", "", story.text));
  article.append(date, body);
  timeline.append(article);
}
const nextStory = element("div", "timeline-entry next-story");
nextStory.append(element("span", "story-date", "未完待续"), element("p", "story-body", "下一段回忆，等我们一起写下。"));
timeline.append(nextStory);

const photos = document.getElementById("photos");
const dialog = document.getElementById("photo-dialog");
const albumFilter = document.getElementById("album-filter");
const loadMore = document.getElementById("load-more");
const batchSize = 24;
let filteredPhotos = memories.photos;
let visiblePhotoCount = 0;
let activePhotoIndex = 0;

function showPhoto(index) {
  activePhotoIndex = (index + filteredPhotos.length) % filteredPhotos.length;
  const photo = filteredPhotos[activePhotoIndex];
  const largePhoto = document.getElementById("large-photo");
  largePhoto.src = photo.src;
  largePhoto.alt = photo.caption;
  document.getElementById("photo-caption").textContent = [photo.album, photo.date && formattedDate(photo.date), photo.caption].filter(Boolean).join(" · ");
  document.getElementById("photo-position").textContent = `${activePhotoIndex + 1} / ${filteredPhotos.length}`;
  document.getElementById("previous-photo").disabled = filteredPhotos.length < 2;
  document.getElementById("next-photo").disabled = filteredPhotos.length < 2;
}

function renderNextPhotos() {
  const nextPhotoCount = Math.min(visiblePhotoCount + batchSize, filteredPhotos.length);
  for (let index = visiblePhotoCount; index < nextPhotoCount; index += 1) {
    const photo = filteredPhotos[index];
    const button = element("button", "photo-card");
    button.type = "button";
    button.setAttribute("aria-label", `查看照片 ${photo.caption}`);
    const image = element("img", "");
    image.src = photo.thumbnail || photo.src;
    image.alt = photo.caption;
    image.loading = "lazy";
    image.decoding = "async";
    image.width = photo.width || 600;
    image.height = photo.height || 600;
    const caption = element("span", "photo-card-caption", photo.caption);
    button.append(image, caption);
    button.addEventListener("click", () => {
      showPhoto(index);
      dialog.showModal();
    });
    photos.append(button);
  }
  visiblePhotoCount = nextPhotoCount;
  document.getElementById("photo-count").textContent = `已展示 ${visiblePhotoCount} / ${filteredPhotos.length} 张`;
  loadMore.hidden = visiblePhotoCount >= filteredPhotos.length;
}

const albumCounts = new Map();
for (const photo of memories.photos) {
  const album = photo.album || "点滴回忆";
  albumCounts.set(album, (albumCounts.get(album) || 0) + 1);
}
for (const [album, count] of albumCounts) {
  const option = element("option", "", `${album}（${count} 张）`);
  option.value = album;
  albumFilter.append(option);
}

albumFilter.addEventListener("change", () => {
  filteredPhotos = memories.photos.filter(photo => !albumFilter.value || (photo.album || "点滴回忆") === albumFilter.value);
  photos.replaceChildren();
  visiblePhotoCount = 0;
  renderNextPhotos();
});
loadMore.addEventListener("click", renderNextPhotos);
document.getElementById("previous-photo").addEventListener("click", () => showPhoto(activePhotoIndex - 1));
document.getElementById("next-photo").addEventListener("click", () => showPhoto(activePhotoIndex + 1));
dialog.addEventListener("keydown", event => {
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    showPhoto(activePhotoIndex - 1);
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    showPhoto(activePhotoIndex + 1);
  }
});

if (memories.photos.length === 0) {
  for (const [symbol, label] of [["♡", "我们的合照"], ["☀", "一起看过的风景"], ["✿", "值得记住的小事"]]) {
    const placeholder = element("div", "photo-placeholder");
    const mark = element("span", "placeholder-symbol", symbol);
    mark.setAttribute("aria-hidden", "true");
    placeholder.append(mark, element("p", "", label), element("small", "", "等待收藏"));
    photos.append(placeholder);
  }
} else {
  document.getElementById("album-toolbar").hidden = false;
  document.getElementById("album-note").hidden = true;
  renderNextPhotos();
}
document.querySelector(".close-dialog").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", event => {
  if (event.target === dialog) dialog.close();
});

const wishes = document.getElementById("wish-list");
for (const wish of memories.wishes) {
  const row = element("div", `wish-row${wish.done ? " done" : ""}`);
  row.append(element("span", "wish-status", wish.done ? "✓" : "○"), element("p", "", wish.text), element("small", "", wish.done ? "已实现" : "期待中"));
  wishes.append(row);
}
if (memories.wishes.length === 0) {
  const empty = element("div", "wish-empty");
  empty.append(element("span", "", "给未来留一点期待"), element("p", "", "我们的心愿清单，等我们一起填写。"));
  wishes.append(empty);
}
