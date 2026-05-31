import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { TrendingUp, TrendingDown, DollarSign, BarChart2, Calculator } from "lucide-react";

function currency(n: number | null | undefined) {
  if (n == null) return "—";
  return "$" + Number(n).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pct(n: number | null | undefined) {
  if (n == null) return "—";
  return Number(n).toFixed(1) + "%";
}

export default function Profitability() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [period, setPeriod] = useState<"week" | "month" | "quarter">("month");

  const endDate = new Date().toISOString().split("T")[0];
  const startDate = (() => {
    const d = new Date();
    if (period === "week") d.setDate(d.getDate() - 7);
    else if (period === "month") d.setMonth(d.getMonth() - 1);
    else d.setMonth(d.getMonth() - 3);
    return d.toISOString().split("T")[0];
  })();

  const { data: scores = [] } = useQuery({
    queryKey: ["profitability-scores", period],
    queryFn: () => fetch(`/api/profitability?startDate=${startDate}&endDate=${endDate}`).then((r) => r.json()),
  });

  const calcMutation = useMutation({
    mutationFn: () => fetch("/api/profitability/calculate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ startDate, endDate }) }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["profitability-scores"] }); toast({ title: "Profitability recalculated" }); },
  });

  const total = (scores as any[]).reduce((a: number, s: any) => a + Number(s.revenue ?? 0), 0);
  const totalCost = (scores as any[]).reduce((a: number, s: any) => a + Number(s.labourCost ?? 0) + Number(s.materialCost ?? 0) + Number(s.overheadCost ?? 0), 0);
  const totalProfit = total - totalCost;
  const avgMargin = total > 0 ? (totalProfit / total) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Profitability</h1>
          <p className="text-muted-foreground mt-1">Revenue, margins, and cost breakdown per subcontractor</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={(v) => setPeriod(v as any)}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="week">Last 7 Days</SelectItem>
              <SelectItem value="month">Last Month</SelectItem>
              <SelectItem value="quarter">Last Quarter</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => calcMutation.mutate()} disabled={calcMutation.isPending}>
            <Calculator className="w-4 h-4 mr-2" />{calcMutation.isPending ? "Calculating…" : "Recalculate"}
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/20"><DollarSign className="w-5 h-5 text-orange-600" /></div>
              <div><p className="text-xs text-muted-foreground">Total Revenue</p><p className="text-xl font-bold">{currency(total)}</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/20"><BarChart2 className="w-5 h-5 text-red-600" /></div>
              <div><p className="text-xs text-muted-foreground">Total Costs</p><p className="text-xl font-bold">{currency(totalCost)}</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${totalProfit >= 0 ? "bg-green-100 dark:bg-green-900/20" : "bg-red-100 dark:bg-red-900/20"}`}>
                {totalProfit >= 0 ? <TrendingUp className="w-5 h-5 text-green-600" /> : <TrendingDown className="w-5 h-5 text-red-600" />}
              </div>
              <div><p className="text-xs text-muted-foreground">Total Profit</p><p className={`text-xl font-bold ${totalProfit >= 0 ? "text-green-700 dark:text-green-400" : "text-red-600"}`}>{currency(totalProfit)}</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${avgMargin >= 30 ? "bg-green-100 dark:bg-green-900/20" : avgMargin >= 15 ? "bg-amber-100 dark:bg-amber-900/20" : "bg-red-100 dark:bg-red-900/20"}`}>
                <TrendingUp className={`w-5 h-5 ${avgMargin >= 30 ? "text-green-600" : avgMargin >= 15 ? "text-amber-600" : "text-red-600"}`} />
              </div>
              <div><p className="text-xs text-muted-foreground">Avg Margin</p><p className="text-xl font-bold">{pct(avgMargin)}</p></div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per-worker profitability */}
      <div className="space-y-4">
        {(scores as any[]).map((s: any) => {
          const margin = Number(s.profitMargin ?? 0);
          const profit = Number(s.revenue ?? 0) - Number(s.labourCost ?? 0) - Number(s.materialCost ?? 0) - Number(s.overheadCost ?? 0);
          return (
            <Card key={s.id}>
              <CardContent className="pt-5">
                <div className="flex items-start gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-3">
                      <p className="font-semibold">{s.subcontractorName ?? `Sub #${s.subcontractorId}`}</p>
                      <Badge variant={margin >= 30 ? "default" : margin >= 15 ? "secondary" : "destructive"} className="text-xs">
                        {pct(margin)} margin
                      </Badge>
                    </div>
                    <div className="grid grid-cols-5 gap-4 text-sm">
                      <div><p className="text-xs text-muted-foreground">Revenue</p><p className="font-semibold text-green-700 dark:text-green-400">{currency(s.revenue)}</p></div>
                      <div><p className="text-xs text-muted-foreground">Labour</p><p className="font-semibold">{currency(s.labourCost)}</p></div>
                      <div><p className="text-xs text-muted-foreground">Materials</p><p className="font-semibold">{currency(s.materialCost)}</p></div>
                      <div><p className="text-xs text-muted-foreground">Overhead</p><p className="font-semibold">{currency(s.overheadCost)}</p></div>
                      <div><p className="text-xs text-muted-foreground">Profit</p><p className={`font-bold ${profit >= 0 ? "text-green-700 dark:text-green-400" : "text-red-600"}`}>{currency(profit)}</p></div>
                    </div>

                    {/* Margin bar */}
                    <div className="mt-3">
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${margin >= 30 ? "bg-green-500" : margin >= 15 ? "bg-amber-500" : "bg-red-500"}`}
                          style={{ width: `${Math.min(100, Math.max(0, margin))}%` }}
                        />
                      </div>
                    </div>

                    {(s.notes || s.jobsCount != null) && (
                      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                        {s.jobsCount != null && <span>{s.jobsCount} jobs</span>}
                        {s.totalMetres != null && <span>{Number(s.totalMetres).toFixed(0)}m total</span>}
                        {s.revenuePerMetre != null && <span>{currency(s.revenuePerMetre)}/m</span>}
                        {s.notes && <span>{s.notes}</span>}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {(scores as any[]).length === 0 && (
          <Card><CardContent className="py-12 text-center text-muted-foreground">No profitability data yet. Click "Recalculate" to generate scores from existing jobs and timesheets.</CardContent></Card>
        )}
      </div>
    </div>
  );
}
