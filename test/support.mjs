// 无依赖的 DOM / location 替身：只实现被测函数用到的最小接口。
export function stubLocation(url) {
  const parsed = new URL(url);
  globalThis.location = {
    href: parsed.href,
    hostname: parsed.hostname,
    pathname: parsed.pathname,
    search: parsed.search
  };
}

// text: 选择器 -> innerText；lists: 选择器 -> innerText 数组；elements: 选择器 -> 完整节点
// salaryRecords: data-bz-salary 内容
export function stubDom({ text = {}, lists = {}, elements = {}, salaryRecords = null } = {}) {
  globalThis.document = {
    querySelector(selector) {
      if (Object.prototype.hasOwnProperty.call(elements, selector)) {
        return elements[selector];
      }
      if (Object.prototype.hasOwnProperty.call(text, selector)) {
        return { innerText: text[selector] };
      }
      return null;
    },
    querySelectorAll(selector) {
      const items = lists[selector];
      return Array.isArray(items) ? items.map((value) => ({ innerText: value })) : [];
    },
    documentElement: {
      getAttribute: () => (salaryRecords == null ? null : JSON.stringify(salaryRecords))
    }
  };
}
