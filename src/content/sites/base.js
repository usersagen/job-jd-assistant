// 站点适配器公共实现：字段解析、标题读取、薪资还原与描述清洗。
import { clean, pick, findByAnchor } from '../../shared/dom.js';

export function parseMeta(text) {
  const parts = text.split(/[\s|]+/).filter(Boolean);
  const meta = { city: '', experience: '', degree: '' };
  for (const part of parts) {
    if (!meta.experience && /(\d+\s*[-~]\s*\d+\s*年|经验|应届|在校)/.test(part)) meta.experience = part;
    else if (!meta.degree && /(本科|大专|硕士|博士|中专|高中|初中|学历)/.test(part)) meta.degree = part;
    else if (!meta.city && /(市|区|县|·)/.test(part)) meta.city = part;
  }
  if (!meta.city && parts[0]) meta.city = parts[0];
  return meta;
}

// 解析右侧「公司基本信息」卡片：公司名、人数
export function parseCompanyInfo(lines) {
  const noise = /^(公司基本信息|公司介绍|公司信息|工商信息|查看全部职位|查看全部.*)$/;
  const info = { name: '', scale: '' };
  for (const raw of lines) {
    const line = (raw || '').trim();
    if (!line || noise.test(line)) continue;
    if (!info.scale && /(\d+\s*[-~]\s*\d+\s*人|\d+人以上)/.test(line)) {
      info.scale = line;
      continue;
    }
    // 融资阶段不输出，但仍要跳过，避免被当成公司名
    if (/(未融资|不需要融资|天使轮|种子轮|战略融资|[A-F]轮|已上市|IPO)/.test(line)) continue;
    if (!info.name) info.name = line;
  }
  return info;
}

// 普通站点直接按选择器取；元信息统一用「独立字段优先，其次合并标签」的规则
export function pickMeta(selectors, parsed) {
  return {
    city: pick(selectors.city) || parsed.city,
    experience: pick(selectors.experience) || parsed.experience,
    degree: pick(selectors.degree) || parsed.degree
  };
}

// 职位名称：智联的 h1 里嵌了薪资节点，取标题时先剔除
export function readTitleFrom(selectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.job-banner__salary, .salary').forEach((node) => node.remove());
    const text = clean(clone.textContent);
    if (text) return text;
  }
  return '';
}

// 解析招聘者卡片：姓名 · 职位 · 活跃状态（BOSS / 智联共用）
export function readRecruiterCard() {
  const card = document.querySelector('.job-boss-info') || document.querySelector('.boss-info');
  if (!card) return '';

  const activePattern = /(刚刚活跃|今日活跃|本周活跃|本月活跃|在线|离线|\d+\s*(?:日|小时|分钟)内活跃)/;
  // 从姓名等文本里剔除活跃状态，并清掉残留的分隔符
  const stripActive = (text) => clean(String(text || '').replace(new RegExp(activePattern.source, 'g'), ''))
    .replace(/^[·\s]+|[·\s]+$/g, '');

  let name = '';
  const nameEl = card.querySelector('.name');
  if (nameEl) {
    const clone = nameEl.cloneNode(true);
    clone.querySelectorAll('i, .boss-active-time').forEach((node) => node.remove());
    // 「在线 / 刚刚活跃」有时是普通文本节点或换了 class 的 span，按文字再清一遍
    clone.querySelectorAll('span, em, div').forEach((node) => {
      if (activePattern.test(clean(node.textContent))) node.remove();
    });
    name = stripActive(clone.textContent);
  }

  let active = clean((card.querySelector('.boss-active-time') || {}).textContent || '');

  let position = '';
  const attrEl = card.querySelector('.boss-info-attr');
  if (attrEl) {
    const attr = clean(attrEl.textContent);
    position = attr.includes('·') ? attr.split('·').pop().trim() : attr;
  }

  // class 结构变化时退回按行解析
  if (!name || !position || !active) {
    const text = clean(card.innerText);
    if (!active) {
      const match = text.match(activePattern);
      if (match) active = match[0];
    }
    if (!name) {
      for (const line of text.split('\n')) {
        const cleaned = line.trim();
        if (!cleaned || /^V$/i.test(cleaned) || cleaned.includes('·')) continue;
        const nameLine = stripActive(cleaned);
        if (nameLine) {
          name = nameLine;
          break;
        }
      }
    }
    if (!position) {
      const match = text.match(/·\s*([^\n]+)/);
      if (match) position = stripActive(match[1]);
    }
  }

  // 姓名里若已带上活跃状态，去掉后再拼，避免「在线 · 经理 · 在线」
  const parts = [];
  [name, position, active].forEach((part) => {
    if (part && !parts.includes(part)) parts.push(part);
  });
  return parts.join(' · ');
}

// 招聘者卡片读不到时，退回 hr / hrExtra 选择器
export function readHrFallback(selectors) {
  const parts = [pick(selectors.hr), pick(selectors.hrExtra)]
    .flatMap((text) => text.split('\n'))
    .map((text) => text.trim())
    .filter(Boolean);
  return Array.from(new Set(parts)).join(' · ');
}

// 薪资数字被 BOSS 换成私有区字符（自定义字体渲染），page-hook.js 已把接口里的
// 明文 salaryDesc 写到 data-bz-salary，这里按岗位 ID / 标题匹配还原
export function resolveSalary(selectors, jobId, title, company) {
  const text = pick(selectors.salary);
  if (!/[\ue000-\uf8ff]/.test(text)) return text.replace(/[ \t]+/g, ' ').trim();

  let records = [];
  try {
    records = JSON.parse(document.documentElement.getAttribute('data-bz-salary') || '[]');
  } catch (err) {
    return text;
  }
  if (!Array.isArray(records) || !records.length) return text;

  let hit = jobId ? records.find((item) => item.id === jobId) : null;
  if (!hit && title) {
    const sameTitle = records.filter((item) => item.title === title);
    hit = sameTitle.length === 1 ? sameTitle[0] : sameTitle.find((item) => item.company === company);
  }
  return (hit && hit.salary) || text;
}

// 读取职位描述：deep 时在内容过短的情况下用文本锚点兜底
export function readDescriptionFrom(getElement, deep, stripWatermark = false) {
  const el = getElement();
  let text = '';

  if (el) {
    const clone = el.cloneNode(true);
    // 列表页的 .desc 里内嵌了一段 <style>，不删会混进正文
    clone.querySelectorAll('style, script').forEach((node) => node.remove());
    clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    if (stripWatermark) {
      clone.querySelectorAll('span, i, em, b').forEach((node) => {
        const value = (node.textContent || '').trim();
        if (/^(boss|kanzhun|直聘|boss直聘|来自boss直聘|看准网)$/i.test(value) || /boss直聘|看准网|kanzhun/i.test(value)) {
          node.remove();
        }
      });
    }
    text = clean(clone.textContent);
  }

  if (deep && text.length < 30) {
    text = findByAnchor(['职位描述', '岗位职责', '工作内容']);
  }
  return text;
}
