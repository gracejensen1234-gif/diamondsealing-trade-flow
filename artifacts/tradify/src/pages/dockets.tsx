import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ScrollText, Plus, CheckCircle, Eye, FileCheck } from "lucide-react";

const STATUS_CFG: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  draft: { label: "Draft", variant: "outline" },
  pending_signature: { label: "Awaiting Signature", variant: "secondary" },
  signed: { label: "Signed", variant: "default" },
  disputed: { label: "Disputed", variant: "destructive" },
  void: { label: "Void", variant: "outline" },
};

export default function Dockets() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ jobId: "", subcontractorId: "", docketDate: new Date().toISOString().split("T")[0], description: "", metresCompleted: "", materialsUsed: "" });

  const { data: dockets = [] } = useQuery({ queryKey: ["dockets"], queryFn: () => fetch("/api/dockets").then((r) => r.json()) });
  const { data: jobs = [] } = useQuery({ queryKey: ["jobs"], queryFn: () => fetch("/api/jobs").then((r) => r.json()) });
  const { data: subs = [] } = useQuery({ queryKey: ["subcontractors"], queryFn: () => fetch("/api/subcontractors").then((r) => r.json()) });

  const createMutation = useMutation({
    mutationFn: (data: any) => fetch("/api/dockets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["dockets"] }); setOpen(false); toast({ title: "Docket created" }); },
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => fetch(`/api/dockets/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["dockets"] }); toast({ title: "Docket updated" }); },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dockets</h1>
          <p className="text-muted-foreground mt-1">Job completion dockets with signature capture and work records</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />New Docket</Button></DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Create Docket</DialogTitle></DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label>Job</Label>
                  <Select value={form.jobId} onValueChange={(v) => setForm((p) => ({ ...p, jobId: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select job…" /></SelectTrigger>
                    <SelectContent>{(jobs as any[]).map((j: any) => <SelectItem key={j.id} value={String(j.id)}>{j.title}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label>Subcontractor</Label>
                  <Select value={form.subcontractorId} onValueChange={(v) => setForm((p) => ({ ...p, subcontractorId: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select employee/subcontractor..." /></SelectTrigger>
                    <SelectContent>{(subs as any[]).filter((s: any) => s.active).map((s: any) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Date</Label>
                  <Input type="date" className="mt-1" value={form.docketDate} onChange={(e) => setForm((p) => ({ ...p, docketDate: e.target.value }))} />
                </div>
                <div>
                  <Label>Metres Completed</Label>
                  <Input type="number" className="mt-1" value={form.metresCompleted} onChange={(e) => setForm((p) => ({ ...p, metresCompleted: e.target.value }))} />
                </div>
              </div>
              <div>
                <Label>Description of Work</Label>
                <Input className="mt-1" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
              </div>
              <div>
                <Label>Materials Used</Label>
                <Input className="mt-1" placeholder="e.g. 12x white silicone, 4x primer" value={form.materialsUsed} onChange={(e) => setForm((p) => ({ ...p, materialsUsed: e.target.value }))} />
              </div>
              <div className="flex gap-2 pt-2">
                <Button className="flex-1" onClick={() => createMutation.mutate({ ...form, jobId: Number(form.jobId), subcontractorId: Number(form.subcontractorId), metresCompleted: form.metresCompleted ? Number(form.metresCompleted) : undefined })} disabled={!form.jobId || !form.subcontractorId}>Create Docket</Button>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {(["draft", "pending_signature", "signed", "disputed"] as const).map((status) => {
          const count = (dockets as any[]).filter((d: any) => d.status === status).length;
          const cfg = STATUS_CFG[status];
          return (
            <Card key={status}>
              <CardContent className="pt-5">
                <p className="text-sm text-muted-foreground">{cfg.label}</p>
                <p className="text-3xl font-bold mt-1">{count}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Docket list */}
      <div className="space-y-3">
        {(dockets as any[]).map((d: any) => {
          const cfg = STATUS_CFG[d.status] ?? STATUS_CFG.draft;
          return (
            <Card key={d.id}>
              <CardContent className="pt-4">
                <div className="flex items-start gap-4">
                  <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                    <ScrollText className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold text-sm">#{d.docketNumber ?? d.id} — {d.jobTitle}</p>
                      <Badge variant={cfg.variant} className="text-xs">{cfg.label}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{d.subcontractorName} · {new Date(d.docketDate).toLocaleDateString("en-AU")}</p>
                    {d.description && <p className="text-sm mt-1">{d.description}</p>}
                    <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                      {d.metresCompleted && <span>{Number(d.metresCompleted).toFixed(0)}m completed</span>}
                      {d.materialsUsed && <span>{d.materialsUsed}</span>}
                      {d.signedAt && <span>Signed {new Date(d.signedAt).toLocaleString("en-AU", { day: "numeric", month: "short" })}</span>}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {d.status === "draft" && (
                      <Button size="sm" variant="outline" onClick={() => patchMutation.mutate({ id: d.id, data: { status: "pending_signature" } })}>
                        Request Signature
                      </Button>
                    )}
                    {d.status === "pending_signature" && (
                      <Button size="sm" onClick={() => patchMutation.mutate({ id: d.id, data: { status: "signed", signedAt: new Date().toISOString() } })}>
                        <FileCheck className="w-3.5 h-3.5 mr-1" />Mark Signed
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {(dockets as any[]).length === 0 && (
          <Card><CardContent className="py-12 text-center text-muted-foreground">No dockets yet. Create one from a completed job.</CardContent></Card>
        )}
      </div>
    </div>
  );
}
