import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Brain, CheckCircle, AlertTriangle, XCircle, ChevronRight, Sparkles } from "lucide-react";

const REC_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  recommended: { icon: CheckCircle, color: "text-green-600", label: "Recommended" },
  suitable: { icon: CheckCircle, color: "text-orange-500", label: "Suitable" },
  possible: { icon: AlertTriangle, color: "text-amber-500", label: "Possible" },
  not_recommended: { icon: XCircle, color: "text-red-500", label: "Not Recommended" },
};

function optionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function splitColours(value: string) {
  return value
    .split(",")
    .map((colour) => colour.trim())
    .filter(Boolean);
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? "Request failed");
  return data;
}

export default function Allocation() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    jobId: "",
    date: new Date().toISOString().split("T")[0],
    productType: "silicone",
    colour: "",
    estimatedMetres: "",
    jobType: "residential",
    suburb: "",
    builderProfileId: "",
    workArea: "",
    timeWindow: "full_day",
    plannedStartTime: "",
    plannedEndTime: "",
    notes: "",
  });
  const [result, setResult] = useState<any>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const { data: jobs = [] } = useQuery({ queryKey: ["jobs"], queryFn: () => fetch("/api/jobs").then((r) => r.json()) });
  const { data: builders = [] } = useQuery({ queryKey: ["builder-profiles"], queryFn: () => fetch("/api/builder-profiles").then((r) => r.json()) });

  const recommendMutation = useMutation({
    mutationFn: (data: any) => postJson("/api/allocation/recommend", data),
    onSuccess: (data) => { setResult(data); setSelected(data.autoSelected?.subcontractorId ?? null); },
    onError: () => toast({ title: "Error", description: "Could not get recommendations", variant: "destructive" }),
  });

  const confirmMutation = useMutation({
    mutationFn: (data: any) => postJson("/api/allocation/confirm", data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["dispatch"] });
      setResult((previous: any) => previous ? { ...previous, jobAssignmentId: data.jobAssignmentId } : previous);
      toast({
        title: "Employee/subcontractor allocated and scheduled",
        description: data.assignment?.workArea ? `${data.assignment.workArea} is now in Dispatch.` : "This work block is now in Dispatch.",
      });
    },
    onError: (error) => toast({
      title: "Could not schedule work block",
      description: error instanceof Error ? error.message : "Try again from Dispatch.",
      variant: "destructive",
    }),
  });

  function run() {
    if (!form.jobId || !form.date) { toast({ title: "Job and date are required" }); return; }
    const payload: any = { ...form, jobId: Number(form.jobId), estimatedMetres: optionalNumber(form.estimatedMetres) };
    if (form.builderProfileId && form.builderProfileId !== "none") payload.builderProfileId = Number(form.builderProfileId);
    else delete payload.builderProfileId;
    recommendMutation.mutate(payload);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Trigger-Based Job Allocation</h1>
        <p className="text-muted-foreground mt-1">Rule-based employee/subcontractor assignment for a whole job or one scheduled work block.</p>
      </div>

      {/* Request form */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Brain className="w-5 h-5" />Allocation Request</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label>Job / project</Label>
              <Select value={form.jobId} onValueChange={(v) => setForm((p) => ({ ...p, jobId: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select job or project..." /></SelectTrigger>
                <SelectContent>{(jobs as any[]).map((j: any) => <SelectItem key={j.id} value={String(j.id)}>{j.title}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" className="mt-1" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} />
            </div>
            <div>
              <Label>Product Type</Label>
              <Select value={form.productType} onValueChange={(v) => setForm((p) => ({ ...p, productType: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="silicone">Silicone</SelectItem>
                  <SelectItem value="sikaflex">Sikaflex</SelectItem>
                  <SelectItem value="fire_rated">Fire-Rated</SelectItem>
                  <SelectItem value="waterproofing">Waterproofing</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Required colours</Label>
              <Input className="mt-1" placeholder="e.g. Sandstone, White" value={form.colour} onChange={(e) => setForm((p) => ({ ...p, colour: e.target.value }))} />
            </div>
            <div>
              <Label>Est. metres for this block</Label>
              <Input type="number" className="mt-1" value={form.estimatedMetres} onChange={(e) => setForm((p) => ({ ...p, estimatedMetres: e.target.value }))} />
            </div>
            <div>
              <Label>Job Type</Label>
              <Select value={form.jobType} onValueChange={(v) => setForm((p) => ({ ...p, jobType: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="residential">Residential</SelectItem>
                  <SelectItem value="commercial">Commercial</SelectItem>
                  <SelectItem value="pool">Pool</SelectItem>
                  <SelectItem value="car_park">Car Park</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Suburb</Label>
              <Input className="mt-1" placeholder="e.g. Milton" value={form.suburb} onChange={(e) => setForm((p) => ({ ...p, suburb: e.target.value }))} />
            </div>
            <div>
              <Label>Builder Profile</Label>
              <Select value={form.builderProfileId} onValueChange={(v) => setForm((p) => ({ ...p, builderProfileId: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select builder (optional)…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No builder profile</SelectItem>
                  {(builders as any[]).map((b: any) => <SelectItem key={b.id} value={String(b.id)}>{b.name} ({b.qualityTier})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label>Work block / units</Label>
              <Input
                className="mt-1"
                placeholder="e.g. Units 1-4 bathrooms, Level 2 balconies, Block B"
                value={form.workArea}
                onChange={(e) => setForm((p) => ({ ...p, workArea: e.target.value }))}
              />
            </div>
            <div>
              <Label>Day part</Label>
              <Select value={form.timeWindow} onValueChange={(v) => setForm((p) => ({ ...p, timeWindow: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_day">Full day</SelectItem>
                  <SelectItem value="morning">Morning</SelectItem>
                  <SelectItem value="afternoon">Afternoon</SelectItem>
                  <SelectItem value="custom">Custom time</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Start</Label>
                <Input type="time" className="mt-1" value={form.plannedStartTime} onChange={(e) => setForm((p) => ({ ...p, plannedStartTime: e.target.value }))} />
              </div>
              <div>
                <Label>Finish</Label>
                <Input type="time" className="mt-1" value={form.plannedEndTime} onChange={(e) => setForm((p) => ({ ...p, plannedEndTime: e.target.value }))} />
              </div>
            </div>
            <div className="md:col-span-2">
              <Label>Instructions for this block</Label>
              <Textarea
                className="mt-1"
                rows={3}
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                placeholder="e.g. Complete wet area internals first, leave balconies for afternoon crew."
              />
            </div>
          </div>
          <Button className="w-full sm:w-auto" onClick={run} disabled={recommendMutation.isPending}>
            <Sparkles className="w-4 h-4 mr-2" />
            {recommendMutation.isPending ? "Checking rules..." : "Run Trigger Rules"}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {result.warnings?.length > 0 && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-950/20">
              {result.warnings.map((w: string, i: number) => <p key={i} className="text-sm text-amber-700 dark:text-amber-300">{w}</p>)}
            </div>
          )}

          <h2 className="text-lg font-semibold">Employee/Subcontractor Recommendations</h2>

          {result.recommendations?.map((r: any) => {
            const cfg = REC_CONFIG[r.recommendation] ?? REC_CONFIG.possible;
            const Icon = cfg.icon;
            const isSelected = selected === r.subcontractorId;

            return (
              <Card key={r.subcontractorId} className={isSelected ? "ring-2 ring-primary" : ""}>
                <CardContent className="pt-4">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center font-bold text-sm">{r.rank}</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold">{r.subcontractorName}</p>
                        <Icon className={`w-4 h-4 ${cfg.color}`} />
                        <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
                        <span className="ml-auto text-lg font-bold">{r.suitabilityScore}/100</span>
                      </div>

                      <div className="flex flex-wrap gap-2 mb-2">
                        {r.skillMatch && <Badge variant="secondary" className="text-xs">✓ Skills match</Badge>}
                        {r.stockMatch && <Badge variant="secondary" className="text-xs">✓ Stock OK</Badge>}
                        {r.scheduleFit && <Badge variant="secondary" className="text-xs">✓ Available</Badge>}
                        {r.builderTierMatch && <Badge variant="secondary" className="text-xs">✓ Quality tier</Badge>}
                        {r.nearbyJobSuburb && <Badge variant="secondary" className="text-xs">✓ Nearby: {r.nearbyJobSuburb}</Badge>}
                      </div>

                      {r.reasons?.length > 0 && (
                        <div className="mb-1">
                          {r.reasons.map((reason: string, i: number) => <p key={i} className="text-xs text-green-700 dark:text-green-400">{reason}</p>)}
                        </div>
                      )}
                      {r.warnings?.length > 0 && (
                        <div>
                          {r.warnings.map((w: string, i: number) => <p key={i} className="text-xs text-amber-600 dark:text-amber-400">{w}</p>)}
                        </div>
                      )}

                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        <span>Quality: {r.qualityScore}/100</span>
                        <span>Callbacks: {r.callbackRate}%</span>
                      </div>
                    </div>
                    <Button size="sm" variant={isSelected ? "default" : "outline"} onClick={() => setSelected(r.subcontractorId)}>
                      {isSelected ? "Selected" : "Select"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {selected && (
            <div className="flex justify-end">
              <Button
                className="w-full sm:w-auto"
                onClick={() => confirmMutation.mutate({
                  recommendationId: result.recommendationId,
                  subcontractorId: selected,
                  workArea: form.workArea || undefined,
                  timeWindow: form.timeWindow,
                  plannedStartTime: form.plannedStartTime || undefined,
                  plannedEndTime: form.plannedEndTime || undefined,
                  estimatedMetres: optionalNumber(form.estimatedMetres),
                  requiredColours: splitColours(form.colour),
                  notes: form.notes || undefined,
                })}
                disabled={confirmMutation.isPending}
              >
                <CheckCircle className="w-4 h-4 mr-2" />{confirmMutation.isPending ? "Scheduling..." : "Confirm & Schedule"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
