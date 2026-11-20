(() => {
  // src/content/state.js
  var runtime = {
    host: null,
    ui: null,
    lastPageKey: "",
    lastData: null,
    extracting: false,
    threadPinned: true,
    chat: { messages: [], busy: false, port: null, greeted: false }
  };

  // src/shared/protocol.js
  var HOST_ID = "bz-jd-ext-host";
  var MSG = {
    EXTRACT: "boss-jd-extract",
    OPEN_OPTIONS: "boss-open-options",
    SESSION: "boss-jd-session"
  };
  var PORT_AI_CHAT = "ai-chat";

  // src/shared/dom.js
  var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  function clean(text) {
    return (text || "").replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function pick(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const text = clean(el && el.innerText);
      if (text) return text;
    }
    return "";
  }
  function pickAll(selectors) {
    for (const sel of selectors) {
      const list = Array.from(document.querySelectorAll(sel)).map((el) => clean(el.innerText)).filter(Boolean);
      if (list.length) return Array.from(new Set(list));
    }
    return [];
  }
  function findByAnchor(labels, minLen = 40) {
    const nodes = document.querySelectorAll("h2, h3, h4, div, span, p, strong, b");
    const limit = Math.min(nodes.length, 4e3);
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
    return "";
  }

  // src/content/sites/base.js
  function parseMeta(text) {
    const parts = text.split(/[\s|]+/).filter(Boolean);
    const meta = { city: "", experience: "", degree: "" };
    for (const part of parts) {
      if (!meta.experience && /(\d+\s*[-~]\s*\d+\s*年|经验|应届|在校)/.test(part)) meta.experience = part;
      else if (!meta.degree && /(本科|大专|硕士|博士|中专|高中|初中|学历)/.test(part)) meta.degree = part;
      else if (!meta.city && /(市|区|县|·)/.test(part)) meta.city = part;
    }
    if (!meta.city && parts[0]) meta.city = parts[0];
    return meta;
  }
  function parseCompanyInfo(lines) {
    const noise = /^(公司基本信息|公司介绍|公司信息|工商信息|查看全部职位|查看全部.*)$/;
    const info = { name: "", scale: "" };
    for (const raw of lines) {
      const line = (raw || "").trim();
      if (!line || noise.test(line)) continue;
      if (!info.scale && /(\d+\s*[-~]\s*\d+\s*人|\d+人以上)/.test(line)) {
        info.scale = line;
        continue;
      }
      if (/(未融资|不需要融资|天使轮|种子轮|战略融资|[A-F]轮|已上市|IPO)/.test(line)) continue;
      if (!info.name) info.name = line;
    }
    return info;
  }
  function pickMeta(selectors, parsed) {
    return {
      city: pick(selectors.city) || parsed.city,
      experience: pick(selectors.experience) || parsed.experience,
      degree: pick(selectors.degree) || parsed.degree
    };
  }
  function readTitleFrom(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const clone = el.cloneNode(true);
      clone.querySelectorAll(".job-banner__salary, .salary").forEach((node) => node.remove());
      const text = clean(clone.textContent);
      if (text) return text;
    }
    return "";
  }
  function readRecruiterCard() {
    const card = document.querySelector(".job-boss-info") || document.querySelector(".boss-info");
    if (!card) return "";
    const activePattern = /(刚刚活跃|今日活跃|本周活跃|本月活跃|在线|离线|\d+\s*(?:日|小时|分钟)内活跃)/;
    const stripActive = (text) => clean(String(text || "").replace(new RegExp(activePattern.source, "g"), "")).replace(/^[·\s]+|[·\s]+$/g, "");
    let name = "";
    const nameEl = card.querySelector(".name");
    if (nameEl) {
      const clone = nameEl.cloneNode(true);
      clone.querySelectorAll("i, .boss-active-time").forEach((node) => node.remove());
      clone.querySelectorAll("span, em, div").forEach((node) => {
        if (activePattern.test(clean(node.textContent))) node.remove();
      });
      name = stripActive(clone.textContent);
    }
    let active = clean((card.querySelector(".boss-active-time") || {}).textContent || "");
    let position = "";
    const attrEl = card.querySelector(".boss-info-attr");
    if (attrEl) {
      const attr = clean(attrEl.textContent);
      position = attr.includes("·") ? attr.split("·").pop().trim() : attr;
    }
    if (!name || !position || !active) {
      const text = clean(card.innerText);
      if (!active) {
        const match = text.match(activePattern);
        if (match) active = match[0];
      }
      if (!name) {
        for (const line of text.split("\n")) {
          const cleaned = line.trim();
          if (!cleaned || /^V$/i.test(cleaned) || cleaned.includes("·")) continue;
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
    const parts = [];
    [name, position, active].forEach((part) => {
      if (part && !parts.includes(part)) parts.push(part);
    });
    return parts.join(" · ");
  }
  function readHrFallback(selectors) {
    const parts = [pick(selectors.hr), pick(selectors.hrExtra)].flatMap((text) => text.split("\n")).map((text) => text.trim()).filter(Boolean);
    return Array.from(new Set(parts)).join(" · ");
  }
  function resolveSalary(selectors, jobId, title, company) {
    const text = pick(selectors.salary);
    if (!/[\ue000-\uf8ff]/.test(text)) return text.replace(/[ \t]+/g, " ").trim();
    let records = [];
    try {
      records = JSON.parse(document.documentElement.getAttribute("data-bz-salary") || "[]");
    } catch (err) {
      return text;
    }
    if (!Array.isArray(records) || !records.length) return text;
    let hit = jobId ? records.find((item) => item.id === jobId) : null;
    if (!hit && title) {
      const sameTitle = records.filter((item) => item.title === title);
      hit = sameTitle.length === 1 ? sameTitle[0] : sameTitle.find((item) => item.company === company);
    }
    return hit && hit.salary || text;
  }
  function readDescriptionFrom(getElement, deep, stripWatermark = false) {
    const el = getElement();
    let text = "";
    if (el) {
      const clone = el.cloneNode(true);
      clone.querySelectorAll("style, script").forEach((node) => node.remove());
      clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
      if (stripWatermark) {
        clone.querySelectorAll("span, i, em, b").forEach((node) => {
          const value = (node.textContent || "").trim();
          if (/^(boss|kanzhun|直聘|boss直聘|来自boss直聘|看准网)$/i.test(value) || /boss直聘|看准网|kanzhun/i.test(value)) {
            node.remove();
          }
        });
      }
      text = clean(clone.textContent);
    }
    if (deep && text.length < 30) {
      text = findByAnchor(["职位描述", "岗位职责", "工作内容"]);
    }
    return text;
  }

  // src/content/sites/boss.js
  var SELECTORS = {
    title: [".job-banner .name h1", ".job-banner .name", ".job-primary .name h1", ".job-detail-header .job-detail-info .job-name", ".job-card-wrap.active .job-name", ".job-name"],
    salary: [".job-banner .salary", ".job-primary .salary", ".job-detail-header .job-detail-info .job-salary", ".job-card-wrap.active .job-salary", ".salary"],
    company: [".company-info .company-name", ".sider-company .company-name", ".job-banner .company-info a", ".company-name"],
    meta: [".job-banner .info-primary p", ".job-primary .info-primary p", ".job-banner .job-info .text"],
    city: [".job-banner .text-city", ".text-city"],
    experience: [".job-banner .text-experiece", ".text-experiece"],
    degree: [".job-banner .text-degree", ".text-degree"],
    tags: [".job-keyword-list li", ".job-keyword-list span", ".job-label-list li"],
    description: [".job-detail-body .desc-wrapper .desc", ".job-sec-text", ".job-detail-section .text", ".job-sec .text", ".job-detail .text", ".job-detail-body .desc"],
    address: [".job-location .location-address", ".location-address", ".location-address-box", ".job-address-desc"],
    hr: [".job-boss-info .name", ".job-boss-info .boss-name", ".boss-info .name"],
    hrExtra: [".job-boss-info .gray", ".job-boss-info .boss-position"],
    companyInfo: [".company-info p", ".company-tag-list li"]
  };
  function isListPage() {
    return location.pathname.startsWith("/web/geek/jobs") || location.pathname.startsWith("/gongsi/job");
  }
  function pageKey() {
    if (!isListPage()) return `detail|${location.href}`;
    const link = document.querySelector(".job-card-wrap.active .job-name[href]") || document.querySelector(".job-card-box.active .job-name[href]");
    const title = document.querySelector(".job-detail-header .job-detail-info .job-name");
    return `list|${link ? link.getAttribute("href") : ""}|${clean(title && title.textContent)}`;
  }
  function readJobLink() {
    const link = document.querySelector(".job-detail-container .more-job-btn[href]") || document.querySelector(".job-detail-box .more-job-btn[href]") || document.querySelector(".job-card-wrap.active .job-name[href]") || document.querySelector(".job-card-box.active .job-name[href]");
    return link ? link.href : "";
  }
  function getJobId() {
    const match = location.pathname.match(/job_detail\/([^./?]+)\.html/) || readJobLink().match(/job_detail\/([^./?]+)\.html/) || [];
    return match[1] || "";
  }
  function getCanonicalUrl(jobId) {
    return jobId ? `https://www.zhipin.com/job_detail/${jobId}.html` : location.href.split("?")[0];
  }
  function readTitle() {
    return readTitleFrom(SELECTORS.title);
  }
  function readSalary(jobId, title, company) {
    return resolveSalary(SELECTORS, jobId, title, company);
  }
  function parseAgentCompany() {
    const el = document.querySelector(".job-boss-info .boss-info-attr") || document.querySelector(".boss-info-attr");
    const text = clean(el && el.textContent);
    return text ? text.split("·")[0].trim() : "";
  }
  function parseCompanyCard(card) {
    const info = { name: "", scale: "" };
    const links = Array.from(card.querySelectorAll(".company-info a"));
    const candidates = [];
    links.forEach((a) => {
      const title = (a.getAttribute("title") || "").trim();
      const text = (a.textContent || "").trim();
      if (title) candidates.push(title);
      if (text) candidates.push(text);
    });
    if (candidates.length) {
      info.name = clean(candidates.reduce((longest, cur) => cur.length > longest.length ? cur : longest));
    }
    const scaleIcon = card.querySelector(".icon-scale");
    if (scaleIcon) info.scale = clean(scaleIcon.parentElement.textContent);
    if (!info.name || !info.scale) {
      const fallback = parseCompanyInfo(clean(card.innerText).split("\n"));
      info.name = info.name || fallback.name;
      info.scale = info.scale || fallback.scale;
    }
    return info;
  }
  function readBusinessInfo() {
    const box = document.querySelector(".level-list-box") || document.querySelector(".level-list");
    const empty = { name: "" };
    if (!box) return empty;
    const item = box.querySelector(".company-name");
    if (!item) return empty;
    const clone = item.cloneNode(true);
    clone.querySelectorAll("span, em").forEach((node) => node.remove());
    return { name: clean(clone.textContent) };
  }
  function readCompany(deep) {
    const companyCard = document.querySelector(".sider-company");
    const info = companyCard ? parseCompanyCard(companyCard) : parseCompanyInfo(pickAll(SELECTORS.companyInfo));
    const business = readBusinessInfo();
    let name = business.name || info.name;
    if (!name) name = pick(SELECTORS.company);
    if (!name) name = parseAgentCompany();
    if (!name) name = pick([".job-card-wrap.active .boss-name"]);
    if (deep && !name) name = findByAnchor(["公司介绍", "公司信息"], 2);
    return { name, scale: info.scale || "" };
  }
  function readMeta() {
    const headerTags = pickAll([".job-detail-header .tag-list li"]);
    const parsed = parseMeta(pick(SELECTORS.meta) || headerTags.join(" | "));
    return { ...pickMeta(SELECTORS, parsed), extras: [] };
  }
  function readTags() {
    return pickAll(SELECTORS.tags);
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
    return readDescriptionFrom(descriptionElement, deep, true);
  }
  var boss_default = {
    id: "boss",
    name: "BOSS 直聘",
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

  // src/content/sites/zhilian.js
  var SELECTORS2 = {
    title: [".summary-planes__title", ".job-banner__name"],
    salary: [".summary-planes__salary", ".job-banner__salary"],
    company: [".company-summary__name-link", ".company-summary__name", ".company-info__name"],
    meta: [".job-banner__desc"],
    city: [],
    experience: [],
    degree: [],
    tags: [".describtion-card__skills-item", ".job-info__major-tags span", ".job-info__tags span"],
    description: [".describtion-card__detail-content", ".job-info__desc-content", ".job-info__desc"],
    address: [".address-info__bubble"],
    hr: [],
    hrExtra: [],
    companyInfo: [".company-summary__item .company-summary__text", ".company-info__property p"]
  };
  function readZhilianMeta() {
    const meta = { city: "", experience: "", degree: "" };
    const extras = [];
    const items = pickAll([".job-banner__desc .job-banner__desc-text"]);
    const summary = pickAll([".summary-planes__info li"]);
    const list = items.length ? items : summary;
    (list.length ? list : pickAll(SELECTORS2.meta).join("\n").split("\n")).forEach((raw) => {
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
  function readZhilianCompany() {
    const info = { name: pick(SELECTORS2.company), scale: "" };
    pickAll(SELECTORS2.companyInfo).forEach((line) => {
      const match = line.match(/^([^：:]+)[：:]\s*(.+)$/);
      if (match) {
        if (/规模|人数/.test(match[1].trim())) info.scale = match[2].trim();
        return;
      }
      const scale = !info.scale && line.match(/\d+\s*[-~]\s*\d+\s*人|\d+\s*人以上/);
      if (scale) info.scale = scale[0];
    });
    return info;
  }
  function isListPage2() {
    return false;
  }
  function pageKey2() {
    return `zhilian|${location.href}|${readTitle2()}`;
  }
  function getJobId2() {
    return (location.pathname.match(/\/jobdetail\/([^./?#]+)\.htm/) || [])[1] || (location.pathname.match(/\/job\/([^/?#]+)/) || [])[1] || "";
  }
  function getCanonicalUrl2(jobId) {
    if (!jobId) return location.href.split("?")[0];
    if (location.pathname.includes("/jobdetail/")) {
      return `https://www.zhaopin.com/jobdetail/${jobId}.htm`;
    }
    return `https://xiaoyuan.zhaopin.com/job/${jobId}`;
  }
  function readTitle2() {
    return readTitleFrom(SELECTORS2.title);
  }
  function readSalary2(jobId, title, company) {
    return resolveSalary(SELECTORS2, jobId, title, company);
  }
  function readCompany2() {
    return readZhilianCompany();
  }
  function readMeta2() {
    const { meta, extras } = readZhilianMeta();
    return { ...pickMeta(SELECTORS2, meta), extras };
  }
  function readTags2(extraTags = []) {
    return Array.from(/* @__PURE__ */ new Set([...pickAll(SELECTORS2.tags), ...extraTags]));
  }
  function readHr2() {
    return readRecruiterCard();
  }
  function readAddress2() {
    return pick(SELECTORS2.address);
  }
  function descriptionElement2() {
    return SELECTORS2.description.map((sel) => document.querySelector(sel)).find(Boolean) || null;
  }
  function readDescription2(deep) {
    return readDescriptionFrom(descriptionElement2, deep);
  }
  var zhilian_default = {
    id: "zhilian",
    name: "智联招聘",
    selectors: SELECTORS2,
    isListPage: isListPage2,
    pageKey: pageKey2,
    getJobId: getJobId2,
    getCanonicalUrl: getCanonicalUrl2,
    readTitle: readTitle2,
    readSalary: readSalary2,
    readCompany: readCompany2,
    readMeta: readMeta2,
    readTags: readTags2,
    readHr: readHr2,
    readAddress: readAddress2,
    readDescription: readDescription2
  };

  // src/content/sites/xmrc.js
  var SELECTORS3 = {
    title: [".job-info__top__title"],
    salary: [".job-info__top__price > div", ".job-info__top__price"],
    company: [".job-info__right__company"],
    meta: [".job-info__top__time.text-block-group"],
    city: [],
    experience: [],
    degree: [],
    tags: [],
    description: [],
    address: [],
    hr: [],
    hrExtra: [],
    companyInfo: [".job-info__right__company__tag"]
  };
  function findXmrcBox(titleText) {
    const boxes = Array.from(document.querySelectorAll(".job-info__box"));
    return boxes.find((box) => {
      const title = box.querySelector(".job-info__box__title");
      return clean(title && title.textContent).includes(titleText);
    }) || null;
  }
  function readXmrcMeta() {
    const meta = { city: "", experience: "", degree: "" };
    const extras = [];
    const cityParts = [];
    pickAll([".job-info__top__time.text-block-group > span"]).forEach((raw) => {
      const text = clean(raw).replace(/^[｜|·\s]+|[｜|·\s]+$/g, "");
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
    meta.city = cityParts.join("·");
    return { meta, extras };
  }
  function readXmrcCompany() {
    const tags = pickAll(SELECTORS3.companyInfo);
    const scale = tags.find((tag) => /(\d+\s*[-~]\s*\d+\s*人|\d+人以上)/.test(tag)) || "";
    return { name: pick(SELECTORS3.company), scale };
  }
  function readXmrcHr() {
    const box = findXmrcBox("职位发布者");
    const el = box && box.querySelector(".c-3");
    return clean(el && el.textContent);
  }
  function readXmrcAddress() {
    const link = document.querySelector('.job-info__box a[href*="amap.com"]');
    if (!link) return "";
    const clone = link.cloneNode(true);
    clone.querySelectorAll(".c-primary").forEach((node) => node.remove());
    return clean(clone.textContent);
  }
  function isListPage3() {
    return false;
  }
  function pageKey3() {
    return `xmrc|${location.href}|${readTitle3()}`;
  }
  function getJobId3() {
    return new URL(location.href).searchParams.get("id") || "";
  }
  function getCanonicalUrl3() {
    return location.href;
  }
  function readTitle3() {
    return readTitleFrom(SELECTORS3.title);
  }
  function readSalary3(jobId, title, company) {
    return resolveSalary(SELECTORS3, jobId, title, company);
  }
  function readCompany3() {
    return readXmrcCompany();
  }
  function readMeta3() {
    const { meta, extras } = readXmrcMeta();
    return { ...pickMeta(SELECTORS3, meta), extras };
  }
  function readTags3(extraTags = []) {
    return Array.from(/* @__PURE__ */ new Set([...pickAll(SELECTORS3.tags), ...extraTags]));
  }
  function readHr3() {
    return readXmrcHr();
  }
  function readAddress3() {
    return readXmrcAddress();
  }
  function descriptionElement3() {
    const box = findXmrcBox("职位描述");
    return box ? box.querySelector(".job-info__box__text") : null;
  }
  function readDescription3(deep) {
    return readDescriptionFrom(descriptionElement3, deep);
  }
  var xmrc_default = {
    id: "xmrc",
    name: "厦门人才网",
    selectors: SELECTORS3,
    isListPage: isListPage3,
    pageKey: pageKey3,
    getJobId: getJobId3,
    getCanonicalUrl: getCanonicalUrl3,
    readTitle: readTitle3,
    readSalary: readSalary3,
    readCompany: readCompany3,
    readMeta: readMeta3,
    readTags: readTags3,
    readHr: readHr3,
    readAddress: readAddress3,
    readDescription: readDescription3
  };

  // src/content/sites/liepin.js
  var SELECTORS4 = {
    title: [".job-apply-content .name-box > span.name", ".job-apply-content .name-box .job-title"],
    salary: [".job-apply-content .name-box .salary", ".name-box .salary"],
    company: [".company-info-container .company-card .name"],
    meta: [".job-properties"],
    city: [],
    experience: [],
    degree: [],
    tags: [],
    description: ['.job-intro-container dd[data-selector="job-intro-content"]', ".job-intro-container .paragraph dd"],
    address: [],
    hr: [],
    hrExtra: [],
    companyInfo: [".company-info-container .label-box"]
  };
  function readLiepinMeta() {
    const meta = { city: "", experience: "", degree: "" };
    const extras = [];
    pickAll([".job-properties > span"]).forEach((raw) => {
      const text = clean(raw);
      if (!text) return;
      if (!meta.experience && /(经验|应届|在校)/.test(text)) meta.experience = text;
      else if (!meta.degree && /(学历|本科|大专|硕士|博士|中专|高中)/.test(text)) meta.degree = text;
      else if (!meta.city && /(市|区|县|-)/.test(text)) meta.city = text;
      else extras.push(text);
    });
    return { meta, extras };
  }
  function readLiepinCompany() {
    const info = { name: pick(SELECTORS4.company), scale: "", address: "" };
    document.querySelectorAll(".company-info-container .label-box").forEach((box) => {
      const label = clean((box.querySelector(".label") || {}).textContent);
      const value = clean((box.querySelector(".text") || {}).textContent);
      if (!value) return;
      if (/规模|人数/.test(label)) info.scale = value;
      else if (/地址/.test(label)) info.address = value;
    });
    return info;
  }
  function readLiepinHr() {
    const card = document.querySelector(".recruiter-container");
    if (!card) return "";
    const name = clean((card.querySelector(".content .name-box .name") || {}).textContent);
    const position = clean((card.querySelector(".title-box > span") || {}).textContent);
    const active = clean((card.querySelector(".online") || {}).textContent);
    return [name, position, active].filter(Boolean).join(" · ");
  }
  function isListPage4() {
    return false;
  }
  function pageKey4() {
    return `detail|${location.href}`;
  }
  function getJobId4() {
    return (location.pathname.match(/\/(?:job|lptjob)\/(\d+)(?:\.shtml)?/) || [])[1] || "";
  }
  function getCanonicalUrl4(jobId) {
    if (!jobId) return location.href.split("?")[0];
    return location.pathname.startsWith("/lptjob/") ? `https://www.liepin.com/lptjob/${jobId}` : `https://www.liepin.com/job/${jobId}.shtml`;
  }
  function readTitle4() {
    return readTitleFrom(SELECTORS4.title);
  }
  function readSalary4(jobId, title, company) {
    return resolveSalary(SELECTORS4, jobId, title, company);
  }
  function readCompany4() {
    return readLiepinCompany();
  }
  function readMeta4() {
    const { meta, extras } = readLiepinMeta();
    return { ...pickMeta(SELECTORS4, meta), extras };
  }
  function readTags4(extraTags = []) {
    return Array.from(/* @__PURE__ */ new Set([...pickAll(SELECTORS4.tags), ...extraTags]));
  }
  function readHr4() {
    return readLiepinHr();
  }
  function readAddress4() {
    return "";
  }
  function descriptionElement4() {
    return SELECTORS4.description.map((sel) => document.querySelector(sel)).find(Boolean) || null;
  }
  function readDescription4(deep) {
    return readDescriptionFrom(descriptionElement4, deep);
  }
  var liepin_default = {
    id: "liepin",
    name: "猎聘",
    selectors: SELECTORS4,
    isListPage: isListPage4,
    pageKey: pageKey4,
    getJobId: getJobId4,
    getCanonicalUrl: getCanonicalUrl4,
    readTitle: readTitle4,
    readSalary: readSalary4,
    readCompany: readCompany4,
    readMeta: readMeta4,
    readTags: readTags4,
    readHr: readHr4,
    readAddress: readAddress4,
    readDescription: readDescription4
  };

  // src/content/sites/index.js
  function detectAdapter(hostname = location.hostname) {
    if (/(^|\.)zhaopin\.com$/.test(hostname)) return zhilian_default;
    if (/(^|\.)xmrc\.com\.cn$/.test(hostname)) return xmrc_default;
    if (/(^|\.)liepin\.com$/.test(hostname)) return liepin_default;
    return boss_default;
  }
  var adapter = null;
  function getAdapter() {
    if (!adapter) adapter = detectAdapter();
    return adapter;
  }

  // src/shared/clipboard.js
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.top = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand("copy");
        textarea.remove();
        return ok;
      } catch (e) {
        return false;
      }
    }
  }

  // src/shared/markdown.js
  function toMarkdown(data) {
    const lines = [`# ${data.title || "(未提取到职位名称)"}`, ""];
    const push = (label, value) => {
      if (value && String(value).trim()) lines.push(`- **${label}**：${value}`);
    };
    push("公司", data.company);
    push("公司规模", data.companyScale);
    push("薪资", data.salary);
    push("城市", data.city);
    push("经验", data.experience);
    push("学历", data.degree);
    if (data.tags.length) push("标签", data.tags.join(" / "));
    push("HR", data.hr);
    push("地址", data.address);
    push("链接", data.url);
    lines.push("", "## 职位描述", "", data.description || "(未提取到职位描述)");
    return lines.join("\n");
  }
  var ESCAPE = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
  function esc(text) {
    return String(text).replace(/[&<>]/g, (ch) => ESCAPE[ch]);
  }
  function inline(text) {
    return esc(text).replace(/`([^`\n]+)`/g, "<code>$1</code>").replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>").replace(/~~([^~\n]+)~~/g, "<del>$1</del>").replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }
  function splitRow(row) {
    return row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((cell) => cell.trim());
  }
  function formatMessage(text) {
    const lines = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let list = "";
    const closeList = () => {
      if (list) {
        out.push(`</${list}>`);
        list = "";
      }
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*```/.test(line)) {
        closeList();
        const body = [];
        i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
          body.push(lines[i]);
          i++;
        }
        out.push(`<pre><code>${esc(body.join("\n"))}</code></pre>`);
        continue;
      }
      if (!line.trim()) {
        closeList();
        continue;
      }
      if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
        closeList();
        out.push("<hr>");
        continue;
      }
      const head = line.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/);
      if (head) {
        closeList();
        out.push(`<b class="h">${inline(head[1])}</b>`);
        continue;
      }
      const quote = line.match(/^\s*>\s?(.*)$/);
      if (quote) {
        closeList();
        out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
        continue;
      }
      if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
        closeList();
        const headCells = splitRow(line);
        i++;
        const rows = [];
        while (i + 1 < lines.length && lines[i + 1].includes("|") && lines[i + 1].trim()) {
          rows.push(splitRow(lines[i + 1]));
          i++;
        }
        out.push("<table><thead><tr>");
        headCells.forEach((cell) => out.push(`<th>${inline(cell)}</th>`));
        out.push("</tr></thead><tbody>");
        rows.forEach((cells) => {
          out.push("<tr>");
          cells.forEach((cell) => out.push(`<td>${inline(cell)}</td>`));
          out.push("</tr>");
        });
        out.push("</tbody></table>");
        continue;
      }
      const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
      if (bullet) {
        if (list !== "ul") {
          closeList();
          out.push("<ul>");
          list = "ul";
        }
        out.push(`<li>${inline(bullet[1])}</li>`);
        continue;
      }
      const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ordered) {
        if (list !== "ol") {
          closeList();
          out.push("<ol>");
          list = "ol";
        }
        out.push(`<li>${inline(ordered[1])}</li>`);
        continue;
      }
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
    closeList();
    return out.join("");
  }

  // src/content/extract.js
  function extract(deep = false) {
    const site = getAdapter();
    const description = site.readDescription(deep);
    const companyInfo = site.readCompany(deep);
    let company = companyInfo.name || pick(site.selectors.company);
    const meta = site.readMeta();
    const tags = site.readTags(meta.extras);
    let hr = site.readHr();
    if (!hr) hr = readHrFallback(site.selectors);
    const jobId = site.getJobId();
    const title = site.readTitle();
    const salary = site.readSalary(jobId, title, company);
    return {
      jobId,
      title,
      salary,
      company,
      companyScale: companyInfo.scale || "",
      city: meta.city,
      experience: meta.experience,
      degree: meta.degree,
      tags,
      hr,
      address: companyInfo.address || site.readAddress(),
      description,
      url: site.getCanonicalUrl(jobId),
      extractedAt: (/* @__PURE__ */ new Date()).toLocaleString("zh-CN")
    };
  }
  async function extractWithRetry() {
    let data = extract();
    let usedDeep = false;
    for (let i = 0; i < 5 && (!data.title || !data.description); i++) {
      await sleep(400);
      const deep = i === 4;
      data = extract(deep);
      usedDeep = usedDeep || deep;
    }
    if (!usedDeep && !data.company) data = extract(true);
    return data;
  }

  // src/content/ui/styles.js
  var CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .wrap {
      position: fixed; right: 20px; bottom: 96px; z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
      font-size: 13px; color: #1f2328; text-align: left;
    }
    .trigger {
      display: flex; align-items: center; gap: 6px; height: 40px; padding: 0 16px;
      border: none; border-radius: 20px; background: #00a6a7; color: #fff;
      font-size: 13px; font-weight: 600; cursor: pointer;
      box-shadow: 0 4px 14px rgba(0, 166, 167, .35);
      transition: transform .15s, box-shadow .15s;
    }
    .trigger:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0, 166, 167, .45); }
    .trigger[disabled] { opacity: .65; cursor: default; transform: none; }
    .panel {
      position: absolute; right: 0; bottom: 52px; width: min(400px, calc(100vw - 40px));
      height: min(680px, calc(100vh - 170px));
      display: flex; flex-direction: column; background: #fff;
      border: 1px solid #e5e7eb; border-radius: 12px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, .16); overflow: hidden;
    }
    .panel[hidden] { display: none; }
    .head {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 14px; border-bottom: 1px solid #f0f1f2;
    }
    .head h2 { margin: 0; flex: 1; min-width: 0; font-size: 15px; line-height: 20px; font-weight: 600; word-break: break-all; }
    .head-actions { flex: none; display: flex; align-items: center; gap: 4px; }
    .close,
    .gear {
      flex: none; display: flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; padding: 0; margin: 0; border: none; border-radius: 6px;
      background: none; color: #585858; font-size: 13px; font-weight: 600; line-height: 1;
      cursor: pointer;
    }
    .close:hover { background: #f2f4f5; color: #00a6a7; }
    .gear svg,
    .close svg { display: block; width: 18px; height: 18px; }
    /* 关闭图标的实际笔画范围较小，放大 2px 与其它图标视觉等大 */
    .close svg { width: 20px; height: 20px; }
    .body { padding: 10px 14px; overflow-y: auto; }
    .row { display: flex; gap: 8px; margin-bottom: 6px; line-height: 1.5; }
    .row b { flex: 0 0 52px; color: #6b7280; font-weight: 500; }
    .row span { flex: 1; word-break: break-word; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 4px; }
    .chip { padding: 2px 8px; border-radius: 4px; background: #f2f4f5; color: #4b5563; font-size: 12px; }
    .desc {
      margin: 10px 0 0; padding-top: 10px; border-top: 1px dashed #e5e7eb;
      white-space: pre-wrap; line-height: 1.65; word-break: break-word;
      color: #374151;
    }
    .warn { margin-top: 8px; padding: 6px 8px; border-radius: 6px; background: #fff7e6; color: #b45309; font-size: 12px; }
    .foot { display: flex; gap: 8px; padding: 10px 14px 12px; border-top: 1px solid #f0f1f2; }
    .act {
      flex: 1; height: 32px; border-radius: 6px; border: 1px solid #d7dadd;
      background: #fff; color: #1f2328; font-size: 13px; cursor: pointer;
    }
    .act.primary { background: #00a6a7; border-color: #00a6a7; color: #fff; font-weight: 600; }
    .act:hover { opacity: .88; }

    .gear:hover,
    .gear.active { background: #f2f4f5; color: #00a6a7; }
    .view { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .view[hidden] { display: none; }
    .view-job .body { flex: 1; min-height: 0; }
    .history-list { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 12px; }
    .history-item {
      display: flex; align-items: stretch; margin-bottom: 6px;
      border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; background: #fff;
    }
    .history-main {
      flex: 1; min-width: 0; padding: 8px 10px; border: none; background: none;
      font: inherit; text-align: left; cursor: pointer;
    }
    .history-main:hover { background: #f6f7f8; }
    .history-title {
      color: #1f2328; font-size: 13px; font-weight: 600;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .history-meta {
      margin-top: 2px; color: #9ca3af; font-size: 12px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .history-del {
      flex: none; width: 30px; border: none; background: none;
      color: #9ca3af; font-size: 16px; line-height: 1; cursor: pointer;
    }
    .history-del:hover { background: #fff1f0; color: #b91c1c; }
    .history-empty {
      padding: 28px 18px; color: #9ca3af; font-size: 12px;
      line-height: 1.7; text-align: center;
    }
    .history-empty[hidden] { display: none; }
    .thread {
      flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px;
      display: flex; flex-direction: column; gap: 10px;
    }
    .msg { padding: 8px 10px; border-radius: 8px; line-height: 1.65; font-size: 13px; word-break: break-word; }
    .msg.user {
      align-self: flex-end; max-width: 88%; background: #00a6a7; color: #fff;
      white-space: pre-wrap;
    }
    .msg.bot {
      align-self: flex-start; max-width: 96%; background: #f6f7f8; color: #1f2328;
      white-space: pre-wrap;
    }
    .msg.err { background: #fff1f0; color: #b91c1c; }
    .think {
      margin-bottom: 6px; padding: 6px 8px; border-left: 2px solid #d1d5db;
      background: #fafafa; border-radius: 0 4px 4px 0; color: #6b7280;
      font-size: 12px; line-height: 1.55;
      white-space: pre-wrap;
    }
    .think[hidden] { display: none; }
    .think .tt {
      display: flex; align-items: center; gap: 4px; margin-bottom: 2px;
      color: #6b7280; font-size: 12px; font-weight: 600;
      cursor: pointer; user-select: none;
    }
    .think .tt:hover { color: #00a6a7; }
    .think .arr { flex: none; font-size: 10px; }
    .think .tb { max-height: 120px; overflow-y: auto; }
    .think.collapsed .tb { display: none; }
    .tool-note {
      margin-bottom: 6px; color: #6b7280; font-size: 12px;
      display: flex; align-items: center; gap: 4px;
    }
    .tool-note[hidden] { display: none; }
    .meta {
      display: flex; align-items: center; gap: 8px; margin-top: 6px;
      white-space: normal;
    }
    .meta[hidden] { display: none; }
    .copy {
      padding: 1px 8px; border: 1px solid #e0e2e5; border-radius: 10px;
      background: #fff; color: #6b7280; font: inherit; font-size: 12px;
      line-height: 18px; cursor: pointer;
    }
    .copy:hover { border-color: #00a6a7; color: #00a6a7; }
    .elapsed { color: #9ca3af; font-size: 12px; font-variant-numeric: tabular-nums; }
    .msg code {
      padding: 1px 4px; border-radius: 4px; background: #e9ecef;
      font-family: Consolas, Menlo, monospace; font-size: 12px;
    }
    .msg p { margin: 0 0 6px; }
    .msg p:last-child { margin-bottom: 0; }
    .msg .h { display: block; margin: 8px 0 4px; font-size: 13.5px; }
    .msg ul, .msg ol { margin: 4px 0 6px; padding-left: 20px; }
    .msg li { margin: 1px 0; }
    .msg blockquote { margin: 4px 0; padding: 2px 8px; border-left: 3px solid #d7dadd; color: #4b5563; }
    .msg hr { margin: 8px 0; border: none; border-top: 1px dashed #d7dadd; }
    .msg pre {
      margin: 6px 0; padding: 8px; border-radius: 6px; background: #eef0f2;
      overflow-x: auto; white-space: pre;
    }
    .msg pre code { padding: 0; background: none; }
    .msg a { color: #00a6a7; text-decoration: none; }
    .msg a:hover { text-decoration: underline; }
    .msg del { color: #9ca3af; }
    .msg table { margin: 6px 0; border-collapse: collapse; font-size: 12px; }
    .msg th, .msg td { padding: 3px 6px; border: 1px solid #e0e2e5; text-align: left; vertical-align: top; }
    .msg th { background: #eef0f2; font-weight: 600; }
    .quick { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 14px 8px; }
    .qchip {
      padding: 3px 8px; border: 1px solid #e5e7eb; border-radius: 12px;
      background: #fff; color: #4b5563; font-size: 12px; cursor: pointer;
    }
    .qchip:hover { border-color: #00a6a7; color: #00a6a7; }
    .composer {
      display: flex; gap: 8px; align-items: flex-end;
      padding: 8px 14px 12px; border-top: 1px solid #f0f1f2;
    }
    .composer textarea {
      flex: 1; min-width: 0; height: 52px; padding: 8px 10px; resize: none; font: inherit;
      line-height: 18px; color: inherit; background: #fff;
      border: 1px solid #d7dadd; border-radius: 8px; outline: none;
    }
    .composer textarea:focus { border-color: #00a6a7; }
    .send {
      flex: none; width: 60px; height: 52px; padding: 0; border: none; border-radius: 8px;
      background: #00a6a7; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
    }
    .send:hover { opacity: .9; }
  `;

  // src/shared/settings.js
  function getContentSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["deepseekApiKey", "resumeText", "customPrompt", "qccApiKey"], (items) => resolve(items || {}));
    });
  }

  // src/shared/session.js
  function request(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (result) => {
          void chrome.runtime.lastError;
          resolve(result || null);
        });
      } catch (err) {
        resolve(null);
      }
    });
  }
  function readSession(key) {
    return request({ type: MSG.SESSION, op: "get", key });
  }
  function writeSession(key, record) {
    return request({ type: MSG.SESSION, op: "set", key, record });
  }
  function clearSession(key) {
    return request({ type: MSG.SESSION, op: "clear", key });
  }
  function listSessions() {
    return request({ type: MSG.SESSION, op: "list" });
  }

  // src/content/ui/chat.js
  var activeBubble = null;
  var restoreToken = 0;
  var sessionOverride = "";
  var sessionMeta = null;
  function pageSessionKey() {
    const site = getAdapter();
    const jobId = site.getJobId ? site.getJobId() : "";
    return jobId ? site.getCanonicalUrl(jobId) : site.pageKey();
  }
  function sessionKey() {
    return sessionOverride || pageSessionKey();
  }
  function persistChat() {
    const key = sessionKey();
    if (!key) return;
    const data = runtime.lastData || {};
    const meta = sessionOverride && sessionMeta ? sessionMeta : data;
    writeSession(key, {
      title: meta.title || "",
      company: meta.company || "",
      url: meta.url || "",
      messages: runtime.chat.messages,
      updatedAt: Date.now()
    });
  }
  function renderMessages(messages) {
    runtime.ui.thread.textContent = "";
    messages.forEach((item) => {
      if (item.role === "user") {
        appendChatMessage("user", item.content);
        return;
      }
      const bubble = appendChatMessage("assistant", item.content);
      bubble.finalize(item.content);
    });
    runtime.threadPinned = true;
  }
  function resetChat() {
    restoreToken++;
    sessionOverride = "";
    sessionMeta = null;
    runtime.chat.messages = [];
    runtime.chat.greeted = false;
    runtime.ui.thread.textContent = "";
  }
  async function restoreChat() {
    if (!runtime.ui || runtime.chat.busy || runtime.chat.messages.length) return;
    const token = ++restoreToken;
    const key = sessionKey();
    const record = await readSession(key);
    if (token !== restoreToken || key !== sessionKey()) return;
    if (!record || !record.messages.length) return;
    runtime.chat.messages = record.messages.slice();
    renderMessages(record.messages);
    runtime.chat.greeted = true;
  }
  function newChat() {
    stopChat();
    const key = pageSessionKey();
    resetChat();
    if (key) clearSession(key);
    switchView("chat");
  }
  async function openHistorySession(key) {
    if (!runtime.ui || !key) return;
    stopChat();
    const record = await readSession(key);
    if (!record || !record.messages.length) return;
    restoreToken++;
    sessionOverride = key;
    sessionMeta = { title: record.title || "", company: record.company || "", url: record.url || "" };
    runtime.chat.messages = record.messages.slice();
    renderMessages(record.messages);
    runtime.chat.greeted = true;
    switchView("chat");
  }
  function buildSystemPrompt(data, resume, customPrompt) {
    const rules = (customPrompt || "").trim().slice(0, 2e3) || "回答要求：中文；先给结论再给要点；结合岗位原文和简历的具体内容，不要泛泛而谈；信息不足时明确说明；默认控制在 400 字以内，用户要求详细时再展开。";
    const lines = [
      `你是一名资深求职顾问，帮助用户分析下面这个${getAdapter().name}岗位，并给出具体、可执行的建议。`,
      "",
      "【岗位信息】",
      `职位：${data.title || "未知"}`,
      `公司：${data.company || "未知"}${data.companyScale ? `（${data.companyScale}）` : ""}`,
      `薪资：${data.salary || "未知"}`,
      `城市：${data.city || "未知"}`,
      `经验要求：${data.experience || "未知"}`,
      `学历要求：${data.degree || "未知"}`,
      data.tags.length ? `标签：${data.tags.join(" / ")}` : "",
      data.address ? `地址：${data.address}` : "",
      "",
      "【职位描述】",
      (data.description || "（未获取到职位描述）").slice(0, 4e3),
      "",
      "【求职者简历】",
      (resume || "").trim().slice(0, 4e3) || "（用户未填写简历）",
      "",
      rules
    ];
    return lines.join("\n");
  }
  function appendChatMessage(role, text, isError) {
    const el = document.createElement("div");
    el.className = `msg ${role === "user" ? "user" : "bot"}${isError ? " err" : ""}`;
    runtime.ui.thread.appendChild(el);
    const scrollIfPinned = () => {
      if (runtime.threadPinned) runtime.ui.thread.scrollTop = runtime.ui.thread.scrollHeight;
    };
    if (role === "user") {
      el.textContent = text;
      scrollIfPinned();
      return { set() {
      }, setThinking() {
      }, setNote() {
      }, finalize() {
      } };
    }
    const note = document.createElement("div");
    note.className = "tool-note";
    note.hidden = true;
    const think = document.createElement("div");
    think.className = "think";
    think.hidden = true;
    const thinkTitle = document.createElement("div");
    thinkTitle.className = "tt";
    const thinkArrow = document.createElement("span");
    thinkArrow.className = "arr";
    thinkArrow.textContent = "▾";
    const thinkLabel = document.createElement("span");
    thinkLabel.textContent = "思考过程";
    thinkTitle.append(thinkArrow, thinkLabel);
    const thinkBody = document.createElement("div");
    thinkBody.className = "tb";
    think.append(thinkTitle, thinkBody);
    let thinkTouched = false;
    thinkTitle.addEventListener("click", () => {
      thinkTouched = true;
      const collapsed = think.classList.toggle("collapsed");
      thinkArrow.textContent = collapsed ? "▸" : "▾";
    });
    const answer = document.createElement("div");
    answer.className = "answer";
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.hidden = true;
    const copyBtn = document.createElement("button");
    copyBtn.className = "copy";
    copyBtn.type = "button";
    copyBtn.textContent = "复制 Markdown";
    copyBtn.hidden = true;
    const timeEl = document.createElement("span");
    timeEl.className = "elapsed";
    meta.append(copyBtn, timeEl);
    el.append(note, think, answer, meta);
    let answerText = String(text || "");
    let thinkText = "";
    let frame = 0;
    let answerDirty = false;
    let thinkDirty = false;
    let startedAt = 0;
    let ticker = 0;
    let copyTimer = 0;
    copyBtn.addEventListener("click", async () => {
      if (!answerText.trim()) return;
      const ok = await copyText(answerText);
      copyBtn.textContent = ok ? "已复制" : "复制失败";
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        copyBtn.textContent = "复制 Markdown";
      }, 1200);
    });
    const tick = () => {
      if (!startedAt) return;
      timeEl.textContent = `用时 ${((Date.now() - startedAt) / 1e3).toFixed(1)}s`;
    };
    const stopTimer = () => {
      if (ticker) {
        clearInterval(ticker);
        ticker = 0;
      }
      if (startedAt) {
        tick();
        startedAt = 0;
      }
    };
    const render = () => {
      frame = 0;
      if (answerDirty) {
        answerDirty = false;
        answer.textContent = answerText;
      }
      if (thinkDirty) {
        thinkDirty = false;
        thinkBody.textContent = thinkText.length > 2e3 ? `…${thinkText.slice(-2e3)}` : thinkText;
      }
      scrollIfPinned();
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(render);
    };
    answer.innerHTML = formatMessage(answerText);
    scrollIfPinned();
    return {
      set(value, error) {
        el.classList.toggle("err", Boolean(error));
        answerText = String(value == null ? "" : value);
        answerDirty = true;
        schedule();
      },
      // 思考模式下的 reasoning_content，单独用浅色小块展示
      setThinking(value) {
        think.hidden = !value;
        if (!value) return;
        thinkText = String(value);
        thinkDirty = true;
        schedule();
      },
      // 工具调用状态提示
      setNote(value) {
        note.hidden = !value;
        note.textContent = value || "";
        scrollIfPinned();
      },
      // 回答开始输出时自动收起思考过程（用户手动展开/收起过则不干预）
      collapseThinking() {
        if (thinkTouched || think.hidden) return;
        think.classList.add("collapsed");
        thinkArrow.textContent = "▸";
      },
      // 计时：从发出请求到大模型返回结束
      startTimer() {
        meta.hidden = false;
        startedAt = Date.now();
        tick();
        ticker = setInterval(tick, 100);
      },
      stopTimer,
      // 流式结束后一次性渲染 Markdown
      finalize(value, error) {
        el.classList.toggle("err", Boolean(error));
        if (value !== void 0) answerText = String(value == null ? "" : value);
        if (frame) {
          cancelAnimationFrame(frame);
          frame = 0;
        }
        answerDirty = false;
        answer.innerHTML = formatMessage(answerText);
        stopTimer();
        meta.hidden = !(timeEl.textContent || answerText.trim());
        copyBtn.hidden = !answerText.trim();
        scrollIfPinned();
      }
    };
  }
  function buildChatView() {
    const view = document.createElement("div");
    view.className = "view view-chat";
    view.hidden = true;
    const thread = document.createElement("div");
    thread.className = "thread";
    thread.addEventListener("scroll", () => {
      runtime.threadPinned = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 48;
    }, { passive: true });
    const input = document.createElement("textarea");
    input.placeholder = "就这个岗位提问，Enter 发送，Shift+Enter 换行";
    const quick = document.createElement("div");
    quick.className = "quick";
    ["评估我的岗位匹配度", "写一段打招呼话术", "这份 JD 有哪些风险信号"].forEach((prompt) => {
      const chip = document.createElement("button");
      chip.className = "qchip";
      chip.type = "button";
      chip.textContent = prompt;
      chip.addEventListener("click", () => {
        sendChat(prompt);
      });
      quick.appendChild(chip);
    });
    const composer = document.createElement("div");
    composer.className = "composer";
    const send = document.createElement("button");
    send.className = "send";
    send.type = "button";
    send.textContent = "发送";
    composer.append(input, send);
    view.append(thread, quick, composer);
    return { view, thread, input, send };
  }
  function stopChat() {
    if (activeBubble) {
      activeBubble.stopTimer();
      activeBubble = null;
    }
    if (runtime.chat.port) {
      try {
        runtime.chat.port.disconnect();
      } catch (e) {
      }
      runtime.chat.port = null;
    }
    runtime.chat.busy = false;
    runtime.ui.send.textContent = "发送";
  }
  function switchView(name) {
    const isChat = name === "chat";
    runtime.ui.viewJob.hidden = name !== "job";
    runtime.ui.viewChat.hidden = !isChat;
    if (runtime.ui.viewHistory) runtime.ui.viewHistory.hidden = name !== "history";
    runtime.ui.jd.title = name === "job" ? "返回 AI 对话" : "查看岗位信息";
    runtime.ui.jd.classList.toggle("active", name === "job");
    const icons = runtime.ui.icons;
    if (icons) {
      runtime.ui.jd.innerHTML = name === "job" ? icons.back : icons.notes;
      if (runtime.ui.history) {
        runtime.ui.history.classList.toggle("active", name === "history");
        runtime.ui.history.innerHTML = name === "history" ? icons.back : icons.history;
      }
    }
    if (isChat && !runtime.chat.greeted) {
      runtime.chat.greeted = true;
      appendChatMessage("assistant", "我会结合当前岗位和你填写的简历回答。可以直接提问，或点下面的快捷问题。");
    }
    if (isChat) runtime.ui.input.focus();
  }
  async function sendChat(textArg) {
    if (runtime.chat.busy) return;
    const text = String(textArg !== void 0 ? textArg : runtime.ui.input.value).trim();
    if (!text) return;
    const settings = await getContentSettings();
    if (!settings.deepseekApiKey) {
      appendChatMessage("assistant", "还没有配置 DeepSeek API Key。点右上角 ⚙ 打开设置页填写后再试。", true);
      return;
    }
    if (textArg === void 0) runtime.ui.input.value = "";
    appendChatMessage("user", text);
    runtime.chat.messages.push({ role: "user", content: text });
    persistChat();
    runtime.chat.busy = true;
    runtime.ui.send.textContent = "停止";
    const bubble = appendChatMessage("assistant", "");
    activeBubble = bubble;
    if (!runtime.lastData) {
      bubble.set("正在读取当前岗位信息…");
      try {
        runtime.lastData = await extractWithRetry();
      } catch (err) {
        bubble.set("读取岗位信息失败，请刷新页面后重试。", true);
        stopChat();
        return;
      }
      if (!runtime.chat.busy) return;
    }
    const messages = [
      { role: "system", content: buildSystemPrompt(runtime.lastData, settings.resumeText, settings.customPrompt) },
      ...runtime.chat.messages.slice(-10)
    ];
    try {
      runtime.chat.port = chrome.runtime.connect({ name: PORT_AI_CHAT });
    } catch (err) {
      bubble.set("扩展已更新，请刷新页面后重试。", true);
      stopChat();
      return;
    }
    bubble.set("正在思考…");
    const port = runtime.chat.port;
    let answer = "";
    let reasoning = "";
    let errored = "";
    port.onMessage.addListener((message) => {
      if (!message) return;
      if (message.type === "reasoning") {
        reasoning += message.text;
        if (!answer) bubble.set("");
        bubble.setThinking(reasoning);
      } else if (message.type === "tool") {
        if (message.status === "running") bubble.setNote("正在查询企业年报…");
        else bubble.setNote(message.error ? "企业年报查询失败" : "已获取企业年报数据");
      } else if (message.type === "delta") {
        answer += message.text;
        bubble.collapseThinking();
        bubble.set(answer);
      } else if (message.type === "notice") {
        bubble.setNote(message.message || "");
      } else if (message.type === "error") {
        errored = message.message || "请求失败";
        bubble.set(answer ? `${answer}

[请求中断：${errored}]` : errored, !answer);
        bubble.stopTimer();
        stopChat();
      } else if (message.type === "done") {
        if (!answer.trim()) {
          bubble.finalize(errored || "（没有返回内容）", true);
        } else {
          bubble.finalize(answer);
          if (!errored) {
            runtime.chat.messages.push({ role: "assistant", content: answer });
            persistChat();
          }
        }
        stopChat();
      }
    });
    port.onDisconnect.addListener(() => {
      if (runtime.chat.busy) {
        if (!answer.trim()) bubble.set("连接已断开，请重试。", true);
        bubble.stopTimer();
        stopChat();
      }
    });
    bubble.startTimer();
    try {
      port.postMessage({ type: "chat", messages });
    } catch (err) {
      bubble.set("连接已断开，请重试。", true);
      bubble.stopTimer();
      stopChat();
    }
  }
  async function queryCompany() {
    if (runtime.chat.busy) return;
    switchView("chat");
    const settings = await getContentSettings();
    if (!settings.deepseekApiKey) {
      appendChatMessage("assistant", "还没有配置 DeepSeek API Key。点右上角 ⚙ 打开设置页填写后再试。", true);
      return;
    }
    if (!settings.qccApiKey) {
      appendChatMessage("assistant", "还没有配置企查查 API Key。点右上角 ⚙ 打开设置页填写后再试。", true);
      return;
    }
    if (!runtime.lastData) runtime.lastData = await extractWithRetry();
    const company = (runtime.lastData && runtime.lastData.company || "").trim();
    if (!company) {
      appendChatMessage("assistant", "还没有提取到公司名称，先点右下角的「AI 岗位助手」重新提取再试。", true);
      return;
    }
    sendChat(`请调用企业年报工具查询「${company}」最近三年的工商年报，提取每年的从业人数；
若从业人数为“企业选择不公示”或为空，则改用社保参保人数作为替代，并注明口径。
只返回近三年的年度和人数，不需要趋势分析和额外判断。`);
  }

  // src/content/ui/history.js
  function formatTime(ts) {
    if (!ts) return "";
    const date = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    const now = /* @__PURE__ */ new Date();
    const sameDay = date.toDateString() === now.toDateString();
    return sameDay ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  function buildHistoryView() {
    const view = document.createElement("div");
    view.className = "view view-history";
    view.hidden = true;
    const list = document.createElement("div");
    list.className = "history-list";
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "暂无历史会话。发起一次对话后，会按岗位保存在这里。";
    empty.hidden = true;
    view.append(empty, list);
    return { view, list, empty };
  }
  async function renderHistory(ui) {
    ui.list.textContent = "";
    ui.empty.hidden = true;
    const sessions = await listSessions();
    const items = (sessions || []).filter((item) => item.count > 0);
    ui.empty.hidden = items.length > 0;
    if (!items.length) return;
    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "history-item";
      const main = document.createElement("button");
      main.className = "history-main";
      main.type = "button";
      main.title = item.url || item.title || "打开会话";
      const title = document.createElement("div");
      title.className = "history-title";
      title.textContent = item.title || "未识别到岗位名称";
      const meta = document.createElement("div");
      meta.className = "history-meta";
      meta.textContent = [item.company, formatTime(item.updatedAt), `${item.count} 条消息`].filter(Boolean).join(" · ");
      main.append(title, meta);
      main.addEventListener("click", () => {
        openHistorySession(item.key);
      });
      const del = document.createElement("button");
      del.className = "history-del";
      del.type = "button";
      del.title = "删除该会话";
      del.textContent = "×";
      del.addEventListener("click", async () => {
        await clearSession(item.key);
        renderHistory(ui);
      });
      row.append(main, del);
      ui.list.appendChild(row);
    });
  }

  // src/content/ui/panel.js
  var BACK_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M15.75,3 C19.7140238,3 22.9350055,6.18134145 22.9990287,10.130108 L23,10.25 L23,10.5 C23,14.4640238 19.8186586,17.6850055 15.869892,17.7490287 L15.75,17.75 L13.8105,17.75 L9.78033009,21.7803301 C9.4991526,22.0615076 9.05026186,22.0727547 8.75566731,21.8140714 L8.71966991,21.7803301 C8.43849242,21.4991526 8.42724532,21.0502619 8.68592862,20.7556673 L8.71966991,20.7196699 L12.9696699,16.4696699 C13.0986012,16.3407387 13.2696414,16.2635976 13.4504659,16.2516361 L13.5,16.25 L15.75,16.25 C18.8938809,16.25 21.4484526,13.7268671 21.4992297,10.5950868 L21.5,10.5 L21.5,10.25 C21.5,7.10611906 18.9768671,4.55154738 15.8450868,4.50077034 L15.75,4.5 L8.25,4.5 C5.10611906,4.5 2.55154738,7.02313287 2.50077034,10.1549132 L2.5,10.25 L2.5,10.5 C2.5,13.6438809 5.02313287,16.1984526 8.15491324,16.2492297 L8.25,16.25 L9.25,16.25 C9.66421356,16.25 10,16.5857864 10,17 C10,17.3994202 9.68777001,17.7259152 9.2940682,17.7487268 L9.25,17.75 L8.25,17.75 C4.28597621,17.75 1.06499452,14.5686586 1.00097129,10.619892 L1,10.5 L1,10.25 C1,6.28597621 4.18134145,3.06499452 8.13010799,3.00097129 L8.25,3 L15.75,3 Z"></path></svg>';
  function addRow(container, label, value) {
    if (!value) return;
    const row = document.createElement("div");
    row.className = "row";
    const name = document.createElement("b");
    name.textContent = label;
    const content = document.createElement("span");
    content.textContent = value;
    row.append(name, content);
    container.appendChild(row);
  }
  function renderPanel(data) {
    const body = runtime.ui.body;
    body.textContent = "";
    addRow(body, "公司", data.company);
    addRow(body, "规模", data.companyScale);
    addRow(body, "薪资", data.salary);
    addRow(body, "城市", data.city);
    addRow(body, "经验", data.experience);
    addRow(body, "学历", data.degree);
    addRow(body, "HR", data.hr);
    addRow(body, "地址", data.address);
    if (data.tags.length) {
      const chips = document.createElement("div");
      chips.className = "chips";
      data.tags.forEach((tag) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = tag;
        chips.appendChild(chip);
      });
      body.appendChild(chips);
    }
    const desc = document.createElement("div");
    desc.className = "desc";
    desc.textContent = data.description || "（未提取到职位描述，可刷新页面后重试）";
    body.appendChild(desc);
    const missing = [];
    if (!data.title) missing.push("职位名称");
    if (!data.company) missing.push("公司名称");
    if (!data.description) missing.push("职位描述");
    if (missing.length) {
      const warn = document.createElement("div");
      warn.className = "warn";
      warn.textContent = `未提取到：${missing.join("、")}。页面可能未加载完成，或站点结构已改版。`;
      body.appendChild(warn);
    }
    runtime.ui.title.textContent = data.title || "未识别到职位名称";
    runtime.ui.panel.hidden = false;
  }
  async function copyCurrent(kind) {
    if (!runtime.lastData) return;
    const btn = kind === "json" ? runtime.ui.btnJson : runtime.ui.btnMd;
    const text = kind === "json" ? JSON.stringify(runtime.lastData, null, 2) : toMarkdown(runtime.lastData);
    const ok = await copyText(text);
    if (!btn) return;
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.textContent = ok ? "已复制" : "复制失败";
    clearTimeout(Number(btn.dataset.timer) || 0);
    btn.dataset.timer = setTimeout(() => {
      btn.textContent = btn.dataset.label;
    }, 1200);
  }
  async function onExtract(options = {}) {
    if (runtime.extracting) return;
    runtime.extracting = true;
    runtime.ui.trigger.disabled = true;
    runtime.ui.trigger.textContent = "提取中…";
    try {
      runtime.lastData = await extractWithRetry();
      renderPanel(runtime.lastData);
      switchView("chat");
      if (options.copyJson) await copyCurrent("json");
    } catch (err) {
      runtime.lastData = null;
      runtime.ui.panel.hidden = false;
      runtime.ui.body.textContent = "";
      addRow(runtime.ui.body, "错误", "提取失败，页面结构可能已改版，请刷新后重试。");
      console.warn("[岗位提取] 失败：", err);
    } finally {
      runtime.extracting = false;
      runtime.ui.trigger.disabled = false;
      runtime.ui.trigger.textContent = "AI 岗位助手";
    }
  }
  function buildUI() {
    const wrap = document.createElement("div");
    wrap.className = "wrap";
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.hidden = true;
    const head = document.createElement("div");
    head.className = "head";
    const title = document.createElement("h2");
    title.textContent = "岗位信息";
    const closeBtn = document.createElement("button");
    closeBtn.className = "close";
    closeBtn.type = "button";
    closeBtn.title = "关闭";
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M5.63603897,19.7781746 C5.24551468,20.1686989 4.6123497,20.1686989 4.2218254,19.7781746 C3.83130111,19.3876503 3.83130111,18.7544853 4.2218254,18.363961 L10.5857864,12 L4.2218254,5.63603897 C3.83130111,5.24551468 3.83130111,4.6123497 4.2218254,4.22182541 C4.61234969,3.83130112 5.24551467,3.83130112 5.63603896,4.22182541 L12,10.5857864 L18.363961,4.22182541 C18.7544853,3.83130112 19.3876503,3.83130112 19.7781746,4.22182541 C20.1686989,4.6123497 20.1686989,5.24551468 19.7781746,5.63603897 L5.63603897,19.7781746 Z M19.7781746,18.363961 C20.1686989,18.7544853 20.1686989,19.3876503 19.7781746,19.7781746 C19.3876503,20.1686989 18.7544853,20.1686989 18.363961,19.7781746 L12.7071068,14.1213203 L14.1213203,12.7071068 L19.7781746,18.363961 Z"></path></svg>';
    const newChatBtn = document.createElement("button");
    newChatBtn.className = "gear";
    newChatBtn.type = "button";
    newChatBtn.title = "新建对话";
    newChatBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12,2 C12.5522847,2 13,2.44771525 13,3 L13,21 C13,21.5522847 12.5522847,22 12,22 C11.4477153,22 11,21.5522847 11,21 L11,13 L3,13 C2.44771525,13 2,12.5522847 2,12 C2,11.4477153 2.44771525,11 3,11 L11,11 L11,3 C11,2.44771525 11.4477153,2 12,2 Z M21,11 C21.5522847,11 22,11.4477153 22,12 C22,12.5522847 21.5522847,13 21,13 L13.999,13 L13.999,11 L21,11 Z"></path></svg>';
    const historyBtn = document.createElement("button");
    historyBtn.className = "gear";
    historyBtn.type = "button";
    historyBtn.title = "历史会话";
    historyBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M11.7813297,16.4440304 C12.2586045,16.7563662 12.8199547,16.952723 13.4246824,16.9925018 L13.6534091,17 L14.9090909,17 L14.9607367,17.0017785 C15.1115046,17.0121778 15.2551766,17.067876 15.373167,17.1608147 L15.4565541,17.2373754 L17.7974632,19.7373754 L17.8288053,19.7730063 C18.0539391,20.0456617 18.0557142,20.4368446 17.8418783,20.7108072 L17.7626246,20.7974632 L17.7269937,20.8288053 C17.4543383,21.0539391 17.0631554,21.0557142 16.7891928,20.8418783 L16.7025368,20.7626246 L14.58425,18.5 L13.567193,18.4992614 C12.4934607,18.4808506 11.5035477,18.1192079 10.7039791,17.5198057 L11.7813297,16.4440304 Z M20.0009632,9.1313553 C21.762715,9.87025897 23,11.6033984 23,13.625 C23,16.2457463 20.9206452,18.3817094 18.3149199,18.4952526 L18.0965909,18.5 L18,18.5 L17.9559318,18.4987268 C17.56223,18.4759152 17.25,18.1494202 17.25,17.75 C17.25,17.3703042 17.5321539,17.056509 17.8982294,17.0068466 L18,17 L18.1747471,16.999128 C20.0193908,16.9579269 21.5,15.4619321 21.5,13.625 C21.5,12.3860476 20.8264598,11.30219 19.8219676,10.7151816 C19.921098,10.2797857 19.9805168,9.82902884 19.9959563,9.36723755 L20.0009632,9.1313553 Z M12.875,3 C16.2577441,3 19,5.74225591 19,9.125 C19,12.432572 16.3782679,15.1278057 13.0995443,15.2459605 L12.875,15.25 L11.56,15.25 L8.53033009,18.2803301 C8.26406352,18.5465966 7.84739984,18.5708027 7.55378835,18.3529482 L7.46966991,18.2803301 C7.20340335,18.0140635 7.1791973,17.5973998 7.39705176,17.3037883 L7.46966991,17.2196699 L10.7196699,13.9696699 C10.8321917,13.8571481 10.976786,13.7840724 11.1319659,13.7593431 L11.25,13.75 L12.875,13.75 C15.429317,13.75 17.5,11.679317 17.5,9.125 C17.5,6.64163628 15.5427572,4.61541112 13.0867062,4.50475923 L12.875,4.5 L7.125,4.5 C4.57068303,4.5 2.5,6.57068303 2.5,9.125 C2.5,11.6083637 4.45724284,13.6345889 6.91329379,13.7452408 L7.125,13.75 L7.25,13.75 C7.66421356,13.75 8,14.0857864 8,14.5 C8,14.8796958 7.71784612,15.193491 7.35177056,15.2431534 L7.25,15.25 L7.125,15.25 C3.74225591,15.25 1,12.5077441 1,9.125 C1,5.817428 3.62173207,3.12219433 6.90045566,3.00403954 L7.125,3 L12.875,3 Z"></path></svg>';
    const jdBtn = document.createElement("button");
    jdBtn.className = "gear";
    jdBtn.type = "button";
    jdBtn.title = "查看岗位信息";
    jdBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M15.8722296,1 C17.6173301,1 18.2738114,1.17783521 18.91208,1.51223497 L18.9536914,1.53426541 C19.5745027,1.86627892 20.0680807,2.34610464 20.4148264,2.9541436 L20.4657346,3.04630859 C20.8143488,3.69816044 21,4.34473292 21,6.1277704 L21,17.8722296 L20.9989932,18.0937657 C20.9842401,19.674381 20.8076257,20.3015622 20.487765,20.91208 L20.4657346,20.9536914 C20.1337211,21.5745027 19.6538954,22.0680807 19.0458564,22.4148264 L18.9536914,22.4657346 C18.3018396,22.8143488 17.6552671,23 15.8722296,23 L8.1277704,23 L7.90623426,22.9989932 C6.32561899,22.9842401 5.69843783,22.8076257 5.08791999,22.487765 L5.04630859,22.4657346 C4.42549731,22.1337211 3.93191931,21.6538954 3.58517358,21.0458564 L3.53426541,20.9536914 C3.18565122,20.3018396 3,19.6552671 3,17.8722296 L3,6.1277704 C3,4.38266989 3.17783521,3.72618864 3.51223497,3.08791999 L3.53426541,3.04630859 C3.86627892,2.42549731 4.34610464,1.93191931 4.9541436,1.58517358 L5.04630859,1.53426541 C5.69816044,1.18565122 6.34473292,1 8.1277704,1 L15.8722296,1 Z M16.0753381,2.50070655 L8.02453833,2.50017541 L7.82305804,2.501658 C6.6550816,2.5151767 6.20981608,2.61305534 5.75370688,2.8569852 C5.36325774,3.06579969 5.06579969,3.36325774 4.8569852,3.75370688 C4.59290159,4.24750032 4.5,4.72858421 4.5,6.1277704 L4.50017541,17.9754617 L4.501658,18.176942 C4.5151767,19.3449184 4.61305534,19.7901839 4.8569852,20.2462931 C5.06579969,20.6367423 5.36325774,20.9342003 5.75370688,21.1430148 C6.22281064,21.3938942 6.68044405,21.4902819 7.92466189,21.4992935 L8.1277704,21.5 L15.8722296,21.5 C17.2714158,21.5 17.7524997,21.4070984 18.2462931,21.1430148 C18.6367423,20.9342003 18.9342003,20.6367423 19.1430148,20.2462931 C19.3938942,19.7771894 19.4902819,19.319556 19.4992935,18.0753381 L19.5,17.8722296 L19.5,6.1277704 C19.5,4.72858421 19.4070984,4.24750032 19.1430148,3.75370688 C18.9342003,3.36325774 18.6367423,3.06579969 18.2462931,2.8569852 C17.7771894,2.60610577 17.319556,2.50971811 16.0753381,2.50070655 Z M12,16.25 C12.4142136,16.25 12.75,16.5857864 12.75,17 C12.75,17.4142136 12.4142136,17.75 12,17.75 L7.5,17.75 C7.08578644,17.75 6.75,17.4142136 6.75,17 C6.75,16.5857864 7.08578644,16.25 7.5,16.25 L12,16.25 Z M16.5,11.25 C16.9142136,11.25 17.25,11.5857864 17.25,12 C17.25,12.4142136 16.9142136,12.75 16.5,12.75 L7.5,12.75 C7.08578644,12.75 6.75,12.4142136 6.75,12 C6.75,11.5857864 7.08578644,11.25 7.5,11.25 L16.5,11.25 Z M16.5,6.25 C16.9142136,6.25 17.25,6.58578644 17.25,7 C17.25,7.41421356 16.9142136,7.75 16.5,7.75 L7.5,7.75 C7.08578644,7.75 6.75,7.41421356 6.75,7 C6.75,6.58578644 7.08578644,6.25 7.5,6.25 L16.5,6.25 Z"></path></svg>';
    const icons = { history: historyBtn.innerHTML, notes: jdBtn.innerHTML, back: BACK_ICON };
    const queryBtn = document.createElement("button");
    queryBtn.className = "gear";
    queryBtn.type = "button";
    queryBtn.title = "查询企业年报";
    queryBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M17.6179267,16.3277876 L20.8132621,19.5240485 C21.2037864,19.9145728 21.2037864,20.5477378 20.8132621,20.9382621 C20.4227378,21.3287864 19.7895728,21.3287864 19.3990485,20.9382621 L16.189979,17.729164 C16.7142906,17.3140255 17.1931651,16.8440081 17.6179267,16.3277876 Z M10.375,2 C15.0003848,2 18.75,5.74961522 18.75,10.375 C18.75,12.5107968 17.9505141,14.4598636 16.6344856,15.9392571 L16.8468572,15.6909887 C16.7564149,15.8009681 16.6632239,15.9086017 16.5673893,16.0137845 C16.4969337,16.0911028 16.4254201,16.1667191 16.3525335,16.240983 C16.338412,16.2553719 16.3241207,16.2698289 16.3097773,16.2842339 C16.2403031,16.3540107 16.1694244,16.4227398 16.0973523,16.4902097 C16.0802283,16.506238 16.063454,16.5218113 16.046616,16.5373165 C15.9709789,16.6069739 15.8937108,16.6755519 15.8151858,16.7427027 C15.8023252,16.7537003 15.7894477,16.7646456 15.7765366,16.7755526 L15.7332842,16.8118433 C14.2811297,18.021995 12.4130822,18.75 10.375,18.75 C5.74961522,18.75 2,15.0003848 2,10.375 C2,5.74961522 5.74961522,2 10.375,2 Z M10.375,4 C6.85418472,4 4,6.85418472 4,10.375 C4,13.8958153 6.85418472,16.75 10.375,16.75 C13.8958153,16.75 16.75,13.8958153 16.75,10.375 C16.75,6.85418472 13.8958153,4 10.375,4 Z"></path></svg>';
    const gearBtn = document.createElement("button");
    gearBtn.className = "gear";
    gearBtn.type = "button";
    gearBtn.title = "AI 设置";
    gearBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M13.4894964,1.25 C14.1901033,1.25 14.8231865,1.66785112 15.0986042,2.31205231 L15.0986042,2.31205231 L15.92125,4.23625 L16.77175,4.72725 L18.8556101,4.47607817 C19.5285537,4.39491431 20.1856012,4.70961774 20.5451004,5.27951678 L20.5451004,5.27951678 L20.5800481,5.33735213 L22.0680131,7.91013134 C22.4194652,8.51781272 22.3737758,9.27669833 21.9519545,9.83782407 L21.9519545,9.83782407 L20.69375,11.51125 L20.69375,12.4885 L21.9519801,14.16219 C22.3597241,14.70461 22.4160026,15.4318142 22.1018413,16.0285992 L22.1018413,16.0285992 L22.0680196,16.0898574 L20.5800481,18.6626479 C20.2293867,19.2689622 19.5509852,19.6077912 18.8556101,19.5239218 L18.8556101,19.5239218 L16.77175,19.2725 L15.92125,19.7635 L15.0986042,21.6879477 C14.832071,22.3113682 14.2305752,22.7228063 13.5570765,22.748702 L13.5570765,22.748702 L13.4894964,22.75 L10.5105451,22.75 C9.80990141,22.75 9.17679241,22.3321056 8.90139751,21.6878548 L8.90139751,21.6878548 L8.0785,19.7635 L7.228,19.2725 L5.14438986,19.5239218 C4.47144629,19.6050857 3.81439883,19.2903823 3.45489956,18.7204832 L3.45489956,18.7204832 L3.41995189,18.6626479 L1.9319804,16.0898574 C1.58053408,15.482186 1.62621577,14.7233142 2.04801988,14.16219 L2.04801988,14.16219 L3.306,12.4885 L3.306,11.51125 L2.04804545,9.83782407 C1.64028496,9.29540252 1.58399872,8.56818536 1.89816473,7.97139057 L1.89816473,7.97139057 L1.93198692,7.91013134 L3.41995189,5.33735213 C3.77061333,4.73103782 4.44901483,4.39220884 5.14438986,4.47607817 L5.14438986,4.47607817 L7.228,4.72725 L8.0785,4.23625 L8.90139751,2.31214525 C9.1679087,1.68867667 9.7694279,1.27719647 10.4429614,1.25129813 L10.4429614,1.25129813 L10.5105451,1.25 Z M13.4894964,2.75 L10.5105451,2.75 C10.4104531,2.75 10.320009,2.8096992 10.2806668,2.90173504 L10.2806668,2.90173504 L9.42547944,4.90233575 C9.31921851,5.1509195 9.13523096,5.35835416 8.90110986,5.49353025 L8.90110986,5.49353025 L7.90597116,6.06810022 C7.67169142,6.20336791 7.39985123,6.25898058 7.13127161,6.22658714 L7.13127161,6.22658714 L4.96477622,5.96528566 C4.86543693,5.95330433 4.76852243,6.00170847 4.71842794,6.0883248 L4.71842794,6.0883248 L3.23046296,8.66110401 C3.18025552,8.74791564 3.18678258,8.85632787 3.24704275,8.93648869 L3.24704275,8.93648869 L4.55532037,10.6768191 C4.71812619,10.8933908 4.80615731,11.1569971 4.80615595,11.4279382 L4.80615595,11.4279382 L4.80615019,12.5719965 C4.80614882,12.8429255 4.71812287,13.1065199 4.55532821,13.3230849 L4.55532821,13.3230849 L3.24703351,15.0635037 C3.18677578,15.1436643 3.18024983,15.2520745 3.23045644,15.3388847 L3.23045644,15.3388847 L4.71842794,17.9116752 C4.76852243,17.9982915 4.86543693,18.0466957 4.96477622,18.0347143 L4.96477622,18.0347143 L7.13127161,17.7734129 C7.39985123,17.7410194 7.67169142,17.7966321 7.90597116,17.9318998 L7.90597116,17.9318998 L8.90110986,18.5064697 C9.13523096,18.6416458 9.31921851,18.8490805 9.42547944,19.0976643 L9.42547944,19.0976643 L10.2806668,21.098265 C10.320009,21.1903008 10.4104531,21.25 10.5105451,21.25 L10.5105451,21.25 L13.4894964,21.25 C13.5895831,21.25 13.6800236,21.190307 13.7193689,21.0982782 L13.7193689,21.0982782 L14.5747715,19.097494 C14.6810343,18.8489455 14.8650036,18.6415401 15.0990951,18.506376 L15.0990951,18.506376 L16.0940158,17.9319104 C16.3282993,17.7966355 16.6001464,17.7410191 16.8687329,17.7734134 L16.8687329,17.7734134 L19.0352238,18.0347143 C19.1345631,18.0466957 19.2314776,17.9982915 19.2815721,17.9116752 L19.2815721,17.9116752 L20.7695436,15.3388847 C20.8197502,15.2520745 20.8132242,15.1436643 20.7529665,15.0635037 L20.7529665,15.0635037 L19.4446718,13.3230849 C19.2818771,13.1065199 19.1938512,12.8429255 19.1938498,12.5719965 L19.1938498,12.5719965 L19.1938441,11.4279382 C19.1938427,11.1569971 19.2818738,10.8933908 19.4446796,10.6768191 L19.4446796,10.6768191 L20.7529572,8.93648869 C20.8132174,8.85632787 20.8197445,8.74791564 20.769537,8.66110401 L20.769537,8.66110401 L19.2815721,6.0883248 C19.2314776,6.00170847 19.1345631,5.95330433 19.0352238,5.96528566 L19.0352238,5.96528566 L16.8687329,6.2265866 C16.6001464,6.25898087 16.3282993,6.2033645 16.0940158,6.06808955 L16.0940158,6.06808955 L15.0990951,5.49362397 C14.8650036,5.3584599 14.6810343,5.15105452 14.5747715,4.90250599 L14.5747715,4.90250599 L13.7193689,2.90172176 C13.6800236,2.80969302 13.5895831,2.75 13.4894964,2.75 L13.4894964,2.75 Z M12,7.5 C14.4852814,7.5 16.5,9.51471863 16.5,12 C16.5,14.4852814 14.4852814,16.5 12,16.5 C9.51471863,16.5 7.5,14.4852814 7.5,12 C7.5,9.51471863 9.51471863,7.5 12,7.5 Z M12,9 C10.3431458,9 9,10.3431458 9,12 C9,13.6568542 10.3431458,15 12,15 C13.6568542,15 15,13.6568542 15,12 C15,10.3431458 13.6568542,9 12,9 Z"></path></svg>';
    const actions = document.createElement("div");
    actions.className = "head-actions";
    actions.append(newChatBtn, historyBtn, jdBtn, queryBtn, gearBtn, closeBtn);
    head.append(title, actions);
    const body = document.createElement("div");
    body.className = "body";
    const foot = document.createElement("div");
    foot.className = "foot";
    const btnMd = document.createElement("button");
    btnMd.className = "act primary";
    btnMd.type = "button";
    btnMd.textContent = "复制 Markdown";
    const btnJson = document.createElement("button");
    btnJson.className = "act";
    btnJson.type = "button";
    btnJson.textContent = "复制 JSON";
    foot.append(btnMd, btnJson);
    const viewJob = document.createElement("div");
    viewJob.className = "view view-job";
    viewJob.hidden = true;
    viewJob.append(body, foot);
    const historyView = buildHistoryView();
    const chatView = buildChatView();
    chatView.view.hidden = false;
    panel.append(head, viewJob, historyView.view, chatView.view);
    const trigger = document.createElement("button");
    trigger.className = "trigger";
    trigger.type = "button";
    trigger.textContent = "AI 岗位助手";
    wrap.append(panel, trigger);
    runtime.ui = {
      panel,
      title,
      body,
      trigger,
      jd: jdBtn,
      btnMd,
      btnJson,
      viewJob,
      viewChat: chatView.view,
      viewHistory: historyView.view,
      history: historyBtn,
      icons,
      thread: chatView.thread,
      input: chatView.input,
      send: chatView.send
    };
    closeBtn.addEventListener("click", () => {
      panel.hidden = true;
    });
    newChatBtn.addEventListener("click", () => newChat());
    historyBtn.addEventListener("click", () => {
      if (!historyView.view.hidden) {
        switchView("chat");
        return;
      }
      switchView("history");
      renderHistory(historyView);
    });
    trigger.addEventListener("click", onExtract);
    jdBtn.addEventListener("click", () => switchView(runtime.ui.viewJob.hidden ? "job" : "chat"));
    gearBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: MSG.OPEN_OPTIONS }, () => void chrome.runtime.lastError);
    });
    queryBtn.addEventListener("click", () => queryCompany());
    chatView.send.addEventListener("click", () => {
      if (runtime.chat.busy) stopChat();
      else sendChat();
    });
    chatView.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (!runtime.chat.busy) sendChat();
      }
    });
    btnMd.addEventListener("click", () => copyCurrent("markdown"));
    btnJson.addEventListener("click", () => copyCurrent("json"));
    return wrap;
  }
  function mount() {
    const existing = document.getElementById(HOST_ID);
    if (existing) existing.remove();
    runtime.host = document.createElement("div");
    runtime.host.id = HOST_ID;
    runtime.host.style.cssText = "all: initial";
    const shadow = runtime.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS;
    shadow.appendChild(style);
    shadow.appendChild(buildUI());
    runtime.chat.greeted = false;
    runtime.threadPinned = true;
    document.documentElement.appendChild(runtime.host);
  }

  // src/content/index.js
  function checkPage() {
    if (!runtime.ui || !document.getElementById(HOST_ID)) {
      mount();
      restoreChat();
      return;
    }
    const key = getAdapter().pageKey();
    if (key === runtime.lastPageKey) return;
    runtime.lastPageKey = key;
    runtime.lastData = null;
    runtime.ui.panel.hidden = true;
    resetChat();
    restoreChat();
  }
  function init() {
    mount();
    runtime.lastPageKey = getAdapter().pageKey();
    restoreChat();
    let timer = 0;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(checkPage, 250);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("popstate", schedule);
    window.addEventListener("bz:locationchange", schedule);
    window.addEventListener("pagehide", () => {
      observer.disconnect();
      clearTimeout(timer);
      stopChat();
    }, { once: true });
  }
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== MSG.EXTRACT) return;
    if (!runtime.ui || !document.getElementById(HOST_ID)) mount();
    onExtract({ copyJson: true });
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
