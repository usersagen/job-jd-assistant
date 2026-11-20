import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMeta, parseCompanyInfo, resolveSalary } from '../src/content/sites/base.js';
import { stubDom } from './support.mjs';

test('parseMeta：识别城市、经验、学历', () => {
  assert.deepEqual(parseMeta('上海 3-5年 本科'), {
    city: '上海',
    experience: '3-5年',
    degree: '本科'
  });
});

test('parseMeta：带「·」的城市直接识别', () => {
  assert.deepEqual(parseMeta('北京·朝阳区 1-3年 大专'), {
    city: '北京·朝阳区',
    experience: '1-3年',
    degree: '大专'
  });
});

test('parseMeta：城市缺失时回退到第一段', () => {
  assert.equal(parseMeta('5-10年 硕士').city, '5-10年');
});

test('parseCompanyInfo：跳过区块标题、融资阶段，提取规模与公司名', () => {
  assert.deepEqual(parseCompanyInfo(['公司基本信息', '100-499人', 'A轮', '某某科技有限公司']), {
    name: '某某科技有限公司',
    scale: '100-499人'
  });
});

test('parseCompanyInfo：公司名在规模之前也能识别', () => {
  assert.deepEqual(parseCompanyInfo(['某某科技', '50人以上']), {
    name: '某某科技',
    scale: '50人以上'
  });
});

test('resolveSalary：普通文本只做空白归一', () => {
  stubDom({ text: { '.salary': '20-30K  ·  13薪' } });
  assert.equal(resolveSalary({ salary: ['.salary'] }, '', '', ''), '20-30K · 13薪');
});

test('resolveSalary：私有区字符按岗位 ID 还原', () => {
  stubDom({
    text: { '.salary': '\ue031\ue032K' },
    salaryRecords: [{ id: 'abc', title: '前端工程师', company: 'A公司', salary: '25-35K' }]
  });
  assert.equal(resolveSalary({ salary: ['.salary'] }, 'abc', '前端工程师', 'A公司'), '25-35K');
});

test('resolveSalary：无 ID 时按唯一标题还原', () => {
  stubDom({
    text: { '.salary': '\ue031K' },
    salaryRecords: [{ id: '', title: '前端工程师', company: 'A公司', salary: '20-25K' }]
  });
  assert.equal(resolveSalary({ salary: ['.salary'] }, '', '前端工程师', 'A公司'), '20-25K');
});

test('resolveSalary：标题重复时用公司名消歧', () => {
  stubDom({
    text: { '.salary': '\ue031K' },
    salaryRecords: [
      { id: '1', title: '前端工程师', company: 'A公司', salary: '20-25K' },
      { id: '2', title: '前端工程师', company: 'B公司', salary: '30-40K' }
    ]
  });
  assert.equal(resolveSalary({ salary: ['.salary'] }, '', '前端工程师', 'B公司'), '30-40K');
});

test('resolveSalary：匹配不到时保留原文', () => {
  stubDom({
    text: { '.salary': '\ue031K' },
    salaryRecords: [{ id: '1', title: '后端工程师', company: 'A公司', salary: '20-25K' }]
  });
  assert.equal(resolveSalary({ salary: ['.salary'] }, '', '前端工程师', 'A公司'), '\ue031K');
});

test('resolveSalary：节点不存在时返回空串', () => {
  stubDom();
  assert.equal(resolveSalary({ salary: ['.salary'] }, '', '', ''), '');
});
