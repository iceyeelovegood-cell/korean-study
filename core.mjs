export const INTERVALS = [1, 3, 7, 14, 30, 60];

export function emptyData() {
  return { version: 1, words: [], grammar: [], reviews: [], lastImport: null };
}

export function dateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addDays(day, count) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + count)).toISOString().slice(0, 10);
}

export function wordKey(word) {
  return `${word.ko.trim()}\u0000${word.meaning.trim()}`;
}

function grammarKey(item) {
  return `${item.lesson.trim()}\u0000${item.title.trim()}\u0000${item.page}`;
}

function validText(value, max) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function validDay(value) {
  return value === null || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export function validatePack(pack) {
  if (!pack || pack.format !== "korean-study-pack" || pack.version !== 1 ||
      !Array.isArray(pack.words) || !Array.isArray(pack.grammar) ||
      pack.words.length > 20000 || pack.grammar.length > 5000) {
    throw new Error("这不是可用的手机学习包");
  }
  for (const word of pack.words) {
    if (!word || !validText(word.ko, 100) || !validText(word.meaning, 200) ||
        !["new", "known", "review"].includes(word.status) ||
        !Number.isInteger(word.stage) || word.stage < 0 || word.stage > 5 ||
        !validDay(word.due_date) || !Array.isArray(word.sources)) {
      throw new Error("学习包中有无效单词");
    }
  }
  for (const item of pack.grammar) {
    if (!item || !validText(item.title, 150) || !validText(item.lesson, 100) ||
        !Number.isInteger(item.page) || item.page < 1 ||
        typeof item.description !== "string" || item.description.length > 1000) {
      throw new Error("学习包中有无效语法");
    }
  }
  return pack;
}

function mergeSources(first, second) {
  const merged = new Map();
  for (const source of [...first, ...second]) {
    if (!source || typeof source.lesson !== "string" || typeof source.filename !== "string" ||
        !Number.isInteger(source.page) || source.page < 1) continue;
    merged.set(`${source.filename}\u0000${source.page}`, source);
  }
  return [...merged.values()];
}

export function mergePack(data, rawPack) {
  const pack = validatePack(rawPack);
  const words = new Map(data.words.map(word => [wordKey(word), word]));
  let addedWords = 0;
  for (const item of pack.words) {
    const key = wordKey(item);
    const existing = words.get(key);
    if (existing) {
      words.set(key, { ...existing, sources: mergeSources(existing.sources || [], item.sources) });
    } else {
      words.set(key, {
        ko: item.ko.trim(), meaning: item.meaning.trim(), status: item.status,
        stage: item.stage, due_date: item.due_date,
        created_at: item.created_at || pack.generated_at || "",
        sources: mergeSources([], item.sources),
      });
      addedWords += 1;
    }
  }
  const grammar = new Map(data.grammar.map(item => [grammarKey(item), item]));
  let addedGrammar = 0;
  for (const item of pack.grammar) {
    const key = grammarKey(item);
    if (!grammar.has(key)) addedGrammar += 1;
    grammar.set(key, {
      title: item.title.trim(), description: item.description, lesson: item.lesson.trim(),
      page: item.page, filename: typeof item.filename === "string" ? item.filename : "",
    });
  }
  return {
    data: { ...data, words: [...words.values()], grammar: [...grammar.values()], lastImport: pack.generated_at || new Date().toISOString() },
    addedWords, addedGrammar,
  };
}

export function dashboard(data, day) {
  const learned = new Set(data.reviews.filter(item => item.day === day && item.wasNew).map(item => item.key));
  const due = data.words.filter(word => ["review", "known"].includes(word.status) && word.due_date && word.due_date <= day)
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || wordKey(a).localeCompare(wordKey(b)));
  const newWords = data.words.filter(word => word.status === "new")
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || wordKey(a).localeCompare(wordKey(b)))
    .slice(0, Math.max(0, 20 - learned.size));
  return { due, newWords, newUsed: learned.size, total: data.words.length };
}

export function reviewWord(data, key, rating, day) {
  if (!["good", "fuzzy", "forgot"].includes(rating)) throw new Error("复习反馈无效");
  const word = data.words.find(item => wordKey(item) === key);
  if (!word) throw new Error("找不到这个单词");
  const wasNew = word.status === "new";
  if (wasNew && dashboard(data, day).newUsed >= 20) throw new Error("今天的 20 个新词已经完成");
  let stage = word.stage;
  let days;
  if (rating === "good") {
    days = INTERVALS[Math.min(stage, INTERVALS.length - 1)];
    stage = Math.min(stage + 1, INTERVALS.length - 1);
  } else if (rating === "fuzzy") {
    days = 1;
    stage = Math.max(0, stage - 1);
  } else {
    days = 0;
    stage = 0;
  }
  const dueDate = addDays(day, days);
  return {
    ...data,
    words: data.words.map(item => wordKey(item) === key ? { ...item, status: "review", stage, due_date: dueDate } : item),
    reviews: [...data.reviews, { key, rating, wasNew, day, nextDue: dueDate, at: new Date().toISOString() }],
  };
}

export function setWordStatus(data, key, status, day) {
  if (!["new", "known"].includes(status)) throw new Error("单词状态无效");
  return {
    ...data,
    words: data.words.map(item => wordKey(item) === key ? {
      ...item, status, stage: status === "known" ? 4 : 0,
      due_date: status === "known" ? addDays(day, 30) : null,
    } : item),
  };
}

export function validateBackup(backup) {
  if (!backup || backup.format !== "korean-study-backup" || backup.version !== 1 ||
      !backup.data || !Array.isArray(backup.data.words) ||
      !Array.isArray(backup.data.grammar) || !Array.isArray(backup.data.reviews)) {
    throw new Error("这不是可用的学习进度备份");
  }
  validatePack({ format: "korean-study-pack", version: 1,
    words: backup.data.words, grammar: backup.data.grammar });
  if (backup.data.reviews.length > 200000 || backup.data.reviews.some(item =>
    !item || typeof item.key !== "string" || !["good", "fuzzy", "forgot"].includes(item.rating) ||
    typeof item.wasNew !== "boolean" || item.day === null || !validDay(item.day))) {
    throw new Error("备份中的复习记录无效");
  }
  return backup.data;
}
