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
import { ChevronDown, ChevronUp, DollarSign, FileCheck2, HardHat, ImageIcon, Star, Trash2, Upload, UserPlus } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  CREDENTIAL_TYPES,
  type CredentialDraft,
  type WorkerCredential,
  compressCredentialImage,
  credentialLabel,
  emptyCredentialDraft,
} from "@/lib/worker-credentials";

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
  const isAdmin = user?.role === "admin";
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [edits, setEdits] = useState<Record<number, any>>({});
  const [rateEdits, setRateEdits] = useState<Record<number, { hourlyRate: string; ratePerMetre: string }>>({});
  const [credentialDrafts, setCredentialDrafts] = useState<Record<number, CredentialDraft>>({});
  const [showNewWorker, setShowNewWorker] = useState(false);
  const [newWorker, setNewWorker] = useState({ name: "", email: "", phone: "", abn: "", hourlyRate: "" });

  const { data: subs = [] } = useQuery({
    queryKey: ["subcontractors"],
    queryFn: () => fetch("/api/subcontractors").then((r) => r.json()),
  });

  const { data: skills = [] } = useQuery({
    queryKey: ["worker-skills"],
    queryFn: () => fetch("/api/worker-skills").then((r) => r.json()),
    enabled: isAdmin,
  });

  const { data: credentials = [] } = useQuery({
    queryKey: ["worker-credentials"],
    queryFn: () => fetch("/api/worker-credentials").then((r) => r.json()),
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
          hourlyRate: Number(data.hourlyRate) > 0 ? Number(data.hourlyRate) : undefined,
          active: true,
        }),
      }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? "Could not add employee/subcontractor");
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subcontractors"] });
      setNewWorker({ name: "", email: "", phone: "", abn: "", hourlyRate: "" });
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

  const updateRatesMutation = useMutation({
    mutationFn: async ({ subId, rates }: { subId: number; rates: { hourlyRate: string; ratePerMetre: string } }) => {
      const response = await fetch(`/api/subcontractors/${subId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hourlyRate: Number(rates.hourlyRate) > 0 ? Number(rates.hourlyRate) : 0,
          ratePerMetre: Number(rates.ratePerMetre) > 0 ? Number(rates.ratePerMetre) : 0,
        }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Could not save pay rates");
      return response.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subcontractors"] });
      toast({ title: "Pay rates saved" });
    },
    onError: (error) => {
      toast({
        title: "Could not save pay rates",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    },
  });

  const uploadCredentialMutation = useMutation({
    mutationFn: async ({ subId, file, draft }: { subId: number; file: File; draft: CredentialDraft }) => {
      const imageData = await compressCredentialImage(file);
      const label = credentialLabel(draft.documentType);
      const response = await fetch("/api/worker-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subcontractorId: subId,
          documentType: draft.documentType,
          label,
          imageData,
          fileName: file.name,
          expiryDate: draft.expiryDate || undefined,
          notes: draft.notes || undefined,
        }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Could not upload credential");
      return response.json();
    },
    onSuccess: (_credential, variables) => {
      qc.invalidateQueries({ queryKey: ["worker-credentials"] });
      setCredentialDrafts((prev) => ({
        ...prev,
        [variables.subId]: { documentType: variables.draft.documentType, expiryDate: "", notes: "" },
      }));
      toast({ title: "Credential uploaded" });
    },
    onError: (error) => {
      toast({
        title: "Could not upload credential",
        description: error instanceof Error ? error.message : "Choose a clear image and try again.",
        variant: "destructive",
      });
    },
  });

  const deleteCredentialMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/worker-credentials/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Could not delete credential");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["worker-credentials"] });
      toast({ title: "Credential deleted" });
    },
    onError: (error) => {
      toast({
        title: "Could not delete credential",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    },
  });

  const skillMap = new Map((skills as any[]).map((s: any) => [s.subcontractorId, s]));
  const credentialsBySub = new Map<number, any[]>();
  for (const credential of credentials as any[]) {
    const list = credentialsBySub.get(credential.subcontractorId) ?? [];
    list.push(credential);
    credentialsBySub.set(credential.subcontractorId, list);
  }

  function getEdit(subId: number, skillData: any) {
    return edits[subId] ?? skillData ?? {};
  }

  function getCredentialDraft(subId: number) {
    return credentialDrafts[subId] ?? emptyCredentialDraft();
  }

  function getRateEdit(sub: any) {
    return rateEdits[sub.id] ?? {
      hourlyRate: sub.hourlyRate != null ? String(sub.hourlyRate) : "",
      ratePerMetre: sub.ratePerMetre != null ? String(sub.ratePerMetre) : "",
    };
  }

  function updateRateEdit(sub: any, key: "hourlyRate" | "ratePerMetre", value: string) {
    setRateEdits((prev) => ({ ...prev, [sub.id]: { ...getRateEdit(sub), [key]: value } }));
  }

  function updateEdit(subId: number, key: string, value: any) {
    setEdits((prev) => ({ ...prev, [subId]: { ...getEdit(subId, skillMap.get(subId)), [key]: value } }));
  }

  function updateCredentialDraft(subId: number, key: keyof CredentialDraft, value: string) {
    setCredentialDrafts((prev) => ({ ...prev, [subId]: { ...getCredentialDraft(subId), [key]: value } }));
  }

  function handleCredentialUpload(subId: number, event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    uploadCredentialMutation.mutate({ subId, file, draft: getCredentialDraft(subId) });
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">{isAdmin ? "Employee/Subcontractor Profiles" : "My Profile"}</h1>
            <p className="text-muted-foreground mt-1">
              {isAdmin ? "Skill sets, competencies, experience and performance scores" : "Your contact details, pay rate and site credentials"}
            </p>
            {isAdmin && user?.companySlug ? (
              <p className="mt-2 text-sm font-medium text-muted-foreground">
                Company code: <span className="text-foreground">{user.companySlug}</span>
              </p>
            ) : null}
          </div>
          {isAdmin ? (
            <Button onClick={() => setShowNewWorker((value) => !value)}>
              <UserPlus className="mr-2 h-4 w-4" />
              Add Employee/Subcontractor
            </Button>
          ) : null}
        </div>
      </div>

      {isAdmin && showNewWorker ? (
        <Card>
          <CardContent className="grid gap-4 pt-6 md:grid-cols-5">
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
            <div className="space-y-2">
              <Label htmlFor="newWorkerHourlyRate">Hourly rate</Label>
              <Input
                id="newWorkerHourlyRate"
                type="number"
                min="0"
                step="0.01"
                value={newWorker.hourlyRate}
                onChange={(event) => setNewWorker((worker) => ({ ...worker, hourlyRate: event.target.value }))}
              />
            </div>
            <div className="flex gap-2 md:col-span-5">
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
          const rates = getRateEdit(sub);
          const subCredentials = credentialsBySub.get(sub.id) ?? [];
          const credentialDraft = getCredentialDraft(sub.id);
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
                        {isAdmin ? <Badge variant="outline" className="text-xs">{sk?.experienceLevel ?? "intermediate"}</Badge> : null}
                        {isAdmin && sk?.canSilicone && <Badge variant="secondary" className="text-xs">Silicone</Badge>}
                        {isAdmin && sk?.canSikaflex && <Badge variant="secondary" className="text-xs">Sikaflex</Badge>}
                        {isAdmin && sk?.canCommercial && <Badge variant="secondary" className="text-xs">Commercial</Badge>}
                        {isAdmin && sk?.canPools && <Badge variant="secondary" className="text-xs">Pools</Badge>}
                        {!isAdmin ? (
                          <Badge variant="outline" className="gap-1 text-xs">
                            <DollarSign className="h-3 w-3" />
                            {sub.hourlyRate != null ? `$${Number(sub.hourlyRate).toFixed(2)}/hr` : "Hourly rate not set"}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {isAdmin ? (
                      <div className="text-right text-sm">
                        <div className="flex items-center gap-1 text-amber-600">
                          <Star className="w-3.5 h-3.5" />
                          <span className="font-semibold">{Number(sk?.qualityScore ?? 100).toFixed(0)}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">quality score</p>
                      </div>
                    ) : null}
                    {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </div>
                </div>
              </CardHeader>

              {isOpen && (
                <CardContent className="pt-0 space-y-5">
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Pay rates</p>
                    {isAdmin ? (
                      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                        <div className="space-y-1">
                          <Label className="text-xs">Hourly rate</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={rates.hourlyRate}
                            onChange={(event) => updateRateEdit(sub, "hourlyRate", event.target.value)}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Rate per metre</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={rates.ratePerMetre}
                            onChange={(event) => updateRateEdit(sub, "ratePerMetre", event.target.value)}
                          />
                        </div>
                        <div className="flex items-end">
                          <Button
                            size="sm"
                            onClick={() => updateRatesMutation.mutate({ subId: sub.id, rates })}
                            disabled={updateRatesMutation.isPending}
                          >
                            Save rates
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="rounded-md border bg-background px-3 py-2">
                          <p className="text-xs text-muted-foreground">Hourly rate</p>
                          <p className="mt-1 text-lg font-semibold">
                            {sub.hourlyRate != null ? `$${Number(sub.hourlyRate).toFixed(2)}/hr` : "Not set"}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Experience */}
                  {isAdmin ? <div className="flex items-center gap-4">
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
                  </div> : null}

                  {/* Skills grid */}
                  {isAdmin ? ["Products", "Job Types"].map((group) => (
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
                  )) : null}

                  {/* Credentials */}
                  <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Licences & Documents</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Upload white cards, scissor lift licences, EWP tickets and other site credentials.
                      </p>
                    </div>
                    {subCredentials.length > 0 ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {subCredentials.map((credential: WorkerCredential) => (
                          <div key={credential.id} className="overflow-hidden rounded-md border bg-background">
                            <div className="aspect-[4/3] bg-muted">
                              <img src={credential.imageData} alt={credential.label} className="h-full w-full object-cover" />
                            </div>
                            <div className="space-y-2 p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold">{credential.label}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {credential.expiryDate ? `Expires ${new Date(credential.expiryDate).toLocaleDateString("en-AU")}` : "No expiry date"}
                                  </p>
                                  {credential.notes ? <p className="mt-1 text-xs text-muted-foreground">{credential.notes}</p> : null}
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                                  onClick={() => deleteCredentialMutation.mutate(credential.id)}
                                  disabled={deleteCredentialMutation.isPending}
                                  title="Delete credential"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 rounded-md border border-dashed bg-background/70 px-3 py-3 text-sm text-muted-foreground">
                        <FileCheck2 className="h-4 w-4" />
                        No credentials uploaded yet.
                      </div>
                    )}

                    <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                      <div className="space-y-1">
                        <Label className="text-xs">Document type</Label>
                        <Select
                          value={credentialDraft.documentType}
                          onValueChange={(value) => updateCredentialDraft(sub.id, "documentType", value)}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {CREDENTIAL_TYPES.map((type) => (
                              <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Expiry date</Label>
                        <Input
                          type="date"
                          value={credentialDraft.expiryDate}
                          onChange={(event) => updateCredentialDraft(sub.id, "expiryDate", event.target.value)}
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label className="text-xs">Notes</Label>
                        <Input
                          value={credentialDraft.notes}
                          onChange={(event) => updateCredentialDraft(sub.id, "notes", event.target.value)}
                          placeholder="Card number, licence class, restrictions..."
                        />
                      </div>
                      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border-2 border-dashed border-muted-foreground/30 bg-background px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted sm:col-span-2">
                        {uploadCredentialMutation.isPending ? <ImageIcon className="h-4 w-4 animate-pulse" /> : <Upload className="h-4 w-4" />}
                        {uploadCredentialMutation.isPending ? "Uploading..." : `Upload ${credentialLabel(credentialDraft.documentType)}`}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(event) => handleCredentialUpload(sub.id, event)}
                          disabled={uploadCredentialMutation.isPending}
                        />
                      </label>
                    </div>
                  </div>

                  {/* Notes */}
                  {isAdmin ? <div>
                    <Label className="text-xs">Notes</Label>
                    <Textarea
                      className="mt-1 text-sm"
                      rows={2}
                      value={edit.notes ?? ""}
                      onChange={(e) => updateEdit(sub.id, "notes", e.target.value)}
                      placeholder="Special skills, certifications, or notes…"
                    />
                  </div> : null}

                  {/* Performance scores (read-only) */}
                  {isAdmin && sk && (
                    <div className="grid grid-cols-4 gap-3 p-3 bg-muted/30 rounded-lg text-xs">
                      <div><p className="text-muted-foreground">Punctuality</p><p className="font-semibold">{Number(sk.punctualityScore).toFixed(0)}/100</p></div>
                      <div><p className="text-muted-foreground">Photo Compliance</p><p className="font-semibold">{Number(sk.photoComplianceScore).toFixed(0)}/100</p></div>
                      <div><p className="text-muted-foreground">Callback Rate</p><p className="font-semibold">{Number(sk.callbackRate).toFixed(1)}%</p></div>
                      <div><p className="text-muted-foreground">Builder Rating</p><p className="font-semibold">{sk.builderRatingAvg ? `${Number(sk.builderRatingAvg).toFixed(1)}/5` : "—"}</p></div>
                    </div>
                  )}

                  {isAdmin ? (
                    <Button size="sm" onClick={() => saveMutation.mutate({ subId: sub.id, data: edit })}>Save Profile</Button>
                  ) : null}
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
