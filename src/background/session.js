// 会话存取：按岗位保存对话，写入 chrome.storage.session（浏览器关闭即清空）。
const PREFIX = 'chat:';
const MAX_MESSAGES = 60;
const MAX_SESSIONS = 40;

const area = () => chrome.storage.session || chrome.storage.local;

function get(key) {
  return new Promise((resolve) => {
    area().get(key, (items) => resolve(items || {}));
  });
}

function set(items) {
  return new Promise((resolve) => {
    area().set(items, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function remove(keys) {
  return new Promise((resolve) => {
    area().remove(keys, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function getAll() {
  return new Promise((resolve) => {
    area().get(null, (items) => resolve(items || {}));
  });
}

export async function readSession(key) {
  const storageKey = PREFIX + key;
  const items = await get(storageKey);
  const record = items[storageKey];
  return record && Array.isArray(record.messages) ? record : null;
}

export async function writeSession(key, record) {
  const storageKey = PREFIX + key;
  await set({
    [storageKey]: {
      ...record,
      messages: (record.messages || []).slice(-MAX_MESSAGES)
    }
  });
  await prune();
}

export function clearSession(key) {
  return remove([PREFIX + key]);
}

// 历史会话目录：只返回元信息，避免一次读回全部正文
export async function listSessions() {
  const all = await getAll();
  return Object.keys(all)
    .filter((key) => key.startsWith(PREFIX))
    .map((key) => {
      const record = all[key] || {};
      return {
        key: key.slice(PREFIX.length),
        title: record.title || '',
        company: record.company || '',
        url: record.url || '',
        updatedAt: record.updatedAt || 0,
        count: Array.isArray(record.messages) ? record.messages.length : 0
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

// 只保留最近的若干会话，避免 session storage 被旧岗位占满
async function prune() {
  const all = await getAll();
  const keys = Object.keys(all).filter((key) => key.startsWith(PREFIX));
  if (keys.length <= MAX_SESSIONS) return;
  keys.sort((a, b) => ((all[a] && all[a].updatedAt) || 0) - ((all[b] && all[b].updatedAt) || 0));
  await remove(keys.slice(0, keys.length - MAX_SESSIONS));
}
