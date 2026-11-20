// 智联招聘：新版职位详情页（/jobdetail/）与校园招聘（xiaoyuan /job/）共用一套选择器。
import { pick, pickAll } from '../../shared/dom.js';
import {
  pickMeta,
  readTitleFrom,
  readRecruiterCard,
  resolveSalary,
  readDescriptionFrom
} from './base.js';

// 页面改版时优先改这里：每个字段按顺序尝试，命中即返回
export const SELECTORS = {
  title: ['.summary-planes__title', '.job-banner__name'],
  salary: ['.summary-planes__salary', '.job-banner__salary'],
  company: ['.company-summary__name-link', '.company-summary__name', '.company-info__name'],
  meta: ['.job-banner__desc'],
  city: [],
  experience: [],
  degree: [],
  tags: ['.describtion-card__skills-item', '.job-info__major-tags span', '.job-info__tags span'],
  description: ['.describtion-card__detail-content', '.job-info__desc-content', '.job-info__desc'],
  address: ['.address-info__bubble'],
  hr: [],
  hrExtra: [],
  companyInfo: ['.company-summary__item .company-summary__text', '.company-info__property p']
};

function readZhilianMeta() {
  const meta = { city: '', experience: '', degree: '' };
  const extras = [];
  // 新版详情页把城市 / 经验 / 学历放在 summary-planes__info 的 li 里
  const items = pickAll(['.job-banner__desc .job-banner__desc-text']);
  const summary = pickAll(['.summary-planes__info li']);
  const list = items.length ? items : summary;

  (list.length ? list : pickAll(SELECTORS.meta).join('\n').split('\n')).forEach((raw) => {
    const text = raw.trim();
    if (!text) return;
    if (/^(全职|兼职|实习|校招|社招)$/.test(text) || /^招\s*\d+\s*人$/.test(text)) {
      extras.push(text);
    } else if (!meta.experience && /(经验|应届|在校|\d+\s*[-~]?\s*\d*\s*年)/.test(text)) {
      meta.experience = text;
    } else if (!meta.degree && /(本科|大专|硕士|博士|中专|高中|初中|学历)/.test(text)) {
      meta.degree = text;
    } else if (!meta.city && /(市|区|县|·)/.test(text)) {
      meta.city = text;
    } else if (!meta.city) {
      meta.city = text;
    } else {
      extras.push(text);
    }
  });

  return { meta, extras };
}

// 右侧公司卡片：取企业规模
function readZhilianCompany() {
  const info = { name: pick(SELECTORS.company), scale: '' };

  pickAll(SELECTORS.companyInfo).forEach((line) => {
    const match = line.match(/^([^：:]+)[：:]\s*(.+)$/);
    if (match) {
      if (/规模|人数/.test(match[1].trim())) info.scale = match[2].trim();
      return;
    }
    // 新版公司卡片直接给「100-299人」这样的文本
    const scale = !info.scale && line.match(/\d+\s*[-~]\s*\d+\s*人|\d+\s*人以上/);
    if (scale) info.scale = scale[0];
  });

  return info;
}

function isListPage() {
  return false;
}

function pageKey() {
  return `zhilian|${location.href}|${readTitle()}`;
}

function getJobId() {
  return (location.pathname.match(/\/jobdetail\/([^./?#]+)\.htm/) || [])[1]
    || (location.pathname.match(/\/job\/([^/?#]+)/) || [])[1]
    || '';
}

function getCanonicalUrl(jobId) {
  if (!jobId) return location.href.split('?')[0];
  if (location.pathname.includes('/jobdetail/')) {
    return `https://www.zhaopin.com/jobdetail/${jobId}.htm`;
  }
  return `https://xiaoyuan.zhaopin.com/job/${jobId}`;
}

function readTitle() {
  return readTitleFrom(SELECTORS.title);
}

function readSalary(jobId, title, company) {
  return resolveSalary(SELECTORS, jobId, title, company);
}

function readCompany() {
  return readZhilianCompany();
}

function readMeta() {
  const { meta, extras } = readZhilianMeta();
  return { ...pickMeta(SELECTORS, meta), extras };
}

function readTags(extraTags = []) {
  return Array.from(new Set([...pickAll(SELECTORS.tags), ...extraTags]));
}

function readHr() {
  return readRecruiterCard();
}

function readAddress() {
  return pick(SELECTORS.address);
}

function descriptionElement() {
  return SELECTORS.description.map((sel) => document.querySelector(sel)).find(Boolean) || null;
}

function readDescription(deep) {
  return readDescriptionFrom(descriptionElement, deep);
}

export default {
  id: 'zhilian',
  name: '智联招聘',
  selectors: SELECTORS,
  isListPage,
  pageKey,
  getJobId,
  getCanonicalUrl,
  readTitle,
  readSalary,
  readCompany,
  readMeta,
  readTags,
  readHr,
  readAddress,
  readDescription
};
