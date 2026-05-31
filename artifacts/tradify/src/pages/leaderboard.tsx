import { useQuery } from "@tanstack/react-query";
import type { LeaderboardEntry } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Award, Crown, Gauge, Medal, Sparkles, Target, Trophy, Users, type LucideIcon } from "lucide-react";

type CurrentAward = {
  winnerName?: string;
  awardTitle?: string;
  reasonText?: string;
  totalScore?: number | null;
};

function formatMonth(month: string) {
  return new Date(`${month}-01`).toLocaleString("en-AU", { month: "long", year: "numeric" });
}

function numberValue(value: number | null | undefined, fallback = 0) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function formatNumber(value: number | null | undefined, decimals = 0) {
  return numberValue(value).toFixed(decimals);
}

function initials(name?: string) {
  return (name ?? "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}

function isCurrentAward(value: unknown): value is CurrentAward {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && "winnerName" in value);
}

function rankTone(rank: number) {
  if (rank === 1) return "border-primary/60 bg-primary/10 shadow-lg shadow-primary/10";
  if (rank === 2) return "border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/40";
  if (rank === 3) return "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30";
  return "border-card-border";
}

function RankIcon({ rank }: { rank: number }) {
  if (rank === 1) return <Trophy className="h-6 w-6 text-primary" />;
  if (rank === 2) return <Medal className="h-6 w-6 text-zinc-500" />;
  if (rank === 3) return <Medal className="h-6 w-6 text-amber-600" />;
  return <span className="w-6 text-center text-sm font-bold text-muted-foreground">{rank}</span>;
}

function StatChip({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-sidebar-border bg-white/5 px-3 py-2">
      <Icon className="h-4 w-4 text-primary" />
      <div>
        <p className="text-[11px] uppercase tracking-wide text-sidebar-foreground/60">{label}</p>
        <p className="text-sm font-semibold text-sidebar-foreground">{value}</p>
      </div>
    </div>
  );
}

function PodiumCard({ entry, maxScore, index }: { entry: LeaderboardEntry; maxScore: number; index: number }) {
  const rank = entry.rank ?? index + 1;
  const score = numberValue(entry.totalScore);
  const percent = Math.max(8, Math.min(100, (score / Math.max(maxScore, 1)) * 100));

  return (
    <Card
      className={cn(
        "leaderboard-rise overflow-hidden border-2 transition-transform duration-300 hover:-translate-y-1",
        rankTone(rank),
      )}
      style={{ animationDelay: `${index * 90}ms` }}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="leaderboard-float flex h-14 w-14 items-center justify-center rounded-md bg-sidebar text-lg font-bold text-sidebar-foreground">
              {initials(entry.subcontractorName)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <RankIcon rank={rank} />
                <p className="truncate text-base font-bold">{entry.subcontractorName}</p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatNumber(entry.totalMetres)}m total · {formatNumber(entry.avgMetresPerHour, 1)} m/hr
              </p>
            </div>
          </div>
          {rank === 1 ? (
            <Badge className="shrink-0 gap-1">
              <Crown className="h-3.5 w-3.5" />
              Lead
            </Badge>
          ) : null}
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-end justify-between">
            <p className="text-xs font-medium text-muted-foreground">Monthly score</p>
            <p className="text-3xl font-bold tabular-nums">{formatNumber(score)}</p>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-muted">
            <div
              className="leaderboard-score-fill h-full rounded-full bg-primary"
              style={{ width: `${percent}%`, animationDelay: `${200 + index * 90}ms` }}
            />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-md bg-background/70 p-2">
            <p className="text-muted-foreground">Audit</p>
            <p className="font-semibold">{formatNumber(entry.auditScore)}/100</p>
          </div>
          <div className="rounded-md bg-background/70 p-2">
            <p className="text-muted-foreground">Days</p>
            <p className="font-semibold">{numberValue(entry.daysWorked)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Leaderboard() {
  const month = new Date().toISOString().slice(0, 7);
  const monthLabel = formatMonth(month);

  const { data: entries = [], isLoading } = useQuery<LeaderboardEntry[]>({
    queryKey: ["leaderboard", month],
    queryFn: () => fetch(`/api/analytics/leaderboard?month=${month}`).then((r) => r.json()),
  });

  const { data: awardData } = useQuery<unknown>({
    queryKey: ["current-award"],
    queryFn: () => fetch("/api/monthly-awards/current").then((r) => (r.ok ? r.json() : null)),
  });

  const rankedEntries = [...entries].sort((a, b) => numberValue(a.rank, 999) - numberValue(b.rank, 999));
  const topEntries = rankedEntries.slice(0, 3);
  const maxScore = Math.max(...rankedEntries.map((entry) => numberValue(entry.totalScore)), 1);
  const leader = rankedEntries[0];
  const averageScore = rankedEntries.length
    ? rankedEntries.reduce((sum, entry) => sum + numberValue(entry.totalScore), 0) / rankedEntries.length
    : 0;
  const award = isCurrentAward(awardData) ? awardData : null;

  if (isLoading) return <div className="flex h-64 items-center justify-center text-muted-foreground">Loading leaderboard...</div>;

  return (
    <div className="space-y-6">
      <section className="leaderboard-shimmer relative overflow-hidden rounded-lg border border-sidebar-border bg-sidebar p-5 text-sidebar-foreground sm:p-6">
        <div className="absolute inset-x-0 top-0 h-1 bg-primary" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Trophy className="h-5 w-5" />
              </div>
              <Badge className="bg-primary text-primary-foreground hover:bg-primary">Live monthly ladder</Badge>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Monthly Leaderboard</h1>
            <p className="mt-2 text-sm text-sidebar-foreground/70">{monthLabel} rankings across metres, pace, work days, and audit score.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[30rem]">
            <StatChip icon={Crown} label="Leader" value={leader?.subcontractorName ?? "No leader yet"} />
            <StatChip icon={Target} label="Top Score" value={leader ? formatNumber(leader.totalScore) : "0"} />
            <StatChip icon={Users} label="Active" value={String(rankedEntries.length)} />
          </div>
        </div>
      </section>

      {award ? (
        <Card className="leaderboard-rise overflow-hidden border-primary/30 bg-primary/10">
          <CardContent className="p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="leaderboard-float flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Award className="h-7 w-7" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sub/Employee of the Month</p>
                <p className="text-xl font-bold">{award.winnerName}</p>
                <p className="text-sm text-muted-foreground">
                  {award.awardTitle}
                  {award.reasonText ? ` · ${award.reasonText}` : ""}
                </p>
              </div>
              {award.totalScore ? (
                <div className="rounded-md bg-background px-4 py-3 text-center">
                  <p className="text-xs text-muted-foreground">Score</p>
                  <p className="text-2xl font-bold">{formatNumber(award.totalScore)}</p>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {rankedEntries.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No rankings yet for this month. Run a calculation from the Awards page.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            {topEntries.map((entry, index) => (
              <PodiumCard key={entry.subcontractorId ?? `${entry.subcontractorName}-${index}`} entry={entry} maxScore={maxScore} index={index} />
            ))}
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="border-b px-5 py-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">Full Ladder</h2>
                    <p className="text-sm text-muted-foreground">Average score {formatNumber(averageScore)} points</p>
                  </div>
                  <Badge variant="outline" className="w-fit gap-1">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    {rankedEntries.length} ranked
                  </Badge>
                </div>
              </div>

              <div className="divide-y">
                {rankedEntries.map((entry, index) => {
                  const rank = entry.rank ?? index + 1;
                  const score = numberValue(entry.totalScore);
                  const percent = Math.max(6, Math.min(100, (score / Math.max(maxScore, 1)) * 100));

                  return (
                    <div
                      key={entry.subcontractorId ?? `${entry.subcontractorName}-${index}`}
                      className="leaderboard-rise p-5 transition-colors hover:bg-muted/50"
                      style={{ animationDelay: `${index * 65}ms` }}
                    >
                      <div className="flex flex-col gap-4 md:flex-row md:items-center">
                        <div className="flex min-w-0 flex-1 items-center gap-4">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted font-bold">
                            <RankIcon rank={rank} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate font-semibold">{entry.subcontractorName}</p>
                              {entry.badge ? <Badge variant="secondary">{entry.badge}</Badge> : null}
                            </div>
                            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                              <div
                                className="leaderboard-score-fill h-full rounded-full bg-primary"
                                style={{ width: `${percent}%`, animationDelay: `${160 + index * 65}ms` }}
                              />
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4 md:min-w-[28rem]">
                          <div className="rounded-md bg-muted/70 p-2">
                            <p className="text-xs text-muted-foreground">Score</p>
                            <p className="font-bold tabular-nums">{formatNumber(score)}</p>
                          </div>
                          <div className="rounded-md bg-muted/70 p-2">
                            <p className="text-xs text-muted-foreground">Metres</p>
                            <p className="font-bold tabular-nums">{formatNumber(entry.totalMetres)}m</p>
                          </div>
                          <div className="rounded-md bg-muted/70 p-2">
                            <p className="text-xs text-muted-foreground">Pace</p>
                            <p className="font-bold tabular-nums">{formatNumber(entry.avgMetresPerHour, 1)}</p>
                          </div>
                          <div className="rounded-md bg-muted/70 p-2">
                            <p className="text-xs text-muted-foreground">Audit</p>
                            <p className="font-bold tabular-nums">{formatNumber(entry.auditScore)}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/20">
            <CardContent className="grid gap-4 p-5 sm:grid-cols-3">
              <div className="flex items-center gap-3">
                <Gauge className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-xs text-muted-foreground">Average Score</p>
                  <p className="font-bold">{formatNumber(averageScore)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Target className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-xs text-muted-foreground">Top Metres</p>
                  <p className="font-bold">{formatNumber(Math.max(...rankedEntries.map((entry) => numberValue(entry.totalMetres))))}m</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Users className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-xs text-muted-foreground">Team Days</p>
                  <p className="font-bold">{rankedEntries.reduce((sum, entry) => sum + numberValue(entry.daysWorked), 0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
