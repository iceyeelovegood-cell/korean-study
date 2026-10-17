import { dashboard, dateKey, emptyData, mergePack, reviewWord, setWordStatus, validateBackup, wordKey } from "./core.mjs";

const $ = id => document.getElementById(id);
const state = { data: emptyData(), mode: "review", queues: { review: [], new: [] }, totals: { review: 0, new: 0 }, completed: { review: 0, new: 0 }, busy: false };

function showError(error) {
  $("toast").textContent = error.message || String(error);
  $("toast").hidden = false;
  setTimeout(() => { $("toast").hidden = true; }, 6000);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("korean-study-mobile", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("app");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let database;

function readData() {
  return new Promise((resolve, reject) => {
    const request = database.transaction("app", "readonly").objectStore("app").get("study");
    request.onsuccess = () => resolve(request.result || emptyData());
    request.onerror = () => reject(request.error);
  });
}

function saveData(data) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("app", "readwrite");
    transaction.objectStore("app").put(data, "study");
    transaction.oncomplete = () => { state.data = data; resolve(); };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function showView(name) {
  document.querySelectorAll(".view").forEach(item => item.classList.toggle("active", item.id === `view-${name}`));
  document.querySelectorAll("[data-view]").forEach(item => item.classList.toggle("active", item.dataset.view === name));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetQueues() {
  const today = dashboard(state.data, dateKey());
  state.queues.review = today.due.map(wordKey);
  state.queues.new = today.newWords.map(wordKey);
  state.totals.review = state.queues.review.length;
  state.totals.new = state.queues.new.length;
  state.completed.review = 0;
  state.completed.new = 0;
}

function renderToday() {
  const today = dashboard(state.data, dateKey());
  $("dueCount").textContent = today.due.length;
  $("newCount").textContent = today.newWords.length;
  $("newUsed").textContent = `${today.newUsed}/20`;
  $("studyModeLabel").textContent = state.mode === "review" ? "复习单词" : "学习新词";
  $("studyProgress").textContent = `${state.completed[state.mode]} / ${state.totals[state.mode]}`;
  const total = state.totals[state.mode];
  $("progressFill").style.width = `${total ? Math.min(100, state.completed[state.mode] / total * 100) : 100}%`;
  const key = state.queues[state.mode][0];
  const word = state.data.words.find(item => wordKey(item) === key);
  $("studyCard").hidden = !word;
  $("studyEmpty").hidden = Boolean(word);
  if (!word) {
    $("emptyTitle").textContent = today.total ? "这一组完成了" : "词库还是空的";
    $("emptyMessage").textContent = today.total
      ? state.mode === "review" ? "可以接着学习今天的新词。" : "可以去看语法笔记。"
      : "先到数据页导入学习包。";
    return;
  }
  const source = word.sources[0];
  $("cardSource").textContent = source ? `${source.lesson} · 第 ${source.page} 页` : "单词";
  $("cardWord").textContent = word.ko;
  $("cardAnswer").textContent = word.meaning;
  $("cardAnswer").hidden = true;
  $("revealButton").hidden = false;
  $("ratingActions").hidden = true;
}

async function rate(rating) {
  if (state.busy || $("ratingActions").hidden) return;
  const queue = state.queues[state.mode];
  const key = queue[0];
  if (!key) return;
  state.busy = true;
  document.querySelectorAll("[data-rating]").forEach(button => { button.disabled = true; });
  try {
    await saveData(reviewWord(state.data, key, rating, dateKey()));
    queue.shift();
    if (rating === "forgot") queue.push(key);
    else state.completed[state.mode] += 1;
    renderToday();
    renderWords();
  } catch (error) { showError(error); }
  finally {
    state.busy = false;
    document.querySelectorAll("[data-rating]").forEach(button => { button.disabled = false; });
  }
}

function renderGrammar() {
  const search = $("grammarSearch").value.trim().toLocaleLowerCase();
  const list = $("grammarList");
  list.replaceChildren();
  const items = [...state.data.grammar].reverse().filter(item =>
    `${item.title} ${item.description} ${item.lesson}`.toLocaleLowerCase().includes(search));
  if (!items.length) return emptyList(list, "暂无匹配的语法。");
  const fragment = document.createDocumentFragment();
  items.forEach(item => {
    const details = document.createElement("details");
    details.className = "grammar-item";
    const summary = document.createElement("summary");
    const heading = document.createElement("div");
    const title = document.createElement("h2");
    title.textContent = item.title;
    const lesson = document.createElement("small");
    lesson.textContent = item.lesson;
    heading.append(title, lesson);
    const marker = document.createElement("span");
    marker.className = "marker";
    marker.textContent = "+";
    details.addEventListener("toggle", () => { marker.textContent = details.open ? "−" : "+"; });
    summary.append(heading, marker);
    const body = document.createElement("div");
    body.className = "grammar-detail";
    const description = document.createElement("p");
    description.textContent = item.description || "课件未提供简要说明。";
    const source = document.createElement("small");
    source.textContent = `${item.filename || item.lesson} · 第 ${item.page} 页`;
    body.append(description, source);
    details.append(summary, body);
    fragment.append(details);
  });
  list.append(fragment);
}

function emptyList(parent, message) {
  const text = document.createElement("p");
  text.className = "empty-list";
  text.textContent = message;
  parent.append(text);
}

async function changeStatus(key, status) {
  try {
    await saveData(setWordStatus(state.data, key, status, dateKey()));
    resetQueues();
    renderToday();
    renderWords();
  } catch (error) { showError(error); }
}

function renderWords() {
  const search = $("wordSearch").value.trim().toLocaleLowerCase();
  const list = $("wordList");
  list.replaceChildren();
  const words = [...state.data.words].reverse().filter(item =>
    `${item.ko} ${item.meaning}`.toLocaleLowerCase().includes(search));
  if (!words.length) return emptyList(list, "暂无匹配的单词。");
  const fragment = document.createDocumentFragment();
  const labels = { new: "待学", review: "复习中", known: "已会" };
  words.forEach(word => {
    const row = document.createElement("div");
    row.className = "word-item";
    const term = document.createElement("div");
    term.className = "term";
    const ko = document.createElement("strong");
    ko.textContent = word.ko;
    const source = document.createElement("small");
    const first = word.sources[0];
    source.textContent = first ? `${first.lesson} · 第 ${first.page} 页` : "";
    term.append(ko, source);
    const meaning = document.createElement("span");
    meaning.className = "meaning";
    meaning.textContent = word.meaning;
    const status = document.createElement("span");
    status.className = `state ${word.status === "new" ? "new" : ""}`;
    status.textContent = labels[word.status] || word.status;
    const button = document.createElement("button");
    button.textContent = word.status === "known" ? "重新学习" : "标记已会";
    button.addEventListener("click", () => changeStatus(wordKey(word), word.status === "known" ? "new" : "known"));
    row.append(term, meaning, status, button);
    fragment.append(row);
  });
  list.append(fragment);
}

function renderData() {
  $("storedWords").textContent = state.data.words.length;
  $("storedGrammar").textContent = state.data.grammar.length;
  $("lastImport").textContent = state.data.lastImport
    ? `最近导入：${new Date(state.data.lastImport).toLocaleDateString("zh-CN")}` : "尚未导入";
}

async function loadJsonFile(file) {
  if (!file || file.size > 10 * 1024 * 1024) throw new Error("请选择小于 10 MB 的 JSON 文件");
  try { return JSON.parse(await file.text()); }
  catch { throw new Error("文件不是有效 JSON"); }
}

async function importPack(file) {
  try {
    const pack = await loadJsonFile(file);
    const result = mergePack(state.data, pack);
    await saveData(result.data);
    resetQueues();
    renderAll();
    $("dataNotice").textContent = `新增 ${result.addedWords} 个单词、${result.addedGrammar} 条语法。已有学习进度已保留。`;
  } catch (error) { showError(error); }
}

function downloadJson(filename, payload) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function restoreBackup(file) {
  try {
    const data = validateBackup(await loadJsonFile(file));
    if (!window.confirm("恢复备份会替换这台设备当前的学习记录，确定继续吗？")) return;
    await saveData(data);
    resetQueues();
    renderAll();
    $("dataNotice").textContent = "学习进度已恢复。";
  } catch (error) { showError(error); }
}

function renderAll() {
  renderToday();
  renderGrammar();
  renderWords();
  renderData();
}

async function initialize() {
  database = await openDatabase();
  state.data = await readData();
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  resetQueues();
  $("todayDate").textContent = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric", weekday: "long" }).format(new Date());
  renderAll();
  document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => showView(button.dataset.view)));
  document.querySelectorAll("[data-mode]").forEach(button => button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    document.querySelectorAll("[data-mode]").forEach(item => item.classList.toggle("selected", item.dataset.mode === state.mode));
    renderToday();
  }));
  $("revealButton").addEventListener("click", () => {
    $("cardAnswer").hidden = false;
    $("revealButton").hidden = true;
    $("ratingActions").hidden = false;
  });
  document.querySelectorAll("[data-rating]").forEach(button => button.addEventListener("click", () => rate(button.dataset.rating)));
  $("grammarSearch").addEventListener("input", renderGrammar);
  $("wordSearch").addEventListener("input", renderWords);
  $("packFile").addEventListener("change", event => { importPack(event.target.files[0]); event.target.value = ""; });
  $("backupFile").addEventListener("change", event => { restoreBackup(event.target.files[0]); event.target.value = ""; });
  $("exportBackup").addEventListener("click", () => {
    downloadJson(`korean-study-backup-${dateKey()}.json`, {
      format: "korean-study-backup", version: 1, saved_at: new Date().toISOString(), data: state.data,
    });
    $("lastBackup").textContent = `已导出：${dateKey()}`;
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(showError);
}

initialize().catch(showError);
