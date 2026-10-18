-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "nbaId" INTEGER,
    "espnId" INTEGER,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "nbaPos" TEXT NOT NULL,
    "elig" TEXT[],
    "eligSource" TEXT NOT NULL DEFAULT 'derived',
    "age" INTEGER,
    "birthdate" TEXT,
    "experience" INTEGER,
    "heightM" DOUBLE PRECISION,
    "weightKg" DOUBLE PRECISION,
    "rookie" JSONB,
    "teamChange" JSONB,
    "availability" JSONB,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonStat" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'historical',
    "source" TEXT NOT NULL,
    "team" TEXT,
    "gp" INTEGER NOT NULL,
    "min" DOUBLE PRECISION NOT NULL,
    "pts" DOUBLE PRECISION NOT NULL,
    "fg3m" DOUBLE PRECISION NOT NULL,
    "reb" DOUBLE PRECISION NOT NULL,
    "ast" DOUBLE PRECISION NOT NULL,
    "stl" DOUBLE PRECISION NOT NULL,
    "blk" DOUBLE PRECISION NOT NULL,
    "tov" DOUBLE PRECISION NOT NULL,
    "fgm" DOUBLE PRECISION NOT NULL,
    "fga" DOUBLE PRECISION NOT NULL,
    "ftm" DOUBLE PRECISION NOT NULL,
    "fta" DOUBLE PRECISION NOT NULL,
    "attemptsEstimated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SeasonStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectionSet" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectionSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Projection" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "gp" DOUBLE PRECISION NOT NULL,
    "min" DOUBLE PRECISION NOT NULL,
    "pts" DOUBLE PRECISION NOT NULL,
    "fg3m" DOUBLE PRECISION NOT NULL,
    "reb" DOUBLE PRECISION NOT NULL,
    "ast" DOUBLE PRECISION NOT NULL,
    "stl" DOUBLE PRECISION NOT NULL,
    "blk" DOUBLE PRECISION NOT NULL,
    "tov" DOUBLE PRECISION NOT NULL,
    "fgm" DOUBLE PRECISION NOT NULL,
    "fga" DOUBLE PRECISION NOT NULL,
    "ftm" DOUBLE PRECISION NOT NULL,
    "fta" DOUBLE PRECISION NOT NULL,
    "sd" JSONB NOT NULL,
    "gpSd" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "kind" TEXT NOT NULL,
    "flags" TEXT[],

    CONSTRAINT "Projection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdpSet" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdpSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdpEntry" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "adp" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "AdpEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleGame" (
    "id" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "home" TEXT NOT NULL,
    "away" TEXT NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "ScheduleGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerOverride" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsItem" (
    "id" TEXT NOT NULL,
    "playerId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reported',
    "confidence" TEXT NOT NULL DEFAULT 'medium',
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dedupeKey" TEXT NOT NULL,

    CONSTRAINT "NewsItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftSession" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "state" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "projectionSetId" TEXT,
    "adpSetId" TEXT,
    "datasetHash" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DraftSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftPick" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "overall" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "teamIndex" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DraftPick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftAudit" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "overall" INTEGER,
    "playerId" TEXT,
    "teamIndex" INTEGER,
    "recommendation" JSONB,
    "categoryImpact" JSONB,
    "simulation" JSONB,
    "stateBefore" JSONB NOT NULL,
    "projectionSetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationResult" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "stateVersion" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportLog" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "filename" TEXT,
    "rowsTotal" INTEGER NOT NULL,
    "rowsImported" INTEGER NOT NULL,
    "unmatched" JSONB NOT NULL,
    "issues" JSONB NOT NULL,
    "targetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshRun" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "RefreshRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppConfig" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Player_nbaId_key" ON "Player"("nbaId");

-- CreateIndex
CREATE INDEX "Player_nameKey_idx" ON "Player"("nameKey");

-- CreateIndex
CREATE INDEX "Player_team_idx" ON "Player"("team");

-- CreateIndex
CREATE INDEX "SeasonStat_season_idx" ON "SeasonStat"("season");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonStat_playerId_season_source_key" ON "SeasonStat"("playerId", "season", "source");

-- CreateIndex
CREATE INDEX "ProjectionSet_isActive_idx" ON "ProjectionSet"("isActive");

-- CreateIndex
CREATE INDEX "Projection_setId_idx" ON "Projection"("setId");

-- CreateIndex
CREATE UNIQUE INDEX "Projection_setId_playerId_key" ON "Projection"("setId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "AdpEntry_setId_playerId_key" ON "AdpEntry"("setId", "playerId");

-- CreateIndex
CREATE INDEX "ScheduleGame_season_idx" ON "ScheduleGame"("season");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleGame_season_date_home_away_key" ON "ScheduleGame"("season", "date", "home", "away");

-- CreateIndex
CREATE INDEX "PlayerOverride_playerId_idx" ON "PlayerOverride"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "NewsItem_dedupeKey_key" ON "NewsItem"("dedupeKey");

-- CreateIndex
CREATE INDEX "NewsItem_playerId_idx" ON "NewsItem"("playerId");

-- CreateIndex
CREATE INDEX "NewsItem_publishedAt_idx" ON "NewsItem"("publishedAt");

-- CreateIndex
CREATE INDEX "DraftSession_updatedAt_idx" ON "DraftSession"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DraftPick_sessionId_overall_key" ON "DraftPick"("sessionId", "overall");

-- CreateIndex
CREATE UNIQUE INDEX "DraftPick_sessionId_playerId_key" ON "DraftPick"("sessionId", "playerId");

-- CreateIndex
CREATE INDEX "DraftAudit_sessionId_version_idx" ON "DraftAudit"("sessionId", "version");

-- CreateIndex
CREATE INDEX "SimulationResult_sessionId_stateVersion_idx" ON "SimulationResult"("sessionId", "stateVersion");

-- CreateIndex
CREATE INDEX "RefreshRun_job_startedAt_idx" ON "RefreshRun"("job", "startedAt");

-- AddForeignKey
ALTER TABLE "SeasonStat" ADD CONSTRAINT "SeasonStat_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Projection" ADD CONSTRAINT "Projection_setId_fkey" FOREIGN KEY ("setId") REFERENCES "ProjectionSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Projection" ADD CONSTRAINT "Projection_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdpEntry" ADD CONSTRAINT "AdpEntry_setId_fkey" FOREIGN KEY ("setId") REFERENCES "AdpSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdpEntry" ADD CONSTRAINT "AdpEntry_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerOverride" ADD CONSTRAINT "PlayerOverride_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftSession" ADD CONSTRAINT "DraftSession_projectionSetId_fkey" FOREIGN KEY ("projectionSetId") REFERENCES "ProjectionSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPick" ADD CONSTRAINT "DraftPick_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DraftSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftAudit" ADD CONSTRAINT "DraftAudit_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DraftSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationResult" ADD CONSTRAINT "SimulationResult_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DraftSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
