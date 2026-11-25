import { describe, expect, it } from "vitest";
import { parseSignupInput, parseLoginInput } from "./authInput";

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe("parseSignupInput", () => {
  it("accepts a valid signup", () => {
    const result = parseSignupInput(
      fd({ username: "movie_fan", password: "password1", confirmPassword: "password1" })
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a username that's too short", () => {
    const result = parseSignupInput(
      fd({ username: "ab", password: "password1", confirmPassword: "password1" })
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a username with invalid characters", () => {
    const result = parseSignupInput(
      fd({ username: "movie fan!", password: "password1", confirmPassword: "password1" })
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a password under 8 characters", () => {
    const result = parseSignupInput(
      fd({ username: "movie_fan", password: "short1", confirmPassword: "short1" })
    );
    expect(result.ok).toBe(false);
  });

  it("rejects mismatched passwords", () => {
    const result = parseSignupInput(
      fd({ username: "movie_fan", password: "password1", confirmPassword: "password2" })
    );
    expect(result.ok).toBe(false);
  });
});

describe("parseLoginInput", () => {
  it("accepts username and password", () => {
    const result = parseLoginInput(fd({ username: "movie_fan", password: "password1" }));
    expect(result.ok).toBe(true);
  });

  it("rejects a missing password", () => {
    const result = parseLoginInput(fd({ username: "movie_fan" }));
    expect(result.ok).toBe(false);
  });
});
