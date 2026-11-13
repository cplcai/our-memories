const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");
const { spawn, spawnSync, execFile } = require("node:child_process");
const { pipeline } = require("node:stream/promises");

const root = path.resolve(process.env.MEMORIES_PROJECT_ROOT || path.join(__dirname, ".."));
const runtime = path.join(__dirname, "..", ".tools", "photo-processing", "node_modules");
const sharp = require(path.join(runtime, "sharp"));
const Busboy = require(path.join(runtime, "busboy"));
const { Zip, ZipPassThrough } = require(path.join(runtime, "fflate"));
const port = Number(process.env.MEMORIES_MANAGER_PORT || 5207);
const address = `http://127.0.0.1:${port}`;
const csrf = crypto.randomBytes(32).toString("hex");
const work = path.join(root, ".tools", "manager");
const gh = fs.existsSync(path.join(root, ".tools", "github-cli", "bin", "gh.exe"))
  ? path.join(root, ".tools", "github-cli", "bin", "gh.exe") : "gh";
const environment = { ...process.env, GH_CONFIG_DIR: path.join(root, ".tools", "gh-config"), GIT_TERMINAL_PROMPT: "0" };
const sitePaths = ["config.js", "photo-library.js", "index.html", "app.js", "style.css", "images"];
const tickets = new Map();
const originalExtensions = { jpeg: ".jpg", png: ".png", webp: ".webp", gif: ".gif", avif: ".avif" };
let mutationQueue = Promise.resolve();
let publishing = { status: "idle", message: "准备就绪" };

if (process.argv[2] === "--git-credential") {
  const result = spawnSync(gh, ["auth", "git-credential", ...process.argv.slice(3)], { env: environment, stdio: "inherit", windowsHide: true });
  process.exit(result.status ?? 1);
}

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: environment, windowsHide: true, ...options });
    let output = "";
    let errors = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { errors += chunk; });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0 || options.allowFailure) resolve({ code, output: output.trim(), errors: errors.trim() });
      else reject(new Error(errors.trim() || output.trim() || `${command} 执行失败`));
    });
  });
}

function imagePath(source) {
  if (typeof source !== "string" || !/^\.\/images\//.test(source)) fail("照片路径无效");
  const resolved = path.resolve(root, source);
  if (!resolved.startsWith(path.join(root, "images") + path.sep)) fail("照片路径超出网站目录");
  return resolved;
}

function safeName(value) {
  return String(value || "照片").replace(/[\\/<>:"|?*\x00-\x1f]/g, "_").replace(/^[. ]+|[. ]+$/g, "").slice(0, 180) || "照片";
}

function photoId(photo, index) {
  return photo.id || crypto.createHash("sha256").update(`${photo.src}\0${photo.source || ""}\0${index}`).digest("hex").slice(0, 24);
}

function decodeHtml(value) {
  return value.replace(/&(amp|lt|gt|quot|#39);/g, entity => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" })[entity]);
}

async function readData() {
  const names = ["config.js", "photo-library.js", "index.html"];
  const [configText, libraryText, html] = await Promise.all(names.map(name => fsp.readFile(path.join(root, name), "utf8")));
  const context = vm.createContext({ window: {} });
  vm.runInContext(libraryText, context, { timeout: 500 });
  vm.runInContext(configText, context, { timeout: 500 });
  const settings = JSON.parse(JSON.stringify(context.window.MEMORIES));
  const photos = settings.photos.map((photo, index) => ({ ...photo, id: photoId(photo, index) }));
  delete settings.photos;
  const heroSection = html.match(/<figure class="hero-photo">([\s\S]*?)<\/figure>/)?.[1] || "";
  const hero = {
    src: heroSection.match(/<img[^>]*src="([^"]+)"/)?.[1] || "",
    caption: decodeHtml(heroSection.match(/<figcaption><span>([\s\S]*?)<\/span>/)?.[1] || ""),
  };
  return {
    config: settings, photos, hero, html,
    revision: crypto.createHash("sha256").update(configText + "\0" + libraryText + "\0" + html).digest("hex"),
  };
}

function libraryText(photos) {
  return `// 相册清单，由本地管理台维护。\nwindow.PHOTO_LIBRARY = ${JSON.stringify(photos, null, 2)};\n`;
}

function configText(settings) {
  const content = JSON.stringify({ ...settings, photos: "__PHOTO_LIBRARY__" }, null, 2)
    .replace('"photos": "__PHOTO_LIBRARY__"', '"photos": window.PHOTO_LIBRARY');
  return `// 网站内容，由本地管理台维护。\nwindow.MEMORIES = ${content};\n`;
}

function versionHtml(html) {
  const version = Date.now().toString(36);
  return html.replace(/(src|href)="\.\/(app\.js|config\.js|photo-library\.js|style\.css)(?:\?[^"]*)?"/g,
    (_, attribute, filename) => `${attribute}="./${filename}?v=${version}"`);
}

async function saveFiles(changes) {
  const originals = new Map();
  const temporaryFiles = [];
  try {
    for (const [filename, contents] of Object.entries(changes)) {
      const target = path.join(root, filename);
      originals.set(target, await fsp.readFile(target));
      const temporary = target + "." + crypto.randomUUID() + ".tmp";
      await fsp.writeFile(temporary, contents, "utf8");
      temporaryFiles.push([temporary, target]);
    }
    for (const [temporary, target] of temporaryFiles) await fsp.rename(temporary, target);
  } catch (error) {
    for (const [target, bytes] of originals) await fsp.writeFile(target, bytes);
    throw error;
  } finally {
    for (const [temporary] of temporaryFiles) await fsp.rm(temporary, { force: true }).catch(() => {});
  }
}

async function mutate(request, action, duplicatePhotoId) {
  const task = mutationQueue.then(async () => {
    if (publishing.status === "publishing") fail("正在发布，请等发布结束后保存", 409);
    const data = await readData();
    if (duplicatePhotoId && data.photos.some(photo => photo.id === duplicatePhotoId)) return;
    const expectedRevision = request.headers["if-match"]?.replace(/^"|"$/g, "");
    if (expectedRevision !== data.revision) fail("页面数据已更新，请点击刷新后再保存", 409);
    await action(data);
  });
  mutationQueue = task.catch(() => {});
  await task;
}

async function originalFile(photo) {
  const uploadId = photo.src.match(/^\.\/images\/uploads\/([a-f0-9-]+)(?:-original)?\./)?.[1];
  if (uploadId) {
    const stored = path.join(work, "originals", uploadId);
    if (fs.existsSync(stored)) return { path: stored, extension: path.extname(photo.originalSource || photo.source || "") || ".jpg" };
  }
  const relative = photo.originalSource || photo.source;
  if (typeof relative === "string") {
    const photoRoot = path.resolve(process.env.MEMORIES_PHOTO_ROOT || "E:\\照片");
    const candidate = path.resolve(photoRoot, relative);
    if (candidate.startsWith(photoRoot + path.sep)) {
      try {
        const resolved = await fsp.realpath(candidate);
        if (resolved.startsWith(photoRoot + path.sep) && (await fsp.stat(resolved)).isFile()) return { path: resolved, extension: path.extname(resolved) };
      } catch {}
    }
  }
  if (photo.fullResolution && fs.existsSync(imagePath(photo.src))) return { path: imagePath(photo.src), extension: path.extname(photo.src) };
  return null;
}

async function publicState() {
  const data = await readData();
  const status = await run("git", ["status", "--porcelain", "--", ...sitePaths]);
  const photos = await Promise.all(data.photos.map(async photo => ({
    ...photo,
    previewUrl: "/media/" + (photo.thumbnail || photo.src).slice(2),
    imageUrl: "/media/" + photo.src.slice(2),
    originalAvailable: Boolean(await originalFile(photo)),
  })));
  return { config: data.config, photos, hero: data.hero, revision: data.revision, csrf, dirty: Boolean(status.output), publishing };
}

async function jsonBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 4 * 1024 * 1024) fail("内容体积过大", 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { fail("保存内容的格式无效"); }
}

function json(response, value, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...(value.revision ? { ETag: `"${value.revision}"` } : {}) });
  response.end(JSON.stringify(value));
}

function text(value, name, required = false) {
  if (typeof value !== "string" || (required && !value.trim())) fail(`请填写${name}`);
  return value.trim();
}

function validDate(value, required = false) {
  if (!value && !required) return "";
  const timestamp = typeof value === "string" ? Date.parse(value + "T00:00:00Z") : NaN;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) fail("日期格式应为有效的年、月、日");
  return value;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function heroHtml(html, photo, caption) {
  return html.replace(/(<figure class="hero-photo">)([\s\S]*?)(<\/figure>)/, (_, start, content, end) => {
    const image = `<img src="${escapeHtml(photo.src)}" alt="${escapeHtml(caption)}" width="${photo.width || 1200}" height="${photo.height || 800}" fetchpriority="high">`;
    return start + content.replace(/<img[^>]*>/, image).replace(/<figcaption>[\s\S]*?<\/figcaption>/, `<figcaption><span>${escapeHtml(caption)}</span></figcaption>`) + end;
  });
}

async function upload(request) {
  const temporary = path.join(work, "staging", crypto.randomUUID());
  await fsp.mkdir(path.dirname(temporary), { recursive: true });
  let filename = "";
  let options = {};
  let fileTask;
  try {
    await new Promise((resolve, reject) => {
      const parser = Busboy({ headers: request.headers, limits: { files: 1, fields: 1, fieldSize: 65536, fileSize: 512 * 1024 * 1024 } });
      parser.on("field", (name, value) => {
        if (name === "options") {
          try { options = JSON.parse(value); } catch { reject(new Error("上传参数无效")); }
        }
      });
      parser.on("file", (name, stream, information) => {
        filename = path.basename(information.filename || "photo.jpg");
        stream.on("limit", () => reject(new Error("单张上传文件超过 512 MB")));
        fileTask = pipeline(stream, fs.createWriteStream(temporary));
        fileTask.catch(reject);
      });
      parser.on("error", reject);
      const aborted = () => parser.destroy(new Error("上传已中断，可以重新上传这张照片"));
      request.once("aborted", aborted);
      parser.once("close", () => request.off("aborted", aborted));
      parser.on("filesLimit", () => reject(new Error("请使用管理台的批量上传队列逐张保存")));
      parser.on("close", async () => { try { await fileTask; resolve(); } catch (error) { reject(error); } });
      request.pipe(parser);
    });
    if (!filename || !fileTask) fail("请选择要上传的照片");
    const uploadId = options.uploadId || crypto.randomUUID();
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(uploadId)) fail("上传标识无效，请重新选择照片");
    await mutate(request, async data => {
      const album = text(options.album || "", "相册名称");
      const caption = text(options.caption || path.basename(filename, path.extname(filename)), "照片配文", true);
      const metadata = await sharp(temporary).metadata().catch(() => fail("这份文件无法读取为图片，请重新选择照片"));
      const rotate = [5, 6, 7, 8].includes(metadata.orientation);
      const width = rotate ? metadata.height : metadata.width;
      const height = rotate ? metadata.width : metadata.height;
      const original = options.mode === "original" || (options.mode !== "optimized" && (height > width * 3 || /聊天|相识到相恋/.test(album)));
      if (original && (await fsp.stat(temporary)).size > 100 * 1024 * 1024) fail("原图超过 GitHub 的 100 MB 单文件限制，请选择网页优化模式");
      const id = uploadId;
      const extension = originalExtensions[metadata.format];
      if (original && !extension) fail("原图展示支持 JPG、PNG、WebP、GIF 和 AVIF，请为这张照片选择网页优化");
      const imageName = id + (original ? extension : ".webp");
      const src = `./images/uploads/${imageName}`;
      const thumbnail = original ? src : `./images/uploads/${id}-thumb.webp`;
      const originalsDirectory = path.join(work, "originals");
      await fsp.mkdir(path.join(root, "images", "uploads"), { recursive: true });
      await fsp.mkdir(originalsDirectory, { recursive: true });
      const created = [imagePath(src), path.join(originalsDirectory, id)];
      try {
        await fsp.copyFile(temporary, path.join(originalsDirectory, id));
        let dimensions = { width, height };
        if (original) await fsp.copyFile(temporary, imagePath(src));
        else {
          const processed = await sharp(temporary).rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).webp({ quality: 84 }).toBuffer({ resolveWithObject: true });
          await fsp.writeFile(imagePath(src), processed.data);
          dimensions = processed.info;
          created.push(imagePath(thumbnail));
          await sharp(processed.data).resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toFile(imagePath(thumbnail));
        }
        data.photos.push({ id, src, thumbnail, width: dimensions.width, height: dimensions.height, caption, album: album || "点滴回忆", source: album ? `${album}/${filename}` : filename, fullResolution: original });
        await saveFiles({ "photo-library.js": libraryText(data.photos), "index.html": versionHtml(data.html) });
      } catch (error) {
        for (const item of created) await fsp.rm(item, { force: true }).catch(() => {});
        throw error;
      }
    }, uploadId);
  } finally {
    if (fileTask) await fileTask.catch(() => {});
    await fsp.rm(temporary, { force: true }).catch(() => {});
  }
}

async function changePhotos(request, body) {
  const created = [];
  try {
    await mutate(request, async data => {
      if (!Array.isArray(body.ids) || !body.ids.length) fail("请先选择照片");
      const selected = new Set(body.ids);
      const matches = data.photos.filter(photo => selected.has(photo.id));
      if (matches.length !== selected.size) fail("有照片已经更新，请刷新后重试", 409);
      for (const photo of matches) {
        if (body.caption !== undefined) photo.caption = text(body.caption, "配文", true);
        if (body.date !== undefined) photo.date = validDate(body.date);
        if (body.album !== undefined) {
          const album = text(body.album, "相册名称");
          const originalSource = photo.originalSource || photo.source || photo.caption;
          photo.originalSource = originalSource;
          photo.album = album || "点滴回忆";
          const filename = originalSource.split(/[\\/]/).pop();
          photo.source = album ? `${album}/${filename}` : filename;
        }
        if (body.fullResolution === true && !photo.fullResolution) {
          const original = await originalFile(photo);
          if (!original) fail("这张照片的原图暂未找到，可以重新上传原图");
          if ((await fsp.stat(original.path)).size > 100 * 1024 * 1024) fail("原图超过 GitHub 的 100 MB 单文件限制");
          const metadata = await sharp(original.path).metadata();
          const extension = originalExtensions[metadata.format];
          if (!extension) fail("这张原图的格式适合网页优化展示，可下载原文件查看");
          const destination = `./images/uploads/${crypto.randomUUID()}-original${extension}`;
          await fsp.mkdir(path.join(root, "images", "uploads"), { recursive: true });
          await fsp.copyFile(original.path, imagePath(destination));
          created.push(imagePath(destination));
          photo.src = destination;
          photo.thumbnail = destination;
          const rotated = [5, 6, 7, 8].includes(metadata.orientation);
          photo.width = rotated ? metadata.height : metadata.width;
          photo.height = rotated ? metadata.width : metadata.height;
        }
        if (body.fullResolution !== undefined) photo.fullResolution = Boolean(body.fullResolution);
      }
      if (body.remove) data.photos = data.photos.filter(photo => !selected.has(photo.id));
      await saveFiles({ "photo-library.js": libraryText(data.photos), "index.html": versionHtml(data.html) });
    });
  } catch (error) {
    for (const filename of created) await fsp.rm(filename, { force: true }).catch(() => {});
    throw error;
  }
}

async function changeConfig(request, body) {
  await mutate(request, async data => {
    const values = body.values || {};
    for (const name of ["title", "personOne", "personTwo", "introduction"]) {
      if (values[name] !== undefined) data.config[name] = text(values[name], name === "title" ? "网站标题" : "内容", name !== "introduction");
    }
    if (values.startDate !== undefined) data.config.startDate = validDate(values.startDate, true);
    if (values.stories !== undefined) {
      if (!Array.isArray(values.stories)) fail("时间轴格式无效");
      data.config.stories = values.stories.map(story => ({ date: validDate(story.date, true), title: text(story.title, "小事标题", true), text: text(story.text || "", "小事内容"), status: text(story.status || "", "状态") })).sort((first, second) => first.date.localeCompare(second.date));
    }
    if (values.wishes !== undefined) {
      if (!Array.isArray(values.wishes)) fail("心愿格式无效");
      data.config.wishes = values.wishes.map(wish => ({ text: text(wish.text, "心愿内容", true), done: Boolean(wish.done) }));
    }
    let html = data.html;
    if (body.heroId) {
      const photo = data.photos.find(item => item.id === body.heroId);
      if (!photo) fail("请重新选择首页照片");
      html = heroHtml(html, photo, text(body.heroCaption || photo.caption, "首页配文", true));
    } else if (body.heroCaption !== undefined) {
      const caption = escapeHtml(text(body.heroCaption, "首页配文", true));
      html = html.replace(/(<figure class="hero-photo">[\s\S]*?<figcaption><span>)[\s\S]*?(<\/span>)/, (_, before, after) => before + caption + after);
    }
    await saveFiles({ "config.js": configText(data.config), "index.html": versionHtml(html) });
  });
}

async function downloadFile(photo) {
  const original = await originalFile(photo);
  return original || { path: imagePath(photo.src), extension: path.extname(photo.src) };
}

function attachment(filename) {
  return `attachment; filename="memories${path.extname(filename).replace(/[^a-z0-9.]/gi, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function streamArchive(response, collection) {
  const files = await Promise.all(collection.map(async photo => ({ photo, file: await downloadFile(photo) })));
  await Promise.all(files.map(item => fsp.access(item.file.path)));
  response.writeHead(200, { "Content-Type": "application/zip", "Content-Disposition": attachment("我们的回忆.zip"), "Cache-Control": "no-store" });
  const zip = new Zip((error, bytes, final) => {
    if (error) { response.destroy(error); return; }
    response.write(bytes);
    if (final) response.end();
  });
  const filenames = new Set();
  for (const { photo, file } of files) {
    if (response.destroyed) break;
    const folder = photo.source && /[\\/]/.test(photo.source) ? safeName(photo.album) + "/" : "";
    const base = safeName(photo.caption);
    let name = folder + base + file.extension;
    let suffix = 2;
    while (filenames.has(name)) name = `${folder}${base} (${suffix++})${file.extension}`;
    filenames.add(name);
    const entry = new ZipPassThrough(name);
    zip.add(entry);
    for await (const chunk of fs.createReadStream(file.path)) {
      if (response.destroyed) { zip.terminate(); return; }
      entry.push(chunk, false);
      if (response.writableNeedDrain) {
        await new Promise(resolve => {
          const finished = () => { response.off("drain", finished); response.off("close", finished); resolve(); };
          response.once("drain", finished);
          response.once("close", finished);
        });
      }
    }
    entry.push(new Uint8Array(), true);
  }
  zip.end();
}

async function gitArguments() {
  const args = ["-c", "credential.helper=", "-c", "credential.helper=!node manager/server.cjs --git-credential"];
  if (process.platform === "win32") {
    const proxy = await run("reg.exe", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"], { allowFailure: true });
    if (/ProxyEnable\s+REG_DWORD\s+0x1/.test(proxy.output)) {
      const server = proxy.output.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/)?.[1].trim();
      const httpsProxy = server?.match(/(?:^|;)https=([^;]+)/)?.[1] || server?.match(/(?:^|;)http=([^;]+)/)?.[1] || server;
      if (httpsProxy && !httpsProxy.includes("=")) args.push("-c", `http.proxy=${/^\w+:\/\//.test(httpsProxy) ? httpsProxy : "http://" + httpsProxy}`);
    }
  }
  return args;
}

async function publish() {
  try {
    const args = await gitArguments();
    publishing.message = "正在检查 GitHub 版本";
    await run("git", [...args, "fetch", "origin", "main"]);
    const behind = await run("git", ["rev-list", "--count", "HEAD..origin/main"]);
    if (Number(behind.output) > 0) fail("GitHub 上有新的提交，请先同步项目再发布本地草稿");
    publishing.message = "正在保存网站版本";
    await run("git", ["add", "--", ...sitePaths]);
    const staged = await run("git", ["diff", "--cached", "--quiet", "--", ...sitePaths], { allowFailure: true });
    if (staged.code === 1) await run("git", ["commit", "--only", "-m", "Update memories from local manager", "--", ...sitePaths]);
    publishing.message = "正在上传网站与照片";
    for (let attempt = 0; ; attempt += 1) {
      try { await run("git", [...args, "push", "origin", "HEAD:main"]); break; }
      catch (error) { if (attempt >= 2) throw error; await new Promise(resolve => setTimeout(resolve, 1500)); }
    }
    const commit = (await run("git", ["rev-parse", "HEAD"])).output;
    const remote = (await run("git", ["remote", "get-url", "origin"])).output;
    const repository = remote.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1];
    if (!repository) fail("无法识别当前 GitHub 仓库地址");
    publishing.message = "GitHub Pages 正在构建网站";
    const started = Date.now();
    while (Date.now() - started < 600000) {
      const result = await run(gh, ["api", `repos/${repository}/pages/builds/latest`]);
      const build = JSON.parse(result.output);
      if (build.commit === commit && build.status === "built") {
        const page = JSON.parse((await run(gh, ["api", `repos/${repository}/pages`])).output);
        publishing = { status: "complete", message: "网站已发布", url: page.html_url, commit };
        return;
      }
      if (build.commit === commit && build.status === "errored") fail(build.error?.message || "GitHub Pages 构建失败");
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    fail("上传已完成，GitHub Pages 构建仍在进行，可稍后再次检查发布");
  } catch (error) {
    publishing = { status: "failed", message: error.message };
  }
}

const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif" };

async function sendFile(response, filename, disposition) {
  const info = await fsp.stat(filename);
  response.writeHead(200, { "Content-Type": types[path.extname(filename)] || "application/octet-stream", "Content-Length": info.size, "Cache-Control": "no-store", ...(disposition ? { "Content-Disposition": disposition } : {}) });
  await pipeline(fs.createReadStream(filename), response);
}

async function handle(request, response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "same-origin");
  if (!["127.0.0.1:" + port, "localhost:" + port].includes(request.headers.host)) fail("请使用本机管理台地址", 403);
  const url = new URL(request.url, address);
  if (!["GET", "HEAD"].includes(request.method)) {
    if (request.headers["x-manager-token"] !== csrf || (request.headers.origin && ![address, `http://localhost:${port}`].includes(request.headers.origin))) fail("请从本机管理台执行保存", 403);
  }
  if (url.pathname === "/api/health") return json(response, { app: "memories-local-manager", root });
  if (url.pathname === "/api/state" && request.method === "GET") {
    await mutationQueue;
    return json(response, await publicState());
  }
  if (url.pathname === "/api/publish-status") return json(response, publishing);
  if (url.pathname === "/api/photos" && request.method === "POST") {
    await upload(request);
    return json(response, await publicState());
  }
  if (url.pathname === "/api/photos" && request.method === "PATCH") {
    await changePhotos(request, await jsonBody(request));
    return json(response, await publicState());
  }
  if (url.pathname === "/api/config" && request.method === "PATCH") {
    await changeConfig(request, await jsonBody(request));
    return json(response, await publicState());
  }
  if (url.pathname === "/api/album" && request.method === "PATCH") {
    const body = await jsonBody(request);
    await mutate(request, async data => {
      const name = text(body.name, "相册名称", true);
      const newName = text(body.newName, "新相册名称", true);
      const matches = data.photos.filter(photo => photo.album === name);
      if (!matches.length) fail("相册已更新，请刷新后重试", 409);
      for (const photo of matches) photo.album = newName;
      await saveFiles({ "photo-library.js": libraryText(data.photos), "index.html": versionHtml(data.html) });
    });
    return json(response, await publicState());
  }
  if (url.pathname === "/api/publish" && request.method === "POST") {
    await mutationQueue;
    if (publishing.status === "publishing") fail("发布正在进行", 409);
    publishing = { status: "publishing", message: "正在准备发布" };
    void publish();
    return json(response, publishing, 202);
  }
  if (url.pathname === "/api/download-ticket" && request.method === "POST") {
    const body = await jsonBody(request);
    const data = await readData();
    const ids = new Set(body.ids || []);
    const collection = data.photos.filter(photo => ids.has(photo.id));
    if (!collection.length) fail("请先选择照片");
    for (const [key, value] of tickets) if (value.expires < Date.now()) tickets.delete(key);
    const ticket = crypto.randomUUID();
    tickets.set(ticket, { collection, expires: Date.now() + 300000 });
    return json(response, { url: `/api/download/archive?ticket=${ticket}` });
  }
  if (url.pathname === "/api/download/archive") {
    const ticket = tickets.get(url.searchParams.get("ticket"));
    tickets.delete(url.searchParams.get("ticket"));
    if (!ticket || ticket.expires < Date.now()) fail("下载链接已过期，请重新点击下载", 410);
    return streamArchive(response, ticket.collection);
  }
  if (url.pathname.startsWith("/api/download/")) {
    const id = url.pathname.split("/").pop();
    const photo = (await readData()).photos.find(item => item.id === id);
    if (!photo) fail("照片已更新，请刷新后重试", 404);
    const file = await downloadFile(photo);
    return sendFile(response, file.path, attachment(safeName(photo.caption) + file.extension));
  }
  if (url.pathname.startsWith("/media/")) return sendFile(response, imagePath("./" + decodeURIComponent(url.pathname.slice(7))));
  if (url.pathname === "/preview") { response.writeHead(302, { Location: "/preview/" }); return response.end(); }
  if (url.pathname.startsWith("/preview/")) {
    const name = decodeURIComponent(url.pathname.slice(9)) || "index.html";
    if (name.startsWith("images/")) return sendFile(response, imagePath("./" + name));
    if (!["index.html", "style.css", "app.js", "config.js", "photo-library.js"].includes(name)) fail("文件不存在", 404);
    return sendFile(response, path.join(root, name));
  }
  const staticFiles = { "/": "index.html", "/manager.js": "manager.js", "/manager.css": "manager.css" };
  if (staticFiles[url.pathname]) return sendFile(response, path.join(__dirname, staticFiles[url.pathname]));
  fail("页面不存在", 404);
}

async function main() {
  await fsp.mkdir(work, { recursive: true });
  const existing = await fetch(address + "/api/health", { signal: AbortSignal.timeout(600) }).then(response => response.json()).catch(() => null);
  if (existing?.app === "memories-local-manager" && path.resolve(existing.root) === root) {
    console.log(`回忆管理台 ${address}`);
    if (process.argv.includes("--open") && process.platform === "win32") execFile("cmd.exe", ["/c", "start", "", address], { windowsHide: true });
    return;
  }
  const server = http.createServer((request, response) => {
    handle(request, response).catch(error => {
      if (response.headersSent) response.destroy(error);
      else json(response, { error: error.code === "ENOENT" ? "文件暂未找到，请刷新后重试" : error.message }, error.status || 500);
    });
  });
  server.requestTimeout = 0;
  server.on("error", error => { console.error(error.code === "EADDRINUSE" ? `管理台地址已被占用，请访问 ${address}` : error.message); process.exitCode = 1; });
  server.listen(port, "127.0.0.1", () => {
    console.log(`回忆管理台 ${address}`);
    if (process.argv.includes("--open") && process.platform === "win32") execFile("cmd.exe", ["/c", "start", "", address], { windowsHide: true });
  });
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
