import { db } from "@/lib/db";

export async function getFriends(userId: string) {
  const accepted = await db.friendRequest.findMany({
    where: {
      status: "accepted",
      OR: [{ fromUserId: userId }, { toUserId: userId }],
    },
    include: { fromUser: true, toUser: true },
  });

  return accepted.map((req) => (req.fromUserId === userId ? req.toUser : req.fromUser));
}

export function getIncomingRequests(userId: string) {
  return db.friendRequest.findMany({
    where: { toUserId: userId, status: "pending" },
    include: { fromUser: true },
    orderBy: { createdAt: "desc" },
  });
}

export function getOutgoingRequests(userId: string) {
  return db.friendRequest.findMany({
    where: { fromUserId: userId, status: "pending" },
    include: { toUser: true },
    orderBy: { createdAt: "desc" },
  });
}
