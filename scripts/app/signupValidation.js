const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeFields(fields) {
  return {
    name: (fields.name ?? '').trim(),
    email: (fields.email ?? '').trim(),
    password: fields.password ?? '',
    confirmPassword: fields.confirmPassword ?? '',
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

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    values: normalized,
  };
}

function renderFieldState({ form, errors, submitButton }) {
  if (!form) return;
  const fields = ['name', 'email', 'password', 'confirmPassword'];
  fields.forEach((field) => {
    const input = form.querySelector(`[name="${field}"]`);
    const errorEl = form.querySelector(`[data-error-for="${field}"]`);
    if (!input || !errorEl) return;
    const message = errors[field] ?? '';
    errorEl.textContent = message;
    errorEl.dataset.visible = message ? 'true' : 'false';
    input.classList.toggle('is-invalid', Boolean(message));
    input.classList.toggle('is-valid', !message && input.value.length > 0);
  });
  if (submitButton) {
    submitButton.disabled = Object.keys(errors).length > 0;
  }
}

export function attachSignupValidation(formElement) {
  if (!formElement) return () => {};
  const submitButton = formElement.querySelector('[type="submit"]');

  const handler = () => {
    const formData = {
      name: formElement.querySelector('[name="name"]')?.value,
      email: formElement.querySelector('[name="email"]')?.value,
      password: formElement.querySelector('[name="password"]')?.value,
      confirmPassword: formElement.querySelector('[name="confirmPassword"]')?.value,
    };
    const result = validateSignupFields(formData);
    renderFieldState({ form: formElement, errors: result.errors, submitButton });
    return result;
  };

  formElement.addEventListener('input', handler);
  handler();

  return handler;
}
