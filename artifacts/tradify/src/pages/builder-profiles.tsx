import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Building2, Plus, Star } from "lucide-react";

const TIER_LABELS: Record<string, { label: string; color: string }> = {
  premium: { label: "Premium", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300" },
  high_end: { label: "High End", color: "bg-zinc-100 text-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-300" },
  standard: { label: "Standard", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" },
  production: { label: "Production", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  budget: { label: "Budget", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" },
  custom: { label: "Custom", color: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300" },
};

const emptyForm = { name: "", contactName: "", contactPhone: "", qualityTier: "standard", finishExpectations: "", documentationRequirements: "", signOffRequired: false, siteNotes: "", specialInstructions: "" };

export default function BuilderProfiles() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });

  const { data: profiles = [] } = useQuery({
    queryKey: ["builder-profiles"],
    queryFn: () => fetch("/api/builder-profiles").then((r) => r.json()),
  });

  const { data: ratings = [] } = useQuery({
    queryKey: ["builder-ratings"],
    queryFn: () => fetch("/api/builder-ratings").then((r) => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => fetch("/api/builder-profiles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["builder-profiles"] }); setOpen(false); setForm({ ...emptyForm }); toast({ title: "Builder profile created" }); },
  });

  const ratingsMap = new Map<number, any[]>();
  for (const r of ratings as any[]) {
    const arr = ratingsMap.get(r.builderProfileId) ?? [];
    arr.push(r);
    ratingsMap.set(r.builderProfileId, arr);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Builder Profiles</h1>
          <p className="text-muted-foreground mt-1">Quality tiers, preferences, sign-off requirements and ratings</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />Add Builder</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>New Builder Profile</DialogTitle></DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><Label>Builder / Company Name</Label><Input className="mt-1" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></div>
                <div><Label>Contact Name</Label><Input className="mt-1" value={form.contactName} onChange={(e) => setForm((p) => ({ ...p, contactName: e.target.value }))} /></div>
                <div><Label>Contact Phone</Label><Input className="mt-1" value={form.contactPhone} onChange={(e) => setForm((p) => ({ ...p, contactPhone: e.target.value }))} /></div>
              </div>
              <div>
                <Label>Quality Tier</Label>
                <Select value={form.qualityTier} onValueChange={(v) => setForm((p) => ({ ...p, qualityTier: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="premium">Premium — highest quality, best employees/subcontractors</SelectItem>
                    <SelectItem value="high_end">High End — quality-focused</SelectItem>
                    <SelectItem value="standard">Standard — balanced quality & efficiency</SelectItem>
                    <SelectItem value="production">Production — speed & availability priority</SelectItem>
                    <SelectItem value="budget">Budget — price & availability primary</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Finish Expectations</Label><Textarea className="mt-1 text-sm" rows={2} value={form.finishExpectations} onChange={(e) => setForm((p) => ({ ...p, finishExpectations: e.target.value }))} /></div>
              <div><Label>Site Notes</Label><Textarea className="mt-1 text-sm" rows={2} value={form.siteNotes} onChange={(e) => setForm((p) => ({ ...p, siteNotes: e.target.value }))} /></div>
              <div className="flex items-center gap-2">
                <Switch checked={form.signOffRequired} onCheckedChange={(v) => setForm((p) => ({ ...p, signOffRequired: v }))} />
                <Label>Builder sign-off required</Label>
              </div>
              <div className="flex gap-2 pt-2">
                <Button className="flex-1" onClick={() => createMutation.mutate(form)} disabled={!form.name}>Create Profile</Button>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(profiles as any[]).map((p: any) => {
          const tier = TIER_LABELS[p.qualityTier] ?? TIER_LABELS.standard;
          const bRatings = ratingsMap.get(p.id) ?? [];
          const avgRating = bRatings.length ? (bRatings.reduce((a: number, r: any) => a + r.rating, 0) / bRatings.length).toFixed(1) : null;

          return (
            <Card key={p.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Building2 className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold">{p.name}</p>
                      {p.contactName && <p className="text-xs text-muted-foreground">{p.contactName}{p.contactPhone ? ` · ${p.contactPhone}` : ""}</p>}
                    </div>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tier.color}`}>{tier.label}</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {p.finishExpectations && <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Finish: </span>{p.finishExpectations}</p>}
                {p.siteNotes && <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Site: </span>{p.siteNotes}</p>}
                {p.specialInstructions && <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Instructions: </span>{p.specialInstructions}</p>}
                <div className="flex items-center gap-4 pt-1">
                  {p.signOffRequired && <Badge variant="outline" className="text-xs">Sign-off required</Badge>}
                  {avgRating && (
                    <div className="flex items-center gap-1 text-amber-600 text-xs">
                      <Star className="w-3 h-3" />
                      <span className="font-semibold">{avgRating}</span>
                      <span className="text-muted-foreground">({bRatings.length} ratings)</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {(profiles as any[]).length === 0 && (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No builder profiles yet. Add one to start managing quality tiers and preferences.</CardContent></Card>
      )}
    </div>
  );
}
