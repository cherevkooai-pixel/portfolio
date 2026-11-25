"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { verifyPassword, createSession } from "@/lib/auth";
import { parseLoginInput } from "@/lib/authInput";

export type LoginState = { error: string | null };

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = parseLoginInput(formData);
  if (!parsed.ok) {
    return { error: parsed.error };
  }

  const user = await db.user.findUnique({ where: { username: parsed.data.username } });
  if (!user || !user.passwordHash || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return { error: "Invalid username or password." };
  }

  await createSession(user.id);
  redirect("/log");
}
