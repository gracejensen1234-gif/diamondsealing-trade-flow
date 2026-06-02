import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { CalendarRange, Sparkles, CheckCircle, X, ChevronRight, Brain } from "lucide-react";

function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff)).toISOString().split("T")[0];
}

function dateLabel(d: string) {
  return new Date(d).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

export default function WeeklyPlanner() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState(getWeekStart());
  const [notes, setNotes] = useState("");
  const [proposal, setProposal] = useState<any>(null);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndStr = weekEnd.toISOString().split("T")[0];

  const { data: proposals = [] } = useQuery({
    queryKey: ["weekly-planner", weekStart],
    queryFn: () => fetch(`/api/weekly-planner?weekStart=${weekStart}&weekEnd=${weekEndStr}`).then((r) => r.json()),
  });

  const generateMutation = useMutation({
    mutationFn: () => fetch("/api/weekly-planner/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ weekStart, weekEnd: weekEndStr, adminNotes: notes }) }).then((r) => r.json()),
    onSuccess: (data) => { setProposal(data); qc.invalidateQueries({ queryKey: ["weekly-planner"] }); toast({ title: "Weekly plan generated" }); },
    onError: () => toast({ title: "Generation failed", description: "Try again or check API settings", variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => fetch(`/api/weekly-planner/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "approved" }) }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["weekly-planner"] }); setProposal(null); toast({ title: "Plan approved and dispatched" }); },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: number) => fetch(`/api/weekly-planner/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "rejected" }) }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["weekly-planner"] }); setProposal(null); toast({ title: "Plan rejected" }); },
  });

  const current = proposal ?? (proposals as any[])[0] ?? null;

  function prevWeek() { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d.toISOString().split("T")[0]); setProposal(null); }
  function nextWeek() { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d.toISOString().split("T")[0]); setProposal(null); }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Weekly AI Planner</h1>
          <p className="text-muted-foreground mt-1">Rule-triggered workforce allocation proposals for the week</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={prevWeek}>←</Button>
          <span className="text-sm font-medium px-2">{dateLabel(weekStart)} – {dateLabel(weekEndStr)}</span>
          <Button variant="outline" size="sm" onClick={nextWeek}>→</Button>
        </div>
      </div>

      {/* Generate */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Brain className="w-5 h-5" />Generate Plan</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Admin notes / constraints</Label>
            <Textarea
              className="mt-1 text-sm"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Tom not available Monday, Jake should do premium builders only, high demand week in western suburbs…"
            />
          </div>
          <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
            <Sparkles className="w-4 h-4 mr-2" />{generateMutation.isPending ? "Generating plan…" : "Generate Weekly Plan"}
          </Button>
        </CardContent>
      </Card>

      {/* Proposal */}
      {current && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              Plan Proposal
              <Badge variant="outline" className="ml-2 capitalize">{current.status}</Badge>
            </h2>
            {current.status === "draft" && (
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => rejectMutation.mutate(current.id)}><X className="w-4 h-4 mr-2" />Reject</Button>
                <Button onClick={() => approveMutation.mutate(current.id)}><CheckCircle className="w-4 h-4 mr-2" />Approve & Dispatch</Button>
              </div>
            )}
          </div>

          {current.summary && <p className="text-sm text-muted-foreground">{current.summary}</p>}

          {current.warnings?.length > 0 && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-950/20">
              {(current.warnings as string[]).map((w, i) => <p key={i} className="text-sm text-amber-700 dark:text-amber-300">{w}</p>)}
            </div>
          )}

          {/* Daily assignments */}
          {current.dailyAssignments && (
            <div className="space-y-4">
              {Object.entries(current.dailyAssignments as Record<string, any[]>).map(([date, assignments]) => (
                <Card key={date}>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">{dateLabel(date)}</CardTitle></CardHeader>
                  <CardContent>
                    {assignments.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No assignments</p>
                    ) : (
                      <div className="space-y-2">
                        {assignments.map((a: any, i: number) => (
                          <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-muted/40">
                            <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                            <p className="font-medium text-sm">{a.subcontractorName}</p>
                            <ChevronRight className="w-3 h-3 text-muted-foreground" />
                            <p className="text-sm text-muted-foreground flex-1">{a.jobTitle}</p>
                            {a.colour && <Badge variant="outline" className="text-xs">{a.colour}</Badge>}
                            {a.suburb && <span className="text-xs text-muted-foreground">{a.suburb}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Flat assignments fallback */}
          {!current.dailyAssignments && current.assignments?.length > 0 && (
            <Card>
              <CardContent className="pt-4 space-y-2">
                {(current.assignments as any[]).map((a: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-muted/40">
                    <p className="font-medium text-sm">{a.subcontractorName}</p>
                    <ChevronRight className="w-3 h-3 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground flex-1">{a.jobTitle}</p>
                    {a.date && <span className="text-xs text-muted-foreground">{dateLabel(a.date)}</span>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {!current && (proposals as any[]).length === 0 && (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No plan for this week yet. Generate one above.</CardContent></Card>
      )}
    </div>
  );
}
