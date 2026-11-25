# Moviefye

Letterboxd-style movie logging with a social feed and a Duolingo-style loop: XP, streaks, badges and a friends leaderboard. Design spec: `moviefye-structural-spec.md`.

```
npm install
# .env: DATABASE_URL="file:./dev.db", TMDB_API_KEY=... (optional)
npx prisma migrate dev
npm run dev
```
