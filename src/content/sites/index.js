// 按域名选择站点适配器：核心提取流程不再关心具体站点。
import boss from './boss.js';
import zhilian from './zhilian.js';
import xmrc from './xmrc.js';
import liepin from './liepin.js';

export function detectAdapter(hostname = location.hostname) {
  if (/(^|\.)zhaopin\.com$/.test(hostname)) return zhilian;
  if (/(^|\.)xmrc\.com\.cn$/.test(hostname)) return xmrc;
  if (/(^|\.)liepin\.com$/.test(hostname)) return liepin;
  return boss;
}

let adapter = null;

export function getAdapter() {
  if (!adapter) adapter = detectAdapter();
  return adapter;
}
