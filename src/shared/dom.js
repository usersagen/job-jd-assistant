// 页面 DOM 读取的通用工具：文本清洗、选择器取值、锚点兜底。
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function clean(text) {
  return (text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function pick(selectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    const text = clean(el && el.innerText);
    if (text) return text;
  }
  return '';
}

export function pickAll(selectors) {
  for (const sel of selectors) {
    const list = Array.from(document.querySelectorAll(sel))
      .map((el) => clean(el.innerText))
      .filter(Boolean);
    if (list.length) return Array.from(new Set(list));
  }
  return [];
}

// class 名改版时的兜底：用标题文字定位相邻内容块
// 这是开销最大的兜底（全量遍历 + 文本读取），只在最后一次重试时调用
export function findByAnchor(labels, minLen = 40) {
  const nodes = document.querySelectorAll('h2, h3, h4, div, span, p, strong, b');
  const limit = Math.min(nodes.length, 4000);
  for (let i = 0; i < limit; i++) {
    const el = nodes[i];
    if (el.childElementCount > 0) continue;
    const text = clean(el.textContent);
    if (!text || text.length > 12) continue;
    if (!labels.some((label) => text.includes(label))) continue;
    const candidates = [el.nextElementSibling, el.parentElement && el.parentElement.nextElementSibling];
    for (const candidate of candidates) {
      const content = clean(candidate && candidate.textContent);
      if (content && content.length >= minLen) return content;
    }
  }
  return '';
}
