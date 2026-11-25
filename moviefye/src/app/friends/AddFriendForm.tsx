"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { sendFriendRequest, type FriendActionState } from "./actions";

const initialState: FriendActionState = { error: null, success: null };

export function AddFriendForm() {
  const [state, formAction, pending] = useActionState(sendFriendRequest, initialState);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!query.trim()) {
      return;
    }
    const timeout = setTimeout(async () => {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setSuggestions(data.results ?? []);
    }, 300);
    return () => clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    if (!pending && state.success && formRef.current) {
      formRef.current.reset();
      setQuery("");
      setSuggestions([]);
    }
  }, [pending, state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="rounded-2xl border border-border bg-surface p-5 shadow-sm"
    >
      <label htmlFor="username" className="mb-1 block text-sm font-medium">
        Add a friend by username
      </label>
      <div className="flex gap-2">
        <input
          id="username"
          name="username"
          type="text"
          required
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="username"
          className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-accent"
        />
        <button
          type="submit"
          disabled={pending}
          className="whitespace-nowrap rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
        >
          {pending ? "Sending…" : "Add"}
        </button>
      </div>
      {query.trim() && suggestions.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {suggestions.map((username) => (
            <li key={username}>
              <button
                type="button"
                onClick={() => setQuery(username)}
                className="rounded-full border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:text-foreground"
              >
                {username}
              </button>
            </li>
          ))}
        </ul>
      )}
      {state.error && <p className="mt-2 text-sm text-flame">{state.error}</p>}
      {state.success && <p className="mt-2 text-sm text-success">{state.success}</p>}
    </form>
  );
}
