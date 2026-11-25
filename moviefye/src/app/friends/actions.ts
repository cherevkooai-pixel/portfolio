"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export type FriendActionState = { error: string | null; success: string | null };

export async function sendFriendRequest(
  _prevState: FriendActionState,
  formData: FormData
): Promise<FriendActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "You must be logged in.", success: null };

  const username = String(formData.get("username") ?? "").trim();
  if (!username) return { error: "Enter a username.", success: null };

  const target = await db.user.findUnique({ where: { username } });
  if (!target) return { error: `No user found with username "${username}".`, success: null };
  if (target.id === user.id) return { error: "You can't friend yourself.", success: null };

  const existing = await db.friendRequest.findFirst({
    where: {
      OR: [
        { fromUserId: user.id, toUserId: target.id },
        { fromUserId: target.id, toUserId: user.id },
      ],
    },
  });

  if (existing?.status === "accepted") {
    return { error: `You and ${username} are already friends.`, success: null };
  }

  if (existing && existing.fromUserId === target.id && existing.status === "pending") {
    // They already sent us a request — accept it instead of creating a duplicate.
    await db.friendRequest.update({ where: { id: existing.id }, data: { status: "accepted" } });
    revalidatePath("/friends");
    return { error: null, success: `You're now friends with ${username}.` };
  }

  if (existing) {
    return { error: `You already have a pending request with ${username}.`, success: null };
  }

  await db.friendRequest.create({
    data: { fromUserId: user.id, toUserId: target.id, status: "pending" },
  });

  revalidatePath("/friends");
  return { error: null, success: `Friend request sent to ${username}.` };
}

export async function respondToFriendRequest(requestId: string, accept: boolean): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;

  const request = await db.friendRequest.findUnique({ where: { id: requestId } });
  if (!request || request.toUserId !== user.id) return;

  if (accept) {
    await db.friendRequest.update({ where: { id: requestId }, data: { status: "accepted" } });
  } else {
    await db.friendRequest.delete({ where: { id: requestId } });
  }

  revalidatePath("/friends");
}
