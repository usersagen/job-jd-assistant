// 厦门人才网：按区块标题定位「职位描述」「职位发布者」等卡片。
import { clean, pick, pickAll } from '../../shared/dom.js';
import {
  pickMeta,
  readTitleFrom,
  resolveSalary,
  readDescriptionFrom
} from './base.js';

// 页面改版时优先改这里：每个字段按顺序尝试，命中即返回
export const SELECTORS = {
  title: ['.job-info__top__title'],
  salary: ['.job-info__top__price > div', '.job-info__top__price'],
  company: ['.job-info__right__company'],
  meta: ['.job-info__top__time.text-block-group'],
  city: [],
  experience: [],
  degree: [],
  tags: [],
  description: [],
  address: [],
  hr: [],
  hrExtra: [],
  companyInfo: ['.job-info__right__company__tag']
};

function findXmrcBox(titleText) {
  const boxes = Array.from(document.querySelectorAll('.job-info__box'));
  return boxes.find((box) => {
    const title = box.querySelector('.job-info__box__title');
    return clean(title && title.textContent).includes(titleText);
  }) || null;
}

// 职位类别 / 经验 / 学历 / 招聘人数 / 福利 / 城市混在同一行
function readXmrcMeta() {
  const meta = { city: '', experience: '', degree: '' };
  const extras = [];
  const cityParts = [];

  pickAll(['.job-info__top__time.text-block-group > span']).forEach((raw) => {
    const text = clean(raw).replace(/^[｜|·\s]+|[｜|·\s]+$/g, '');
    if (!text) return;
    if (!meta.experience && /(经验|应届|在校|\d+\s*[-~]?\s*\d*\s*年)/.test(text)) {
      meta.experience = text;
    } else if (!meta.degree && /(本科|大专|硕士|博士|中专|高中|初中|学历)/.test(text)) {
      meta.degree = text;
    } else if (/(市|区|县)/.test(text)) {
      cityParts.push(text);
    } else {
      extras.push(text);
    }
  });

  meta.city = cityParts.join('·');
  return { meta, extras };
}

// 单位信息：公司名 + 规模标签
function readXmrcCompany() {
  const tags = pickAll(SELECTORS.companyInfo);
  const scale = tags.find((tag) => /(\d+\s*[-~]\s*\d+\s*人|\d+人以上)/.test(tag)) || '';
  return { name: pick(SELECTORS.company), scale };
}

// 职位发布者：只在「职位发布者」区块内取，避免误命中相关职位卡片的 .c-3
function readXmrcHr() {
  const box = findXmrcBox('职位发布者');
  const el = box && box.querySelector('.c-3');
  return clean(el && el.textContent);
}

// 工作地点：地图链接里带完整地址，去掉「点击查看地图」提示
function readXmrcAddress() {
  const link = document.querySelector('.job-info__box a[href*="amap.com"]');
  if (!link) return '';
  const clone = link.cloneNode(true);
  clone.querySelectorAll('.c-primary').forEach((node) => node.remove());
  return clean(clone.textContent);
}

function isListPage() {
  return false;
}

function pageKey() {
  return `xmrc|${location.href}|${readTitle()}`;
}

function getJobId() {
  return new URL(location.href).searchParams.get('id') || '';
}

// 厦门人才网详情页地址即规范链接
function getCanonicalUrl() {
  return location.href;
}

function readTitle() {
  return readTitleFrom(SELECTORS.title);
}

function readSalary(jobId, title, company) {
  return resolveSalary(SELECTORS, jobId, title, company);
}

function readCompany() {
  return readXmrcCompany();
}

function readMeta() {
  const { meta, extras } = readXmrcMeta();
  return { ...pickMeta(SELECTORS, meta), extras };
}

function readTags(extraTags = []) {
  return Array.from(new Set([...pickAll(SELECTORS.tags), ...extraTags]));
}

function readHr() {
  return readXmrcHr();
}

function readAddress() {
  return readXmrcAddress();
}

// 按区块标题定位职位描述
function descriptionElement() {
  const box = findXmrcBox('职位描述');
  return box ? box.querySelector('.job-info__box__text') : null;
}

function readDescription(deep) {
  return readDescriptionFrom(descriptionElement, deep);
}

export default {
  id: 'xmrc',
  name: '厦门人才网',
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
