import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getFriends, getIncomingRequests, getOutgoingRequests } from "@/lib/friends";
import { Avatar } from "@/components/Avatar";
import { AddFriendForm } from "./AddFriendForm";
import { IncomingRequestRow } from "./IncomingRequestRow";

export default async function FriendsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [friends, incoming, outgoing] = await Promise.all([
    getFriends(user.id),
    getIncomingRequests(user.id),
    getOutgoingRequests(user.id),
  ]);

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Friends</h1>

      <AddFriendForm />

      {incoming.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-lg font-semibold tracking-tight">Requests</h2>
          <ul className="flex flex-col gap-2">
            {incoming.map((req) => (
              <IncomingRequestRow
                key={req.id}
                requestId={req.id}
                username={req.fromUser.username ?? req.fromUser.name}
              />
            ))}
          </ul>
        </>
      )}

      <h2 className="mb-3 mt-8 text-lg font-semibold tracking-tight">Your friends</h2>
      {friends.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
          No friends yet — add one by username above.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {friends.map((friend) => (
            <li
              key={friend.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
            >
              <Avatar name={friend.username ?? friend.name} xp={friend.xp} size="sm" />
              <span className="flex-1 font-medium">{friend.username ?? friend.name}</span>
              <span className="text-xs text-muted">{friend.xp} XP</span>
            </li>
          ))}
        </ul>
      )}

      {outgoing.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-lg font-semibold tracking-tight">Sent requests</h2>
          <ul className="flex flex-col gap-2">
            {outgoing.map((req) => (
              <li
                key={req.id}
                className="flex items-center justify-between rounded-xl border border-dashed border-border px-3 py-2.5 text-sm text-muted"
              >
                <span>{req.toUser.username ?? req.toUser.name}</span>
                <span className="text-xs">Pending</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
