import test from 'node:test';
import assert from 'node:assert/strict';
import { clean } from '../src/shared/dom.js';

test('clean：归一化不换行空格与行尾空白', () => {
  assert.equal(clean('  前端\u00a0开发  \n要求'), '前端 开发\n要求');
});

test('clean：连续空行压缩为一行', () => {
  assert.equal(clean('职位描述\n\n\n\n1. 负责开发'), '职位描述\n\n1. 负责开发');
});

test('clean：空值返回空串', () => {
  assert.equal(clean(undefined), '');
  assert.equal(clean(''), '');
});
