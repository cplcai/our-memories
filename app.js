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
  const heading = element("h3", "", story.title);
  if (story.status) heading.append(element("span", "story-status", story.status));
  body.append(heading, element("p", "", story.text));
  article.append(date, body);
  timeline.append(article);
}
const nextStory = element("div", "timeline-entry next-story");
nextStory.append(element("span", "story-date", "未完待续"), element("p", "story-body", "下一段回忆，等我们一起写下。"));
timeline.append(nextStory);

const photos = document.getElementById("photos");
const dialog = document.getElementById("photo-dialog");
const albumThumbnails = document.getElementById("album-thumbnails");
const archivedAlbums = new Map();
const individualPhotos = [];
let activePhotos = [];
let activeAlbum = "";
let activePhotoIndex = 0;

function showPhoto(index) {
  activePhotoIndex = (index + activePhotos.length) % activePhotos.length;
  const photo = activePhotos[activePhotoIndex];
  const description = activeAlbum ? `${activeAlbum} · 第 ${activePhotoIndex + 1} 张照片` : photo.caption;
  const largePhoto = document.getElementById("large-photo");
  largePhoto.src = photo.src;
  largePhoto.alt = description;
  dialog.classList.toggle("full-resolution-view", Boolean(photo.fullResolution));
  dialog.scrollTop = 0;
  const originalPhoto = document.getElementById("original-photo");
  originalPhoto.href = photo.src;
  originalPhoto.hidden = !photo.fullResolution;
  dialog.setAttribute("aria-label", description);
  document.getElementById("photo-caption").textContent = activeAlbum ? "" : [photo.date && formattedDate(photo.date), photo.caption].filter(Boolean).join(" · ");
  document.getElementById("photo-position").textContent = `${activePhotoIndex + 1} / ${activePhotos.length}`;
  document.getElementById("previous-photo").disabled = activePhotos.length < 2;
  document.getElementById("next-photo").disabled = activePhotos.length < 2;
  for (const [thumbnailIndex, button] of Array.from(albumThumbnails.children).entries()) {
    button.setAttribute("aria-current", String(thumbnailIndex === activePhotoIndex));
  }
  if (activeAlbum && dialog.open) {
    albumThumbnails.children[activePhotoIndex].scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

function photoImage(photo, description) {
  const image = element("img", "");
  image.src = photo.thumbnail || photo.src;
  image.alt = description;
  image.loading = "lazy";
  image.decoding = "async";
  image.width = photo.width || 600;
  image.height = photo.height || 600;
  return image;
}

function openPhotos(collection, index, album = "") {
  activePhotos = collection;
  activeAlbum = album;
  dialog.classList.toggle("album-view", Boolean(album));
  const title = document.getElementById("photo-dialog-title");
  title.textContent = album;
  title.hidden = !album;
  document.getElementById("photo-caption").hidden = Boolean(album);
  albumThumbnails.hidden = !album;
  albumThumbnails.replaceChildren();
  if (album) {
    collection.forEach((photo, photoIndex) => {
      const button = element("button", "album-thumbnail");
      button.type = "button";
      button.setAttribute("aria-label", `查看第 ${photoIndex + 1} 张照片`);
      button.append(photoImage(photo, `${album} · 第 ${photoIndex + 1} 张照片`));
      button.addEventListener("click", () => showPhoto(photoIndex));
      albumThumbnails.append(button);
    });
  }
  dialog.showModal();
  showPhoto(index);
}

for (const photo of memories.photos) {
  const inFolder = photo.source ? /[\\/]/.test(photo.source) : photo.album && photo.album !== "点滴回忆";
  if (inFolder) {
    const album = photo.album || photo.source.split(/[\\/]/).slice(0, -1).join(" / ");
    if (!archivedAlbums.has(album)) archivedAlbums.set(album, []);
    archivedAlbums.get(album).push(photo);
  } else {
    individualPhotos.push(photo);
  }
}

for (const [album, collection] of archivedAlbums) {
  const albumTitle = album.replaceAll(" / ", " · ");
  const button = element("button", "album-card");
  button.type = "button";
  button.setAttribute("aria-label", `打开相册 ${albumTitle}，共 ${collection.length} 张照片`);
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-controls", "photo-dialog");
  const stack = element("span", "photo-stack");
  stack.setAttribute("aria-hidden", "true");
  for (let layer = Math.min(2, collection.length - 1); layer >= 0; layer -= 1) {
    const image = photoImage(collection[layer], "");
    image.className = `stack-photo stack-layer-${layer}`;
    stack.append(image);
  }
  button.append(stack, element("span", "album-card-title", albumTitle), element("span", "album-card-count", `${collection.length} 张照片`));
  button.addEventListener("click", () => openPhotos(collection, 0, albumTitle));
  photos.append(button);
}

individualPhotos.forEach((photo, index) => {
  const button = element("button", "photo-card");
  button.classList.toggle("full-resolution-card", Boolean(photo.fullResolution));
  button.type = "button";
  button.setAttribute("aria-label", `查看照片 ${photo.caption}`);
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-controls", "photo-dialog");
  button.append(photoImage(photo, photo.caption), element("span", "photo-card-caption", photo.caption));
  button.addEventListener("click", () => openPhotos(individualPhotos, index));
  photos.append(button);
});
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
  document.getElementById("album-note").hidden = true;
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
