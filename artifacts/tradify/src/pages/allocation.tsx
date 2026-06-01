import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Brain, CheckCircle, AlertTriangle, XCircle, ChevronRight, Sparkles } from "lucide-react";

const REC_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  recommended: { icon: CheckCircle, color: "text-green-600", label: "Recommended" },
  suitable: { icon: CheckCircle, color: "text-orange-500", label: "Suitable" },
  possible: { icon: AlertTriangle, color: "text-amber-500", label: "Possible" },
  not_recommended: { icon: XCircle, color: "text-red-500", label: "Not Recommended" },
};

export default function Allocation() {
  const { toast } = useToast();
  const [form, setForm] = useState({ jobId: "", date: new Date().toISOString().split("T")[0], productType: "silicone", colour: "", estimatedMetres: "", jobType: "residential", suburb: "", builderProfileId: "" });
  const [result, setResult] = useState<any>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const { data: jobs = [] } = useQuery({ queryKey: ["jobs"], queryFn: () => fetch("/api/jobs").then((r) => r.json()) });
  const { data: builders = [] } = useQuery({ queryKey: ["builder-profiles"], queryFn: () => fetch("/api/builder-profiles").then((r) => r.json()) });

  const recommendMutation = useMutation({
    mutationFn: (data: any) => fetch("/api/allocation/recommend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then((r) => r.json()),
    onSuccess: (data) => { setResult(data); setSelected(data.autoSelected?.subcontractorId ?? null); },
    onError: () => toast({ title: "Error", description: "Could not get recommendations", variant: "destructive" }),
  });

  const confirmMutation = useMutation({
    mutationFn: (data: any) => fetch("/api/allocation/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then((r) => r.json()),
    onSuccess: () => toast({ title: "Employee/subcontractor allocated successfully" }),
  });

  function run() {
    if (!form.jobId || !form.date) { toast({ title: "Job and date are required" }); return; }
    const payload: any = { ...form, jobId: Number(form.jobId), estimatedMetres: form.estimatedMetres ? Number(form.estimatedMetres) : undefined };
    if (form.builderProfileId && form.builderProfileId !== "none") payload.builderProfileId = Number(form.builderProfileId);
    else delete payload.builderProfileId;
    recommendMutation.mutate(payload);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Smart Job Allocation</h1>
        <p className="text-muted-foreground mt-1">AI-powered employee/subcontractor recommendations based on skills, stock, proximity and builder tier</p>
      </div>

      {/* Request form */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Brain className="w-5 h-5" />Allocation Request</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Job</Label>
              <Select value={form.jobId} onValueChange={(v) => setForm((p) => ({ ...p, jobId: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select job…" /></SelectTrigger>
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
              <Label>Colour</Label>
              <Input className="mt-1" placeholder="e.g. Sandstone, White…" value={form.colour} onChange={(e) => setForm((p) => ({ ...p, colour: e.target.value }))} />
            </div>
            <div>
              <Label>Est. Metres</Label>
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
          </div>
          <Button onClick={run} disabled={recommendMutation.isPending}>
            <Sparkles className="w-4 h-4 mr-2" />
            {recommendMutation.isPending ? "Analysing…" : "Get Recommendations"}
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
              <Button onClick={() => confirmMutation.mutate({ recommendationId: result.recommendationId, subcontractorId: selected })}>
                <CheckCircle className="w-4 h-4 mr-2" />Confirm Allocation
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
