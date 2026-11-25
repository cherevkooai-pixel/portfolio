-- Rating moves from a 1-5 whole-star Int to a 0.5-10.0 half-step Float.
-- Existing values are doubled so a 5/5 becomes a 10/10 rather than silently
-- collapsing to 5/10.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WatchLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tmdbId" INTEGER NOT NULL,
    "mediaType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "posterPath" TEXT,
    "watchedAt" DATETIME NOT NULL,
    "rating" REAL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WatchLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_WatchLog" ("createdAt", "id", "mediaType", "notes", "posterPath", "rating", "title", "tmdbId", "userId", "watchedAt") SELECT "createdAt", "id", "mediaType", "notes", "posterPath", "rating" * 2, "title", "tmdbId", "userId", "watchedAt" FROM "WatchLog";
DROP TABLE "WatchLog";
ALTER TABLE "new_WatchLog" RENAME TO "WatchLog";
CREATE INDEX "WatchLog_userId_idx" ON "WatchLog"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
