"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { hashPassword, createSession } from "@/lib/auth";
import { parseSignupInput } from "@/lib/authInput";

export type SignupState = { error: string | null };

export async function signup(_prevState: SignupState, formData: FormData): Promise<SignupState> {
  const parsed = parseSignupInput(formData);
  if (!parsed.ok) {
    return { error: parsed.error };
  }

  const existing = await db.user.findUnique({ where: { username: parsed.data.username } });
  if (existing) {
    return { error: "That username is already taken." };
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const user = await db.user.create({
    data: {
      username: parsed.data.username,
      name: parsed.data.username,
      passwordHash,
    },
  });

  await createSession(user.id);
  redirect("/log");
}
