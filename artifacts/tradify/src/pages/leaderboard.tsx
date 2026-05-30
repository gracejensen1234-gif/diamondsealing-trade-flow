import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, Medal, TrendingUp, Star } from "lucide-react";

export default function Leaderboard() {
  const month = new Date().toISOString().slice(0, 7);

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["leaderboard", month],
    queryFn: () => fetch(`/api/analytics/leaderboard?month=${month}`).then((r) => r.json()),
  });

  const { data: award } = useQuery({
    queryKey: ["current-award"],
    queryFn: () => fetch("/api/monthly-awards/current").then((r) => r.ok ? r.json() : null),
  });

  const rankIcon = (rank: number) => {
    if (rank === 1) return <Trophy className="w-6 h-6 text-yellow-500" />;
    if (rank === 2) return <Medal className="w-6 h-6 text-slate-400" />;
    if (rank === 3) return <Medal className="w-6 h-6 text-amber-600" />;
    return <span className="w-6 text-center text-sm font-bold text-muted-foreground">{rank}</span>;
  };

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading leaderboard…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Monthly Leaderboard</h1>
        <p className="text-muted-foreground mt-1">{new Date().toLocaleString("en-AU", { month: "long", year: "numeric" })} rankings</p>
      </div>

      {/* Current Award Banner */}
      {award && (
        <Card className="border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 dark:border-yellow-800">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-yellow-100 dark:bg-yellow-900/40 flex items-center justify-center">
                <Trophy className="w-7 h-7 text-yellow-500" />
              </div>
              <div>
                <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-400 uppercase tracking-wide">Sub/Employee of the Month</p>
                <p className="text-xl font-bold">{award.winnerName}</p>
                <p className="text-sm text-muted-foreground">{award.awardTitle} — {award.reasonText}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Leaderboard */}
      <div className="space-y-3">
        {(entries as any[]).map((entry: any) => (
          <Card key={entry.subcontractorId} className={entry.rank <= 3 ? "border-primary/20" : ""}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-4">
                <div className="flex-shrink-0">{rankIcon(entry.rank)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{entry.subcontractorName}</p>
                    {entry.badge && <span className="text-lg">{entry.badge}</span>}
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                    <span>{(entry.totalMetres ?? 0).toFixed(0)}m total</span>
                    <span>{(entry.avgMetresPerHour ?? 0).toFixed(1)} m/hr</span>
                    <span>{entry.daysWorked} days</span>
                    <span>Audit: {(entry.auditScore ?? 0).toFixed(0)}/100</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold">{(entry.totalScore ?? 0).toFixed(0)}</p>
                  <p className="text-xs text-muted-foreground">points</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {entries.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No rankings yet for this month. Run a calculation from the Awards page.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
