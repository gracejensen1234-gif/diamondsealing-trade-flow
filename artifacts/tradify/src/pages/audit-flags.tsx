import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, AlertTriangle, CheckCircle, XCircle, Eye, Zap } from "lucide-react";

const SEVERITY_CFG: Record<string, { label: string; color: string; bg: string }> = {
  low: { label: "Low", color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/20" },
  medium: { label: "Medium", color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950/20" },
  high: { label: "High", color: "text-orange-600", bg: "bg-orange-50 dark:bg-orange-950/20" },
  critical: { label: "Critical", color: "text-red-600", bg: "bg-red-50 dark:bg-red-950/20" },
};

const FLAG_TYPE_LABELS: Record<string, string> = {
  poor_photo_quality: "Poor Photo Quality",
  missing_photos: "Missing Photos",
  incorrect_finish: "Incorrect Finish",
  insufficient_coverage: "Insufficient Coverage",
  time_anomaly: "Time Anomaly",
  missed_area: "Missed Area",
  product_mismatch: "Product Mismatch",
  callback_risk: "Callback Risk",
  custom: "Custom",
};

export default function AuditFlags() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSev, setFilterSev] = useState("all");
  const [resolution, setResolution] = useState<Record<number, string>>({});

  const { data: flags = [] } = useQuery({ queryKey: ["ai-audit-flags"], queryFn: () => fetch("/api/audit/flags").then((r) => r.json()) });
  const { data: scores = [] } = useQuery({ queryKey: ["audit-scores"], queryFn: () => fetch("/api/audit/scores").then((r) => r.json()) });
  const { data: subs = [] } = useQuery({ queryKey: ["subcontractors"], queryFn: () => fetch("/api/subcontractors").then((r) => r.json()) });

  const runAuditMutation = useMutation({
    mutationFn: (reportId: number) => fetch(`/api/audit/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobReportId: reportId }) }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ai-audit-flags"] }); toast({ title: "Audit complete" }); },
  });

  const resolveMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => fetch(`/api/audit/flags/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ai-audit-flags"] }); toast({ title: "Flag resolved" }); },
  });

  const filtered = (flags as any[]).filter((f: any) => {
    if (filterStatus !== "all" && f.status !== filterStatus) return false;
    if (filterSev !== "all" && f.severity !== filterSev) return false;
    return true;
  });

  const openFlags = (flags as any[]).filter((f: any) => f.status === "open");
  const criticalFlags = (flags as any[]).filter((f: any) => f.severity === "critical" || f.severity === "high");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">AI Audit</h1>
          <p className="text-muted-foreground mt-1">Quality audit flags, scores, and AI-powered photo analysis</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">Open Flags</p>
            <p className="text-3xl font-bold mt-1">{openFlags.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">High / Critical</p>
            <p className={`text-3xl font-bold mt-1 ${criticalFlags.length > 0 ? "text-red-600" : ""}`}>{criticalFlags.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">Resolved (30d)</p>
            <p className="text-3xl font-bold mt-1">{(flags as any[]).filter((f: any) => f.status === "resolved").length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">Avg Audit Score</p>
            <p className="text-3xl font-bold mt-1">
              {scores.length === 0 ? "—" : (((scores as any[]).reduce((a: number, s: any) => a + Number(s.overallScore), 0) / (scores as any[]).length)).toFixed(0)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Audit scores per worker */}
      {(scores as any[]).length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Worker Audit Scores</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(scores as any[]).map((s: any) => (
                <div key={s.id} className="flex items-center gap-4">
                  <p className="text-sm font-medium w-32 flex-shrink-0">{s.subcontractorName}</p>
                  <div className="flex-1 bg-muted rounded-full h-2">
                    <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.min(100, Number(s.overallScore))}%` }} />
                  </div>
                  <span className={`text-sm font-bold w-10 text-right ${Number(s.overallScore) < 60 ? "text-red-600" : Number(s.overallScore) < 80 ? "text-amber-600" : "text-green-600"}`}>{Number(s.overallScore).toFixed(0)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_review">In Review</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="false_positive">False Positive</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterSev} onValueChange={setFilterSev}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severity</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Flags list */}
      <div className="space-y-3">
        {filtered.map((flag: any) => {
          const sev = SEVERITY_CFG[flag.severity] ?? SEVERITY_CFG.medium;
          const isOpen = flag.status === "open" || flag.status === "in_review";
          return (
            <Card key={flag.id} className={`border-l-4 ${flag.severity === "critical" ? "border-l-red-500" : flag.severity === "high" ? "border-l-orange-500" : flag.severity === "medium" ? "border-l-amber-500" : "border-l-blue-400"}`}>
              <CardContent className="pt-4">
                <div className="flex items-start gap-4">
                  <AlertTriangle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${sev.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="font-semibold text-sm">{FLAG_TYPE_LABELS[flag.flagType] ?? flag.flagType}</p>
                      <Badge variant="outline" className={`text-xs ${sev.color}`}>{sev.label}</Badge>
                      <Badge variant="outline" className="text-xs capitalize">{flag.status?.replace(/_/g, " ")}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{flag.subcontractorName}{flag.jobTitle ? ` · ${flag.jobTitle}` : ""}{flag.reportDate ? ` · ${new Date(flag.reportDate).toLocaleDateString("en-AU")}` : ""}</p>
                    {flag.aiDescription && <p className="text-sm mt-2 text-muted-foreground">{flag.aiDescription}</p>}
                    {flag.suggestedAction && <p className="text-xs mt-1 text-blue-600 dark:text-blue-400">Suggested: {flag.suggestedAction}</p>}
                    {flag.adminNotes && <p className="text-xs mt-1 text-muted-foreground">Note: {flag.adminNotes}</p>}

                    {isOpen && (
                      <div className="mt-3 flex items-start gap-2">
                        <Textarea
                          className="text-sm flex-1 min-h-0 h-8 resize-none"
                          placeholder="Resolution notes…"
                          value={resolution[flag.id] ?? ""}
                          onChange={(e) => setResolution((p) => ({ ...p, [flag.id]: e.target.value }))}
                        />
                        <Button size="sm" variant="outline" onClick={() => resolveMutation.mutate({ id: flag.id, data: { status: "false_positive", adminNotes: resolution[flag.id] } })}>False +ve</Button>
                        <Button size="sm" onClick={() => resolveMutation.mutate({ id: flag.id, data: { status: "resolved", adminNotes: resolution[flag.id], resolvedAt: new Date().toISOString() } })}>
                          <CheckCircle className="w-3.5 h-3.5 mr-1" />Resolve
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
          <Card><CardContent className="py-12 text-center text-muted-foreground">No audit flags match your filters.</CardContent></Card>
        )}
      </div>
    </div>
  );
}
