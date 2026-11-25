"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { respondToFriendRequest } from "./actions";

export function IncomingRequestRow({
  requestId,
  username,
}: {
  requestId: string;
  username: string;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const respond = (accept: boolean) => {
    startTransition(async () => {
      await respondToFriendRequest(requestId, accept);
      router.refresh();
    });
  };

  return (
    <li className="flex items-center justify-between rounded-xl border border-border bg-surface px-3 py-2.5 text-sm">
      <span className="font-medium">{username}</span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => respond(true)}
          className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground disabled:opacity-50"
        >
          Accept
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => respond(false)}
          className="rounded-full border border-border px-3 py-1 text-xs text-muted disabled:opacity-50"
        >
          Decline
        </button>
      </div>
    </li>
  );
}
