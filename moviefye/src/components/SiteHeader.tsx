import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { logout } from "@/app/logout/actions";

export async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Movifye
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          {user ? (
            <>
              <Link href="/log" className="text-muted transition-colors hover:text-foreground">
                Log a watch
              </Link>
              <Link
                href="/friends"
                className="text-muted transition-colors hover:text-foreground"
              >
                Friends
              </Link>
              <Link
                href="/leaderboard"
                className="text-muted transition-colors hover:text-foreground"
              >
                Leaderboard
              </Link>
              <form action={logout}>
                <button
                  type="submit"
                  className="text-muted transition-colors hover:text-foreground"
                >
                  Log out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="text-muted transition-colors hover:text-foreground">
                Log in
              </Link>
              <Link
                href="/signup"
                className="rounded-full bg-accent px-3 py-1.5 text-accent-foreground"
              >
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
