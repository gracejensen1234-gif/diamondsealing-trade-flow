import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Trophy, Star, Award, Plus, CheckCircle, Eye } from "lucide-react";

const AWARD_TYPES = [
  { value: "weekend_away", label: "🏖 Weekend Away" },
  { value: "tv", label: "📺 TV" },
  { value: "experience", label: "🎯 Experience" },
  { value: "voucher", label: "🎁 Voucher" },
  { value: "cash", label: "💵 Cash Bonus" },
  { value: "custom", label: "✨ Custom Award" },
];

export default function Awards() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const month = new Date().toISOString().slice(0, 7);
  const [form, setForm] = useState({ month, winnerId: "", awardType: "weekend_away", awardTitle: "", awardValue: "", reasonText: "" });

  const { data: awards = [] } = useQuery({ queryKey: ["monthly-awards"], queryFn: () => fetch("/api/monthly-awards").then((r) => r.json()) });
  const { data: rankings = [] } = useQuery({ queryKey: ["monthly-rankings", month], queryFn: () => fetch(`/api/monthly-rankings?month=${month}`).then((r) => r.json()) });
  const { data: subs = [] } = useQuery({ queryKey: ["subcontractors"], queryFn: () => fetch("/api/subcontractors").then((r) => r.json()) });

  const calcMutation = useMutation({
    mutationFn: () => fetch("/api/monthly-rankings/calculate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month }) }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["monthly-rankings"] }); toast({ title: "Rankings calculated" }); },
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => fetch("/api/monthly-awards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["monthly-awards"] }); setOpen(false); toast({ title: "Award created" }); },
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => fetch(`/api/monthly-awards/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["monthly-awards"] }); toast({ title: "Updated" }); },
  });

  const rankIcons = ["🥇", "🥈", "🥉"];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Awards & Rankings</h1>
          <p className="text-muted-foreground mt-1">Sub/Employee of the Month, monthly rankings, and rewards</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => calcMutation.mutate()} disabled={calcMutation.isPending}>
            <Star className="w-4 h-4 mr-2" />{calcMutation.isPending ? "Calculating…" : "Calculate Rankings"}
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Create Award</Button></DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>Create Monthly Award</DialogTitle></DialogHeader>
              <div className="space-y-4 mt-2">
                <div>
                  <Label>Month</Label>
                  <Input type="month" className="mt-1" value={form.month} onChange={(e) => setForm((p) => ({ ...p, month: e.target.value }))} />
                </div>
                <div>
                  <Label>Winner</Label>
                  <Select value={form.winnerId} onValueChange={(v) => setForm((p) => ({ ...p, winnerId: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select winner…" /></SelectTrigger>
                    <SelectContent>{(subs as any[]).filter((s: any) => s.active).map((s: any) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Award Type</Label>
                  <Select value={form.awardType} onValueChange={(v) => setForm((p) => ({ ...p, awardType: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{AWARD_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Award Title</Label>
                  <Input className="mt-1" placeholder="e.g. Noosa Weekend Getaway" value={form.awardTitle} onChange={(e) => setForm((p) => ({ ...p, awardTitle: e.target.value }))} />
                </div>
                <div>
                  <Label>Value ($)</Label>
                  <Input type="number" className="mt-1" value={form.awardValue} onChange={(e) => setForm((p) => ({ ...p, awardValue: e.target.value }))} />
                </div>
                <div>
                  <Label>Reason / Message</Label>
                  <Textarea className="mt-1 text-sm" rows={3} value={form.reasonText} onChange={(e) => setForm((p) => ({ ...p, reasonText: e.target.value }))} placeholder="Why they won this month…" />
                </div>
                <div className="flex gap-2 pt-2">
                  <Button className="flex-1" onClick={() => createMutation.mutate({ ...form, winnerId: Number(form.winnerId), awardValue: form.awardValue ? Number(form.awardValue) : undefined })} disabled={!form.winnerId || !form.awardTitle || !form.reasonText}>Create Award</Button>
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Current month rankings */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">{new Date(month + "-01").toLocaleString("en-AU", { month: "long", year: "numeric" })} Rankings</CardTitle>
        </CardHeader>
        <CardContent>
          {(rankings as any[]).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No rankings yet. Click "Calculate Rankings" to generate.</p>
          ) : (
            <div className="space-y-2">
              {(rankings as any[]).slice(0, 5).map((r: any, i: number) => (
                <div key={r.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50">
                  <span className="text-xl w-8 text-center">{rankIcons[i] ?? `#${i + 1}`}</span>
                  <div className="flex-1">
                    <p className="font-medium text-sm">{r.subcontractorName}</p>
                    <p className="text-xs text-muted-foreground">{r.totalMetres?.toFixed(0)}m · {r.avgMetresPerHour?.toFixed(1)} m/hr · {r.daysWorked} days</p>
                  </div>
                  <span className="font-bold text-lg">{r.totalScore?.toFixed(0)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Awards list */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">All Awards</h2>
        {(awards as any[]).map((a: any) => {
          const type = AWARD_TYPES.find((t) => t.value === a.awardType);
          return (
            <Card key={a.id} className={a.publishedToStaff ? "border-yellow-200 dark:border-yellow-800" : ""}>
              <CardContent className="pt-4">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center flex-shrink-0">
                    <Trophy className="w-5 h-5 text-yellow-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold">{a.winnerName}</p>
                      <Badge variant="outline" className="text-xs">{new Date(a.month + "-01").toLocaleString("en-AU", { month: "long", year: "numeric" })}</Badge>
                      {a.publishedToStaff && <Badge className="text-xs bg-yellow-500">Published</Badge>}
                      {a.adminApproved && !a.publishedToStaff && <Badge variant="secondary" className="text-xs">Approved</Badge>}
                    </div>
                    <p className="text-sm font-medium">{type?.label} — {a.awardTitle}</p>
                    <p className="text-sm text-muted-foreground mt-1">{a.reasonText}</p>
                    {a.awardValue && <p className="text-xs text-muted-foreground mt-1">Value: ${a.awardValue}</p>}
                  </div>
                  <div className="flex flex-col gap-1">
                    {!a.adminApproved && (
                      <Button size="sm" variant="outline" onClick={() => patchMutation.mutate({ id: a.id, data: { adminApproved: true } })}>
                        <CheckCircle className="w-3.5 h-3.5 mr-1" />Approve
                      </Button>
                    )}
                    {a.adminApproved && !a.publishedToStaff && (
                      <Button size="sm" onClick={() => patchMutation.mutate({ id: a.id, data: { publishedToStaff: true } })}>
                        <Eye className="w-3.5 h-3.5 mr-1" />Publish
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {(awards as any[]).length === 0 && (
          <Card><CardContent className="py-10 text-center text-muted-foreground">No awards created yet.</CardContent></Card>
        )}
      </div>
    </div>
  );
}
