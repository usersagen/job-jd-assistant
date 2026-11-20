// 历史会话视图：列出按岗位保存的会话，点击可载入对话。
import { listSessions, clearSession } from '../../shared/session.js';
import { openHistorySession } from './chat.js';

function formatTime(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? `${pad(date.getHours())}:${pad(date.getMinutes())}`
    : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function buildHistoryView() {
  const view = document.createElement('div');
  view.className = 'view view-history';
  view.hidden = true;

  const list = document.createElement('div');
  list.className = 'history-list';

  const empty = document.createElement('div');
  empty.className = 'history-empty';
  empty.textContent = '暂无历史会话。发起一次对话后，会按岗位保存在这里。';
  empty.hidden = true;

  view.append(empty, list);
  return { view, list, empty };
}

export async function renderHistory(ui) {
  ui.list.textContent = '';
  ui.empty.hidden = true;
  const sessions = await listSessions();
  const items = (sessions || []).filter((item) => item.count > 0);
  ui.empty.hidden = items.length > 0;
  if (!items.length) return;

  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'history-item';

    const main = document.createElement('button');
    main.className = 'history-main';
    main.type = 'button';
    main.title = item.url || item.title || '打开会话';
    const title = document.createElement('div');
    title.className = 'history-title';
    title.textContent = item.title || '未识别到岗位名称';
    const meta = document.createElement('div');
    meta.className = 'history-meta';
    meta.textContent = [item.company, formatTime(item.updatedAt), `${item.count} 条消息`]
      .filter(Boolean)
      .join(' · ');
    main.append(title, meta);
    main.addEventListener('click', () => {
      openHistorySession(item.key);
    });

    const del = document.createElement('button');
    del.className = 'history-del';
    del.type = 'button';
    del.title = '删除该会话';
    del.textContent = '×';
    del.addEventListener('click', async () => {
      await clearSession(item.key);
      renderHistory(ui);
    });

    row.append(main, del);
    ui.list.appendChild(row);
  });
}
