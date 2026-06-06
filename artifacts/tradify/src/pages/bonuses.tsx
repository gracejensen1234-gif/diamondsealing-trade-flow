import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/speech-textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Star, Plus, Calculator, CheckCircle, DollarSign } from "lucide-react";

const TRIGGER_LABELS: Record<string, string> = {
  metres_per_hour: "M/Hr Threshold",
  total_metres: "Total Metres",
  days_worked: "Days Worked",
  quality_score: "Quality Score",
  zero_callbacks: "Zero Callbacks",
  top_performer: "Top Performer",
  custom: "Custom",
};

const REWARD_LABELS: Record<string, string> = {
  cash: "Cash ($)",
  voucher: "Voucher",
  gift: "Gift",
  award: "Award",
  extra_leave: "Extra Leave",
  custom: "Custom",
};

const emptyRule = { name: "", description: "", triggerType: "metres_per_hour", triggerValue: "", rewardType: "cash", rewardValue: "", rewardDescription: "" };

export default function Bonuses() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [ruleOpen, setRuleOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyRule });
  const month = new Date().toISOString().slice(0, 7);

  const { data: rules = [] } = useQuery({ queryKey: ["bonus-rules"], queryFn: () => fetch("/api/bonus-rules").then((r) => r.json()) });
  const { data: calculations = [] } = useQuery({ queryKey: ["bonus-calculations", month], queryFn: () => fetch(`/api/bonus-calculations?month=${month}`).then((r) => r.json()) });
  const { data: subs = [] } = useQuery({ queryKey: ["subcontractors"], queryFn: () => fetch("/api/subcontractors").then((r) => r.json()) });

  const createRuleMutation = useMutation({
    mutationFn: (data: any) => fetch("/api/bonus-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bonus-rules"] }); setRuleOpen(false); setForm({ ...emptyRule }); toast({ title: "Bonus rule created" }); },
  });

  const calcMutation = useMutation({
    mutationFn: () => fetch("/api/bonus-calculations/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month }) }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bonus-calculations"] }); toast({ title: "Bonus calculations updated" }); },
  });

  const patchCalcMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => fetch(`/api/bonus-calculations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bonus-calculations"] }); toast({ title: "Updated" }); },
  });

  const totalUnpaid = (calculations as any[]).filter((c: any) => !c.paid && c.approved).reduce((a: number, c: any) => a + Number(c.rewardValue ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Bonus Management</h1>
          <p className="text-muted-foreground mt-1">Bonus rules, calculations, and approvals</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => calcMutation.mutate()} disabled={calcMutation.isPending}>
            <Calculator className="w-4 h-4 mr-2" />{calcMutation.isPending ? "Running…" : "Calculate Bonuses"}
          </Button>
          <Dialog open={ruleOpen} onOpenChange={setRuleOpen}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Add Rule</Button></DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>New Bonus Rule</DialogTitle></DialogHeader>
              <div className="space-y-4 mt-2">
                <div><Label>Rule Name</Label><Input className="mt-1" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></div>
                <div><Label>Description</Label><Textarea className="mt-1 text-sm" rows={2} value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Trigger Type</Label>
                    <Select value={form.triggerType} onValueChange={(v) => setForm((p) => ({ ...p, triggerType: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(TRIGGER_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Trigger Value</Label>
                    <Input type="number" className="mt-1" placeholder="e.g. 8" value={form.triggerValue} onChange={(e) => setForm((p) => ({ ...p, triggerValue: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Reward Type</Label>
                    <Select value={form.rewardType} onValueChange={(v) => setForm((p) => ({ ...p, rewardType: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(REWARD_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Reward Value ($)</Label>
                    <Input type="number" className="mt-1" value={form.rewardValue} onChange={(e) => setForm((p) => ({ ...p, rewardValue: e.target.value }))} />
                  </div>
                </div>
                <div><Label>Reward Description</Label><Input className="mt-1" placeholder="e.g. $200 cash bonus" value={form.rewardDescription} onChange={(e) => setForm((p) => ({ ...p, rewardDescription: e.target.value }))} /></div>
                <div className="flex gap-2 pt-2">
                  <Button className="flex-1" onClick={() => createRuleMutation.mutate({ ...form, triggerValue: Number(form.triggerValue), rewardValue: form.rewardValue ? Number(form.rewardValue) : undefined })} disabled={!form.name || !form.triggerValue}>Create Rule</Button>
                  <Button variant="outline" onClick={() => setRuleOpen(false)}>Cancel</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Unpaid total */}
      {totalUnpaid > 0 && (
        <div className="p-4 rounded-lg bg-green-50 border border-green-200 dark:bg-green-950/20 dark:border-green-800 flex items-center gap-3">
          <DollarSign className="w-5 h-5 text-green-600" />
          <p className="font-semibold text-green-700 dark:text-green-300">${totalUnpaid.toFixed(2)} in approved but unpaid bonuses this month</p>
        </div>
      )}

      <Tabs defaultValue="calculations">
        <TabsList>
          <TabsTrigger value="calculations">This Month ({(calculations as any[]).length})</TabsTrigger>
          <TabsTrigger value="rules">Rules ({(rules as any[]).length})</TabsTrigger>
        </TabsList>

        <TabsContent value="calculations" className="space-y-3 mt-4">
          {(calculations as any[]).length === 0 ? (
            <Card><CardContent className="py-10 text-center text-muted-foreground">No bonus calculations for {month}. Click "Calculate Bonuses" to generate.</CardContent></Card>
          ) : (calculations as any[]).map((c: any) => (
            <Card key={c.id}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold">{c.subcontractorName}</p>
                      {c.paid ? <Badge className="bg-green-500 text-xs">Paid</Badge> : c.approved ? <Badge variant="secondary" className="text-xs">Approved</Badge> : <Badge variant="outline" className="text-xs">Pending</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">{c.ruleName}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{c.triggerDetail}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold text-green-700 dark:text-green-400">${Number(c.rewardValue ?? 0).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">{c.rewardDescription ?? c.rewardType}</p>
                  </div>
                  <div className="flex flex-col gap-1">
                    {!c.approved && <Button size="sm" variant="outline" onClick={() => patchCalcMutation.mutate({ id: c.id, data: { approved: true } })}><CheckCircle className="w-3.5 h-3.5 mr-1" />Approve</Button>}
                    {c.approved && !c.paid && <Button size="sm" onClick={() => patchCalcMutation.mutate({ id: c.id, data: { paid: true } })}><DollarSign className="w-3.5 h-3.5 mr-1" />Mark Paid</Button>}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="rules" className="space-y-3 mt-4">
          {(rules as any[]).map((r: any) => (
            <Card key={r.id}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold">{r.name}</p>
                      <Badge variant="outline" className="text-xs">{TRIGGER_LABELS[r.triggerType]}</Badge>
                      {!r.active && <Badge variant="destructive" className="text-xs">Inactive</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">{r.description}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Trigger: {r.triggerValue} → Reward: {REWARD_LABELS[r.rewardType]} {r.rewardValue ? `$${r.rewardValue}` : ""} {r.rewardDescription ? `— ${r.rewardDescription}` : ""}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {(rules as any[]).length === 0 && (
            <Card><CardContent className="py-10 text-center text-muted-foreground">No bonus rules yet. Add one to start rewarding your team.</CardContent></Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
