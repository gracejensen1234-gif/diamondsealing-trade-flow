import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ChevronDown, ChevronUp, HardHat, Star, UserPlus } from "lucide-react";
import { useAuth } from "@/lib/auth";

const SKILL_FIELDS: { key: string; label: string; group: string }[] = [
  { key: "canSilicone", label: "Silicone", group: "Products" },
  { key: "canSikaflex", label: "Sikaflex", group: "Products" },
  { key: "canFireRated", label: "Fire-Rated Sealing", group: "Products" },
  { key: "canWaterproofing", label: "Waterproofing", group: "Products" },
  { key: "canBackerRod", label: "Backer Rod", group: "Products" },
  { key: "canPrimer", label: "Primer", group: "Products" },
  { key: "canJointPrep", label: "Joint Preparation", group: "Products" },
  { key: "canGrindingCutting", label: "Grinding/Cutting", group: "Products" },
  { key: "canResidential", label: "Residential", group: "Job Types" },
  { key: "canCommercial", label: "Commercial", group: "Job Types" },
  { key: "canPools", label: "Pools", group: "Job Types" },
  { key: "canCarParks", label: "Car Parks", group: "Job Types" },
];

export default function WorkerProfiles() {
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [edits, setEdits] = useState<Record<number, any>>({});
  const [showNewWorker, setShowNewWorker] = useState(false);
  const [newWorker, setNewWorker] = useState({ name: "", email: "", phone: "", abn: "" });

  const { data: subs = [] } = useQuery({
    queryKey: ["subcontractors"],
    queryFn: () => fetch("/api/subcontractors").then((r) => r.json()),
  });

  const { data: skills = [] } = useQuery({
    queryKey: ["worker-skills"],
    queryFn: () => fetch("/api/worker-skills").then((r) => r.json()),
  });

  const saveMutation = useMutation({
    mutationFn: ({ subId, data }: { subId: number; data: any }) =>
      fetch(`/api/worker-skills/${subId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["worker-skills"] }); toast({ title: "Saved" }); },
  });

  const createWorkerMutation = useMutation({
    mutationFn: (data: typeof newWorker) =>
      fetch("/api/subcontractors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          email: data.email,
          phone: data.phone || undefined,
          abn: data.abn || undefined,
          active: true,
        }),
      }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? "Could not add employee/subcontractor");
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subcontractors"] });
      setNewWorker({ name: "", email: "", phone: "", abn: "" });
      setShowNewWorker(false);
      toast({ title: "Employee/subcontractor added" });
    },
    onError: (error) => {
      toast({
        title: "Could not add employee/subcontractor",
        description: error instanceof Error ? error.message : "Check the employee/subcontractor details and try again.",
        variant: "destructive",
      });
    },
  });

  const skillMap = new Map((skills as any[]).map((s: any) => [s.subcontractorId, s]));

  function getEdit(subId: number, skillData: any) {
    return edits[subId] ?? skillData ?? {};
  }

  function updateEdit(subId: number, key: string, value: any) {
    setEdits((prev) => ({ ...prev, [subId]: { ...getEdit(subId, skillMap.get(subId)), [key]: value } }));
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Employee/Subcontractor Profiles</h1>
            <p className="text-muted-foreground mt-1">Skill sets, competencies, experience and performance scores</p>
            {user?.companySlug ? (
              <p className="mt-2 text-sm font-medium text-muted-foreground">
                Company code: <span className="text-foreground">{user.companySlug}</span>
              </p>
            ) : null}
          </div>
          <Button onClick={() => setShowNewWorker((value) => !value)}>
            <UserPlus className="mr-2 h-4 w-4" />
            Add Employee/Subcontractor
          </Button>
        </div>
      </div>

      {showNewWorker ? (
        <Card>
          <CardContent className="grid gap-4 pt-6 md:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="newWorkerName">Name</Label>
              <Input
                id="newWorkerName"
                value={newWorker.name}
                onChange={(event) => setNewWorker((worker) => ({ ...worker, name: event.target.value }))}
                autoComplete="name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newWorkerEmail">Email</Label>
              <Input
                id="newWorkerEmail"
                type="email"
                value={newWorker.email}
                onChange={(event) => setNewWorker((worker) => ({ ...worker, email: event.target.value }))}
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newWorkerPhone">Phone</Label>
              <Input
                id="newWorkerPhone"
                value={newWorker.phone}
                onChange={(event) => setNewWorker((worker) => ({ ...worker, phone: event.target.value }))}
                autoComplete="tel"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newWorkerAbn">ABN</Label>
              <Input
                id="newWorkerAbn"
                value={newWorker.abn}
                onChange={(event) => setNewWorker((worker) => ({ ...worker, abn: event.target.value }))}
              />
            </div>
            <div className="flex gap-2 md:col-span-4">
              <Button
                onClick={() => createWorkerMutation.mutate(newWorker)}
                disabled={!newWorker.name || !newWorker.email || createWorkerMutation.isPending}
              >
                {createWorkerMutation.isPending ? "Adding..." : "Add employee/subcontractor"}
              </Button>
              <Button variant="outline" onClick={() => setShowNewWorker(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-3">
        {(subs as any[]).filter((s: any) => s.active).map((sub: any) => {
          const sk = skillMap.get(sub.id);
          const edit = getEdit(sub.id, sk);
          const isOpen = expanded === sub.id;

          return (
            <Card key={sub.id}>
              <CardHeader className="pb-3 cursor-pointer" onClick={() => setExpanded(isOpen ? null : sub.id)}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                      <HardHat className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold">{sub.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-xs">{sk?.experienceLevel ?? "intermediate"}</Badge>
                        {sk?.canSilicone && <Badge variant="secondary" className="text-xs">Silicone</Badge>}
                        {sk?.canSikaflex && <Badge variant="secondary" className="text-xs">Sikaflex</Badge>}
                        {sk?.canCommercial && <Badge variant="secondary" className="text-xs">Commercial</Badge>}
                        {sk?.canPools && <Badge variant="secondary" className="text-xs">Pools</Badge>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right text-sm">
                      <div className="flex items-center gap-1 text-amber-600">
                        <Star className="w-3.5 h-3.5" />
                        <span className="font-semibold">{Number(sk?.qualityScore ?? 100).toFixed(0)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">quality score</p>
                    </div>
                    {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </div>
                </div>
              </CardHeader>

              {isOpen && (
                <CardContent className="pt-0 space-y-5">
                  {/* Experience */}
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <Label className="text-xs">Experience Level</Label>
                      <Select value={edit.experienceLevel ?? "intermediate"} onValueChange={(v) => updateEdit(sub.id, "experienceLevel", v)}>
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="junior">Junior</SelectItem>
                          <SelectItem value="intermediate">Intermediate</SelectItem>
                          <SelectItem value="senior">Senior</SelectItem>
                          <SelectItem value="specialist">Specialist</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1">
                      <Label className="text-xs">Years Experience</Label>
                      <input
                        type="number"
                        className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
                        value={edit.yearsExperience ?? 0}
                        onChange={(e) => updateEdit(sub.id, "yearsExperience", Number(e.target.value))}
                      />
                    </div>
                  </div>

                  {/* Skills grid */}
                  {["Products", "Job Types"].map((group) => (
                    <div key={group}>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{group}</p>
                      <div className="grid grid-cols-2 gap-2">
                        {SKILL_FIELDS.filter((f) => f.group === group).map((f) => (
                          <div key={f.key} className="flex items-center gap-2">
                            <Switch
                              checked={edit[f.key] ?? false}
                              onCheckedChange={(v) => updateEdit(sub.id, f.key, v)}
                            />
                            <Label className="text-sm cursor-pointer">{f.label}</Label>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* Notes */}
                  <div>
                    <Label className="text-xs">Notes</Label>
                    <Textarea
                      className="mt-1 text-sm"
                      rows={2}
                      value={edit.notes ?? ""}
                      onChange={(e) => updateEdit(sub.id, "notes", e.target.value)}
                      placeholder="Special skills, certifications, or notes…"
                    />
                  </div>

                  {/* Performance scores (read-only) */}
                  {sk && (
                    <div className="grid grid-cols-4 gap-3 p-3 bg-muted/30 rounded-lg text-xs">
                      <div><p className="text-muted-foreground">Punctuality</p><p className="font-semibold">{Number(sk.punctualityScore).toFixed(0)}/100</p></div>
                      <div><p className="text-muted-foreground">Photo Compliance</p><p className="font-semibold">{Number(sk.photoComplianceScore).toFixed(0)}/100</p></div>
                      <div><p className="text-muted-foreground">Callback Rate</p><p className="font-semibold">{Number(sk.callbackRate).toFixed(1)}%</p></div>
                      <div><p className="text-muted-foreground">Builder Rating</p><p className="font-semibold">{sk.builderRatingAvg ? `${Number(sk.builderRatingAvg).toFixed(1)}/5` : "—"}</p></div>
                    </div>
                  )}

                  <Button size="sm" onClick={() => saveMutation.mutate({ subId: sub.id, data: edit })}>Save Profile</Button>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
