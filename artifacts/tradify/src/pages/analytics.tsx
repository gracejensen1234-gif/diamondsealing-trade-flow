import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, Clock, Layers, Users } from "lucide-react";

function fmt(n: number | null | undefined, dec = 1) {
  if (n == null) return "—";
  return n.toFixed(dec);
}

function weekStart() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff)).toISOString().split("T")[0];
}

export default function Analytics() {
  const [range, setRange] = useState<"week" | "month">("week");

  const startDate = range === "week" ? weekStart() : new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
  const endDate = new Date().toISOString().split("T")[0];

  const { data, isLoading } = useQuery({
    queryKey: ["analytics-productivity", startDate, endDate],
    queryFn: () =>
      fetch(`/api/analytics/productivity?startDate=${startDate}&endDate=${endDate}`).then((r) => r.json()),
  });

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading analytics…</div>;

  const subs: any[] = data?.subcontractors ?? [];
  const avgs = data?.weeklyAverages ?? {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Productivity Analytics</h1>
          <p className="text-muted-foreground mt-1">Metres per hour, daily breakdown, performance overview</p>
        </div>
        <Select value={range} onValueChange={(v) => setRange(v as "week" | "month")}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="week">This Week</SelectItem>
            <SelectItem value="month">This Month</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/20">
                <Layers className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Metres</p>
                <p className="text-2xl font-bold">{fmt(avgs.totalMetres, 0)}m</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/20">
                <TrendingUp className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Avg M/Hr (Team)</p>
                <p className="text-2xl font-bold">{fmt(avgs.avgMetresPerHour)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/20">
                <Clock className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Avg M/Day (Team)</p>
                <p className="text-2xl font-bold">{fmt(avgs.avgMetresPerDay, 0)}m</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/20">
                <Users className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Active Workers</p>
                <p className="text-2xl font-bold">{subs.filter((s) => s.daysWorked > 0).length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per-worker breakdown */}
      <div className="space-y-4">
        {subs.map((sub: any) => (
          <Card key={sub.subcontractorId}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{sub.subcontractorName}</CardTitle>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">{sub.jobsCompleted} jobs</span>
                  <Badge variant={sub.avgMetresPerHour >= 8 ? "default" : sub.avgMetresPerHour >= 5 ? "secondary" : "destructive"}>
                    {fmt(sub.avgMetresPerHour)} m/hr
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-4 mb-4 text-sm">
                <div><p className="text-muted-foreground">Total Metres</p><p className="font-semibold">{fmt(sub.totalMetres, 0)}m</p></div>
                <div><p className="text-muted-foreground">Work Hours</p><p className="font-semibold">{fmt(sub.totalWorkMinutes / 60)}h</p></div>
                <div><p className="text-muted-foreground">Days Worked</p><p className="font-semibold">{sub.daysWorked}</p></div>
                <div><p className="text-muted-foreground">Avg M/Day</p><p className="font-semibold">{fmt(sub.avgMetresPerDay, 0)}m</p></div>
              </div>

              {/* Daily breakdown */}
              {sub.dailyBreakdown?.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-1 font-medium text-muted-foreground">Date</th>
                        <th className="text-right py-1 font-medium text-muted-foreground">Metres</th>
                        <th className="text-right py-1 font-medium text-muted-foreground">Hours</th>
                        <th className="text-right py-1 font-medium text-muted-foreground">M/Hr</th>
                        <th className="text-right py-1 font-medium text-muted-foreground">Jobs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sub.dailyBreakdown.map((day: any) => (
                        <tr key={day.date} className="border-b border-border/50">
                          <td className="py-1">{new Date(day.date).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })}</td>
                          <td className="text-right py-1">{fmt(day.metres, 0)}m</td>
                          <td className="text-right py-1">{fmt(day.workMinutes / 60)}h</td>
                          <td className="text-right py-1">
                            <span className={day.metresPerHour >= 8 ? "text-green-600 font-medium" : day.metresPerHour >= 5 ? "text-amber-600" : "text-red-500"}>
                              {fmt(day.metresPerHour)}
                            </span>
                          </td>
                          <td className="text-right py-1">{day.jobsCompleted}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {subs.length === 0 && (
          <Card><CardContent className="pt-6 text-center text-muted-foreground py-12">No productivity data for this period.</CardContent></Card>
        )}
      </div>
    </div>
  );
}
