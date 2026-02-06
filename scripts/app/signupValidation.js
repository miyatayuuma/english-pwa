const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeFields(fields) {
  return {
    name: (fields.name ?? '').trim(),
    email: (fields.email ?? '').trim(),
    password: fields.password ?? '',
    confirmPassword: fields.confirmPassword ?? '',
    termsAccepted: Boolean(fields.termsAccepted),
  };
}

export function validateSignupFields(fields) {
  const normalized = normalizeFields(fields);
  const errors = {};

  if (!normalized.name) {
    errors.name = 'お名前を入力してください';
  }

  if (!normalized.email) {
    errors.email = 'メールアドレスを入力してください';
  } else if (!emailPattern.test(normalized.email)) {
    errors.email = '正しいメールアドレスの形式で入力してください';
  }

  if (!normalized.password) {
    errors.password = 'パスワードを入力してください';
  } else {
    if (normalized.password.length < 8) {
      errors.password = 'パスワードは8文字以上で入力してください';
    } else if (!/[a-zA-Z]/.test(normalized.password) || !/\d/.test(normalized.password)) {
      errors.password = '英字と数字を含めて入力してください';
    }
  }

  if (!normalized.confirmPassword) {
    errors.confirmPassword = '確認用パスワードを入力してください';
  } else if (normalized.password && normalized.confirmPassword !== normalized.password) {
    errors.confirmPassword = 'パスワードが一致しません';
  }

  if (!normalized.termsAccepted) {
    errors.termsAccepted = '利用規約とプライバシーポリシーへの同意が必要です';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    values: normalized,
  };
}

function renderFieldState({ form, errors, submitButton, statusEl }) {
  if (!form) return;
  const fields = ['name', 'email', 'password', 'confirmPassword', 'termsAccepted'];
  fields.forEach((field) => {
    const input = form.querySelector(`[name="${field}"]`);
    const errorEl = form.querySelector(`[data-error-for="${field}"]`);
    if (!input || !errorEl) return;
    const message = errors[field] ?? '';
    errorEl.textContent = message;
    errorEl.dataset.visible = message ? 'true' : 'false';
    input.classList.toggle('is-invalid', Boolean(message));

    const hasValue = input.type === 'checkbox' ? input.checked : input.value.length > 0;
    input.classList.toggle('is-valid', !message && hasValue);
  });

  if (submitButton) {
    const isLoading = statusEl?.dataset.state === 'loading';
    submitButton.disabled = isLoading || Object.keys(errors).length > 0;
  }

  if (statusEl?.dataset.state !== 'loading') {
    statusEl.dataset.state = 'idle';
    statusEl.textContent = '';
  }
}

export function setSignupSubmitState(formElement, state, message = '') {
  if (!formElement) return;
  const submitButton = formElement.querySelector('[type="submit"]');
  const statusEl = formElement.querySelector('#signupStatus');

  if (statusEl) {
    statusEl.dataset.state = state;
    statusEl.textContent = message;
  }

  if (submitButton) {
    submitButton.disabled = state === 'loading';
  }
}

export function attachSignupValidation(formElement) {
  if (!formElement) return () => ({ valid: false, errors: {}, values: {} });

  const submitButton = formElement.querySelector('[type="submit"]');
  const statusEl = formElement.querySelector('#signupStatus');

  const handler = () => {
    const formData = {
      name: formElement.querySelector('[name="name"]')?.value,
      email: formElement.querySelector('[name="email"]')?.value,
      password: formElement.querySelector('[name="password"]')?.value,
      confirmPassword: formElement.querySelector('[name="confirmPassword"]')?.value,
      termsAccepted: formElement.querySelector('[name="termsAccepted"]')?.checked,
    };
    const result = validateSignupFields(formData);
    renderFieldState({ form: formElement, errors: result.errors, submitButton, statusEl });
    return result;
  };

  formElement.addEventListener('input', handler);
  formElement.addEventListener('change', handler);
  handler();

  return handler;
}
