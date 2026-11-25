const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function parseSignupInput(
  formData: FormData
): ParseResult<{ username: string; password: string }> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!USERNAME_PATTERN.test(username)) {
    return {
      ok: false,
      error: "Username must be 3-20 characters: letters, numbers, or underscores.",
    };
  }
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }
  if (password !== confirmPassword) {
    return { ok: false, error: "Passwords don't match." };
  }

  return { ok: true, data: { username, password } };
}

export function parseLoginInput(
  formData: FormData
): ParseResult<{ username: string; password: string }> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!username || !password) {
    return { ok: false, error: "Enter a username and password." };
  }

  return { ok: true, data: { username, password } };
}
