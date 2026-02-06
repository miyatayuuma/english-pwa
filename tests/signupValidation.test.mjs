import { test } from 'node:test';
import assert from 'node:assert/strict';

import { attachSignupValidation, setSignupSubmitState, validateSignupFields } from '../scripts/app/signupValidation.js';

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


function createMockSignupForm() {
  const classList = () => {
    const classes = new Set();
    return {
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      },
    };
  };

  const createInput = ({ type = 'text', value = '', checked = false } = {}) => ({
    type,
    value,
    checked,
    classList: classList(),
  });

  const createError = () => ({
    textContent: '',
    dataset: {},
  });

  const fields = {
    name: createInput({ value: 'User' }),
    email: createInput({ value: 'user@example.com' }),
    password: createInput({ value: 'abc12345' }),
    confirmPassword: createInput({ value: 'abc12345' }),
    termsAccepted: createInput({ type: 'checkbox', checked: true }),
  };

  const errors = {
    name: createError(),
    email: createError(),
    password: createError(),
    confirmPassword: createError(),
    termsAccepted: createError(),
  };

  const submitButton = { disabled: false };
  const statusEl = { dataset: { state: 'idle' }, textContent: '' };
  const listeners = new Map();

  const form = {
    dataset: {},
    querySelector(selector) {
      if (selector === '[type="submit"]') return submitButton;
      if (selector === '#signupStatus') return statusEl;

      const fieldMatch = selector.match(/^\[name="(.+)"\]$/);
      if (fieldMatch) return fields[fieldMatch[1]] ?? null;

      const errorMatch = selector.match(/^\[data-error-for="(.+)"\]$/);
      if (errorMatch) return errors[errorMatch[1]] ?? null;

      return null;
    },
    addEventListener(type, callback) {
      listeners.set(type, callback);
    },
  };

  return { form, fields, submitButton, statusEl, listeners };
}

test('keeps submit button disabled while loading even when inputs change', () => {
  const { form, listeners, submitButton, statusEl } = createMockSignupForm();

  attachSignupValidation(form);
  assert.equal(submitButton.disabled, false);

  setSignupSubmitState(form, 'loading', '登録処理中です…');
  assert.equal(submitButton.disabled, true);
  assert.equal(form.dataset.submitState, 'loading');
  assert.equal(statusEl.dataset.state, 'loading');

  listeners.get('input')();
  assert.equal(submitButton.disabled, true);
});
