import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateSignupFields } from '../scripts/app/signupValidation.js';

test('requires all fields before enabling submission', () => {
  const result = validateSignupFields({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    termsAccepted: false,
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, {
    name: 'お名前を入力してください',
    email: 'メールアドレスを入力してください',
    password: 'パスワードを入力してください',
    confirmPassword: '確認用パスワードを入力してください',
    termsAccepted: '利用規約とプライバシーポリシーへの同意が必要です',
  });
});

test('validates email and password rules in real time', () => {
  const start = validateSignupFields({
    name: 'User',
    email: 'invalid',
    password: 'abc',
    confirmPassword: 'abc',
    termsAccepted: true,
  });
  assert.equal(start.valid, false);
  assert.equal(start.errors.email, '正しいメールアドレスの形式で入力してください');
  assert.equal(start.errors.password, 'パスワードは8文字以上で入力してください');

  const mid = validateSignupFields({
    name: 'User',
    email: 'user@example.com',
    password: 'abcdefgh',
    confirmPassword: 'abc',
    termsAccepted: true,
  });
  assert.equal(mid.valid, false);
  assert.equal(mid.errors.confirmPassword, 'パスワードが一致しません');

  const resolved = validateSignupFields({
    name: ' User ',
    email: 'user@example.com ',
    password: 'abc12345',
    confirmPassword: 'abc12345',
    termsAccepted: true,
  });
  assert.equal(resolved.valid, true);
  assert.deepEqual(resolved.errors, {});
  assert.equal(resolved.values.name, 'User');
  assert.equal(resolved.values.email, 'user@example.com');
});

test('rejects passwords without both letters and numbers', () => {
  const lettersOnly = validateSignupFields({
    name: 'User',
    email: 'user@example.com',
    password: 'onlyletters',
    confirmPassword: 'onlyletters',
    termsAccepted: true,
  });
  assert.equal(lettersOnly.valid, false);
  assert.equal(lettersOnly.errors.password, '英字と数字を含めて入力してください');

  const numbersOnly = validateSignupFields({
    name: 'User',
    email: 'user@example.com',
    password: '12345678',
    confirmPassword: '12345678',
    termsAccepted: true,
  });
  assert.equal(numbersOnly.valid, false);
  assert.equal(numbersOnly.errors.password, '英字と数字を含めて入力してください');
});

test('requires policy consent to submit', () => {
  const unconsented = validateSignupFields({
    name: 'User',
    email: 'user@example.com',
    password: 'abc12345',
    confirmPassword: 'abc12345',
    termsAccepted: false,
  });

  assert.equal(unconsented.valid, false);
  assert.equal(unconsented.errors.termsAccepted, '利用規約とプライバシーポリシーへの同意が必要です');
});
