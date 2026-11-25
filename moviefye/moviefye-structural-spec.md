# MOVIEFYE — Structural App Spec

Concept in one line: **Letterboxd's logging + X's feed + Duolingo's gamification loop**, wrapped around movies/TV. Social-first, not stats-first — streaks and XP are a login reward layer, not the homepage.

---

## 1. Visual/Style System

**Overall tone**: Dark-mode-first, high-contrast, playful-but-premium. Not clinical, not corporate. Feels like a hangout for people who love movies — closer to Letterboxd's confident personality + Duolingo's reward pop, not a sterile tracker.

**Color system**
- Background: near-black (#0B0B0F or similar), not pure black — gives depth for cards to sit on
- Surface/card: one step lighter than background, subtle border or shadow, not flat
- Primary accent: one bold saturated color for CTAs, XP bars, streak flame (distinct from Letterboxd's green/orange and Duolingo's green — cinema-red or electric-purple)
- Secondary accent: a contrasting color reserved only for gamification elements (XP gain, streak, leaderboard rank badges) so they visually "pop" out of the social content
- Semantic colors: success/streak-safe (green), warning/streak-at-risk (amber/red)

**Typography**
- Display/headline font: rounded or slightly characterful (Duolingo-style friendliness) for gamification moments (streak counter, XP toast, level-up)
- Body/UI font: clean, high-legibility sans-serif for feed content and reviews (this is the "social media" register)
- Clear type scale: feed post body != same weight as XP numbers != same weight as nav labels

**Iconography & motifs**
- Evolving **badge/emblem per level or genre-mastery tier** — film-reel, ticket-stub, or star-rating themed shapes that gain detail/shine as the user levels up. One consistent visual system reused everywhere (profile, leaderboard, level-up modal).
- Streak icon: flame or filmstrip-flame hybrid, consistent everywhere streaks appear.
- Avatars: circular, with a thin colored ring that changes based on current streak/level tier — a cheap, high-impact "everyone can see your commitment" signal.

**Motion**
- Feed scroll: standard, fast, no gimmicks — social media speed
- Gamification events (XP gain, streak extended, badge unlocked): distinct celebratory motion — scale/bounce + particle or glow burst, sound-optional. Browsing feels calm, achieving feels loud.
- Login streak modal: full-screen takeover animation on open — "this moment matters" weight, celebratory.

**Card system**
- Feed post card: avatar, username, streak/level ring, movie poster thumbnail (if logging a watch) or plain text, rating (stars), review text, like/comment/repost actions — X.com layout, Letterboxd content
- Leaderboard row card: rank number, avatar+ring, username, XP total, friend/you highlight state
- Movie card: poster, title, year, avg rating, quick-log button

---

## 2. Page-by-Page Blueprint

### 2.1 Onboarding
- Welcome/value prop carousel (3 screens max): "Log what you watch" -> "Earn XP, build streaks" -> "Compete with friends, share your taste"
- Signup/login (email or social auth)
- Optional taste quiz: pick favorite genres/films -> seeds initial recommendations and who to follow suggestions
- Follow-suggestions screen (like X's "who to follow") using taste quiz results
- -> lands on Main Feed

### 2.2 Login Streak Modal (triggers on every app open, once/day)
**Key structural rule: streaks are NOT on the main screen — they live here.**
- Full-screen takeover, auto-dismisses or has a clear "Continue" CTA
- Shows: current streak count (large, animated count-up if extended), streak flame graphic, "X days in a row"
- If streak was at risk and saved: extra celebratory state
- If streak broken: softer re-engagement state ("Let's start a new one" — no shame framing)
- Shows XP gained just for opening/logging today (small passive reward)
- Dismiss -> drops user into Main Feed underneath

### 2.3 Main Feed (Home) — default landing screen post-login
- X.com-style vertical feed, chronological or algorithmic toggle
- Post types rendered in-feed: watch logs (poster + rating + review), text-only thoughts/discussions, list shares ("My top 5 horror films"), friend milestone announcements (badge unlocked, streak milestone — auto-generated, low-key styling)
- Top of feed: compose bar ("What did you watch?" / "Share a thought") — tapping opens post composer
- Persistent bottom tab bar: Feed / Search-Discover / Log (center, prominent) / Leaderboard / Profile
- Pull-to-refresh, infinite scroll
- No streak/XP widgets cluttering this screen

### 2.4 Post Composer
- Two paths from one entry point: "Log a watch" (search TMDB -> select film -> rate/review -> post) or "Share a thought" (plain text post, optional attach a film)
- Visibility toggle (public / friends only)
- Preview before posting

### 2.5 Log a Watch (core loop feature)
- TMDB search (title search, results with poster+year)
- Select film -> rating, optional written review, optional tags (rewatch, mood, etc.)
- On submit: XP awarded (toast animation), streak counted for the day, post created in feed
- Manual entry fallback if not found in TMDB

### 2.6 Movie Detail Page
- Poster, title, year, synopsis, avg rating across app
- Friends' activity on this film (who logged it, their ratings/reviews)
- "Log this" CTA
- Reviews list (app-wide, sortable by friends/all)

### 2.7 Leaderboard
- Single league to start — friends-only ranking by XP (weekly and all-time toggle)
- Rank list: position, avatar+ring, name, XP, streak flame if active
- Your own row pinned/highlighted if off-screen
- Tap a user -> their profile

### 2.8 Profile (own or others')
- Avatar with level ring, display name, current streak, current level/badge tier (evolving emblem)
- Stats row: films logged, avg rating given, current streak, longest streak, total XP
- Badge/achievement gallery (locked/unlocked grid)
- Grid of logged films (poster wall, Letterboxd-style) + list of text posts
- Follow/friend button (on others' profiles)

### 2.9 Search / Discover
- Search films (TMDB) and users
- Discover tab: trending films in-app, popular reviews, suggested people to follow

### 2.10 Notifications
- Likes, comments, new followers, friend milestone/badge unlocks, streak-at-risk reminder (push-eligible)

### 2.11 Settings
- Account, streak reminder notification time, privacy (public/friends-only default), theme

---

## 3. Gamification System Detail

**XP sources** (RESOLVED values):
- Logging a watch: +10 XP
- Writing a review (vs. rating-only): +5 XP bonus
- Daily login (streak maintenance): +2 XP
- Getting likes/comments on your posts: +1 XP each, capped +10/day

**Streaks**
- Increments once per calendar day — **UTC** (RESOLVED)
- Streak freeze / grace token: **v2, not MVP** (RESOLVED)

**Levels/Badges**
- XP thresholds unlock sequential badge tiers. Current ladder (`src/lib/tiers.ts`):
  Popcorn (0) -> Matinee (50) -> Feature Presentation (150) -> Director's Cut (400) -> Reel Legend (800)
- Badge gallery lives on Profile; unlock moment gets the full-screen celebratory treatment like the streak modal

**Leaderboard**
- Friends-only ranking by XP for MVP

**Post visibility**
- Default: **friends-only** (RESOLVED). Users can opt into public per-post.

---

## 4. Component Library

Shared primitives — every page consumes these rather than reinventing cards per screen.

- Avatar w/ level ring — `src/components/Avatar.tsx`
- Streak flame indicator (small inline + large modal versions) — `src/components/StreakFlame.tsx`
- XP toast/gain animation — `src/components/XpToast.tsx`
- Star rating input + display — `src/components/RatingStars.tsx`
- Feed post card (variants: watch-log, text post, milestone announcement) — NOT YET BUILT
- Movie card (poster + meta, search result + grid variants) — `src/components/MovieCard.tsx`
- Badge tile (locked/unlocked states) — `src/components/BadgeTile.tsx`
- Leaderboard row — `src/components/LeaderboardRow.tsx`
- Bottom tab bar — `src/components/BottomTabBar.tsx` (built, not yet mounted)
- Full-screen celebratory modal (shared by streak + badge unlock) — `src/components/CelebratoryModal.tsx` (built, not yet wired)

---

## 5. Feature Build Order

1. Design tokens + component library (Section 1 + Section 4) — **DONE**
2. Auth + onboarding flow (2.1) — **auth DONE; onboarding carousel / taste quiz / follow-suggestions NOT built**
3. Data model: users, films (TMDB cache), logs, posts, follows, XP/streak fields — **DONE**
4. Log a Watch flow (2.5) — **DONE**
5. Login Streak Modal (2.2) — NOT BUILT
6. Main Feed (2.3) — NOT BUILT
7. Post Composer (2.4) — NOT BUILT
8. Movie Detail Page (2.6) — NOT BUILT
9. Profile page (2.8) — NOT BUILT
10. Leaderboard (2.7) — **DONE** (weekly/all-time toggle NOT built)
11. Search/Discover (2.9) — NOT BUILT
12. Notifications (2.10) — NOT BUILT
13. Settings (2.11) — NOT BUILT

---

## 6. Open Product Decisions

RESOLVED:
- Streak timezone: UTC
- Streak freeze/grace token: v2, not MVP
- XP values: see Section 3
- Post visibility default: friends-only

STILL OPEN:
- Star rating scale: currently 5-star whole-star. Half-stars (Letterboxd-style) or 10-point?
- Badge tier names/count: currently 5 tiers (see Section 3) — confirm or replace.
