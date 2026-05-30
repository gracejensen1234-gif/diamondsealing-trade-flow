import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, AlertTriangle, CheckCircle, Sparkles, ListChecks, Bot } from "lucide-react";

const SEV_STYLE: Record<string, { color: string; border: string }> = {
  info:     { color: "text-blue-600",   border: "border-l-blue-400" },
  warning:  { color: "text-amber-600",  border: "border-l-amber-500" },
  critical: { color: "text-red-600",    border: "border-l-red-500" },
};

const FLAG_LABELS: Record<string, string> = {
  missing_photos: "Missing Photos",
  low_photo_count: "Low Photo Count",
  wrong_colour: "Wrong Colour",
  unusual_stock_ratio: "Unusual Stock Ratio",
  excessive_break: "Excessive Break",
  early_departure: "Early Departure",
  late_arrival: "Late Arrival",
  missing_stock_usage: "Missing Stock Usage",
  low_metres_vs_time: "Low Metres vs Time",
  repeat_callback: "Repeat Callback",
  incomplete_documentation: "Incomplete Documentation",
  safety_concern: "Safety Concern",
  missing_builder_contact: "Missing Builder Contact",
  photo_quality_concern: "Photo Quality Concern",
  inconsistent_data: "Inconsistent Data",
  possible_false_reporting: "Possible False Reporting",
  other: "Other",
};

export default function AuditFlags() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSev, setFilterSev] = useState("all");
  const [filterSource, setFilterSource] = useState("all");
  const [auditDate, setAuditDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [resolution, setResolution] = useState<Record<number, string>>({});

  const { data: flags = [] } = useQuery({
    queryKey: ["ai-audit-flags"],
    queryFn: () => fetch("/api/audit/flags").then((r) => r.json()),
  });
  const { data: scores = [] } = useQuery({
    queryKey: ["audit-scores"],
    queryFn: () => fetch("/api/audit/scores").then((r) => r.json()),
  });

  const runRulesMutation = useMutation({
    mutationFn: (date: string) =>
      fetch("/api/audit/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      }).then((r) => r.json()),
    onSuccess: (data: { length?: number } | unknown[]) => {
      qc.invalidateQueries({ queryKey: ["ai-audit-flags"] });
      const count = Array.isArray(data) ? data.length : 0;
      toast({ title: `Rule audit complete — ${count} flag(s) raised` });
    },
    onError: () => toast({ title: "Rule audit failed", variant: "destructive" }),
  });

  const runAIMutation = useMutation({
    mutationFn: (date: string) =>
      fetch("/api/audit/ai-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      }).then((r) => r.json()),
    onSuccess: (data: { subcontractorName: string; flagsCreated: number; error?: string }[]) => {
      qc.invalidateQueries({ queryKey: ["ai-audit-flags"] });
      const total = Array.isArray(data) ? data.reduce((a, r) => a + (r.flagsCreated ?? 0), 0) : 0;
      const errors = Array.isArray(data) ? data.filter((r) => r.error) : [];
      if (errors.length > 0) {
        toast({ title: `AI audit done — ${total} flag(s), ${errors.length} worker(s) failed`, variant: "destructive" });
      } else {
        toast({ title: `AI audit complete — ${total} flag(s) raised` });
      }
    },
    onError: () => toast({ title: "AI audit failed", variant: "destructive" }),
  });

  const resolveMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      fetch(`/api/audit/flags/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-audit-flags"] });
      toast({ title: "Flag updated" });
    },
  });

  const allFlags = flags as {
    id: number;
    flagType: string;
    severity: string;
    title: string;
    description: string;
    evidence?: { suggestedAction?: string };
    status: string;
    adminNotes?: string;
    subcontractorName?: string;
    aiGenerated?: boolean;
    createdAt: string;
  }[];

  const filtered = allFlags.filter((f) => {
    if (filterStatus !== "all" && f.status !== filterStatus) return false;
    if (filterSev !== "all" && f.severity !== filterSev) return false;
    if (filterSource === "ai" && !f.aiGenerated) return false;
    if (filterSource === "rules" && f.aiGenerated) return false;
    return true;
  });

  const pending = allFlags.filter((f) => f.status === "pending").length;
  const critical = allFlags.filter((f) => f.severity === "critical").length;
  const aiFlags = allFlags.filter((f) => f.aiGenerated).length;
  const avgScore =
    (scores as { overallScore: number }[]).length === 0
      ? null
      : (
          (scores as { overallScore: number }[]).reduce((a, s) => a + Number(s.overallScore), 0) /
          (scores as { overallScore: number }[]).length
        ).toFixed(0);

  const isRunning = runRulesMutation.isPending || runAIMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">AI Audit</h1>
          <p className="text-muted-foreground mt-0.5">Quality flags, AI photo analysis, and worker scores</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            value={auditDate}
            onChange={(e) => setAuditDate(e.target.value)}
            className="border rounded-md px-3 py-1.5 text-sm bg-background"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={isRunning}
            onClick={() => runRulesMutation.mutate(auditDate)}
          >
            <ListChecks className="w-4 h-4 mr-1.5" />
            {runRulesMutation.isPending ? "Running…" : "Run Rules"}
          </Button>
          <Button
            size="sm"
            disabled={isRunning}
            onClick={() => runAIMutation.mutate(auditDate)}
          >
            <Sparkles className="w-4 h-4 mr-1.5" />
            {runAIMutation.isPending ? "Analysing…" : "Run AI Audit"}
          </Button>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">Pending Flags</p>
            <p className={`text-3xl font-bold mt-1 ${pending > 0 ? "text-amber-600" : ""}`}>{pending}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">Critical</p>
            <p className={`text-3xl font-bold mt-1 ${critical > 0 ? "text-red-600" : ""}`}>{critical}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">AI-Generated</p>
            <div className="flex items-center gap-1.5 mt-1">
              <Bot className="w-4 h-4 text-purple-500" />
              <p className="text-3xl font-bold">{aiFlags}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">Avg Audit Score</p>
            <p className={`text-3xl font-bold mt-1 ${avgScore !== null && Number(avgScore) < 70 ? "text-red-600" : avgScore !== null && Number(avgScore) < 85 ? "text-amber-600" : "text-green-600"}`}>
              {avgScore ?? "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Worker scores */}
      {(scores as { overallScore: number }[]).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" /> Worker Audit Scores
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(scores as { id: number; subcontractorName: string; overallScore: number; periodStart: string }[]).map((s) => (
                <div key={s.id} className="flex items-center gap-3">
                  <p className="text-sm font-medium w-32 flex-shrink-0 truncate">{s.subcontractorName}</p>
                  <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-2 rounded-full transition-all ${Number(s.overallScore) < 70 ? "bg-red-500" : Number(s.overallScore) < 85 ? "bg-amber-500" : "bg-green-500"}`}
                      style={{ width: `${Math.min(100, Number(s.overallScore))}%` }}
                    />
                  </div>
                  <span className={`text-sm font-bold w-8 text-right tabular-nums ${Number(s.overallScore) < 70 ? "text-red-600" : Number(s.overallScore) < 85 ? "text-amber-600" : "text-green-600"}`}>
                    {Number(s.overallScore).toFixed(0)}
                  </span>
                  <span className="text-xs text-muted-foreground w-20 text-right hidden sm:block">{s.periodStart}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="reviewed">Reviewed</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="dismissed">Dismissed</SelectItem>
            <SelectItem value="fix_requested">Fix Requested</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterSev} onValueChange={setFilterSev}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severity</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterSource} onValueChange={setFilterSource}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            <SelectItem value="ai">AI Generated</SelectItem>
            <SelectItem value="rules">Rule-Based</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Flags list */}
      <div className="space-y-3">
        {filtered.map((flag) => {
          const sev = SEV_STYLE[flag.severity] ?? SEV_STYLE.info;
          const isPending = flag.status === "pending";
          const suggestedAction = flag.evidence?.suggestedAction;

          return (
            <Card key={flag.id} className={`border-l-4 ${sev.border}`}>
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${sev.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="font-semibold text-sm">{flag.title || FLAG_LABELS[flag.flagType] || flag.flagType}</p>
                      <Badge variant="outline" className={`text-xs capitalize ${sev.color}`}>{flag.severity}</Badge>
                      <Badge variant="outline" className="text-xs capitalize">{flag.status.replace(/_/g, " ")}</Badge>
                      {flag.aiGenerated && (
                        <Badge variant="secondary" className="text-xs gap-1">
                          <Bot className="w-3 h-3" /> AI
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mb-1">
                      {flag.subcontractorName}
                      {flag.createdAt ? ` · ${new Date(flag.createdAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}
                    </p>
                    <p className="text-sm text-muted-foreground">{flag.description}</p>
                    {suggestedAction && (
                      <p className="text-xs mt-1.5 text-blue-600 dark:text-blue-400">
                        <span className="font-medium">Suggested: </span>{suggestedAction}
                      </p>
                    )}
                    {flag.adminNotes && (
                      <p className="text-xs mt-1 text-muted-foreground italic">Note: {flag.adminNotes}</p>
                    )}

                    {isPending && (
                      <div className="mt-3 flex items-start gap-2">
                        <Textarea
                          className="text-sm flex-1 min-h-0 h-8 resize-none"
                          placeholder="Admin notes (optional)…"
                          value={resolution[flag.id] ?? ""}
                          onChange={(e) => setResolution((p) => ({ ...p, [flag.id]: e.target.value }))}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => resolveMutation.mutate({ id: flag.id, data: { status: "dismissed", adminNotes: resolution[flag.id] } })}
                        >
                          Dismiss
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => resolveMutation.mutate({ id: flag.id, data: { status: "reviewed", adminNotes: resolution[flag.id] } })}
                        >
                          <CheckCircle className="w-3.5 h-3.5 mr-1" />Reviewed
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {filtered.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center">
              <ShieldCheck className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-muted-foreground text-sm">No audit flags match your filters.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
