import { useListCustomers } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/speech-textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Building2, Pencil, Phone, PhoneCall, Plus, Star } from "lucide-react";
import { phoneHref } from "@/lib/phone";

const TIER_LABELS: Record<string, { label: string; color: string }> = {
  premium: { label: "Premium", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300" },
  high_end: { label: "High End", color: "bg-zinc-100 text-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-300" },
  standard: { label: "Standard", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" },
  production: { label: "Production", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  budget: { label: "Budget", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" },
  custom: { label: "Custom", color: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300" },
};

type QualityTier = keyof typeof TIER_LABELS;

type BuilderProfile = {
  id: number;
  name: string;
  customerId?: number | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  qualityTier: QualityTier;
  customTierLabel?: string | null;
  preferredWorkerIds?: number[];
  avoidedWorkerIds?: number[];
  finishExpectations?: string | null;
  documentationRequirements?: string | null;
  signOffRequired?: boolean;
  signOffNotes?: string | null;
  siteNotes?: string | null;
  specialInstructions?: string | null;
  active?: boolean;
};

type ClientOption = {
  id: number;
  name: string;
  company?: string | null;
  phone?: string | null;
};

type EmployeeOption = {
  id: number;
  name: string;
  active?: boolean;
};

type BuilderForm = {
  name: string;
  customerId: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  qualityTier: QualityTier;
  customTierLabel: string;
  preferredWorkerIds: number[];
  avoidedWorkerIds: number[];
  finishExpectations: string;
  documentationRequirements: string;
  signOffRequired: boolean;
  signOffNotes: string;
  siteNotes: string;
  specialInstructions: string;
  active: boolean;
};

function emptyForm(): BuilderForm {
  return {
    name: "",
    customerId: "none",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    qualityTier: "standard",
    customTierLabel: "",
    preferredWorkerIds: [],
    avoidedWorkerIds: [],
    finishExpectations: "",
    documentationRequirements: "",
    signOffRequired: false,
    signOffNotes: "",
    siteNotes: "",
    specialInstructions: "",
    active: true,
  };
}

function toBuilderForm(profile: BuilderProfile): BuilderForm {
  return {
    name: profile.name ?? "",
    customerId: profile.customerId ? String(profile.customerId) : "none",
    contactName: profile.contactName ?? "",
    contactPhone: profile.contactPhone ?? "",
    contactEmail: profile.contactEmail ?? "",
    qualityTier: (profile.qualityTier ?? "standard") as QualityTier,
    customTierLabel: profile.customTierLabel ?? "",
    preferredWorkerIds: profile.preferredWorkerIds ?? [],
    avoidedWorkerIds: profile.avoidedWorkerIds ?? [],
    finishExpectations: profile.finishExpectations ?? "",
    documentationRequirements: profile.documentationRequirements ?? "",
    signOffRequired: profile.signOffRequired ?? false,
    signOffNotes: profile.signOffNotes ?? "",
    siteNotes: profile.siteNotes ?? "",
    specialInstructions: profile.specialInstructions ?? "",
    active: profile.active ?? true,
  };
}

function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function clientLabel(client?: ClientOption | null): string {
  if (!client) return "";
  return client.company && client.company !== client.name
    ? `${client.name} (${client.company})`
    : client.name;
}

function formPayload(form: BuilderForm) {
  return {
    name: form.name.trim(),
    customerId: form.customerId === "none" ? null : Number(form.customerId),
    contactName: optionalText(form.contactName),
    contactPhone: optionalText(form.contactPhone),
    contactEmail: optionalText(form.contactEmail),
    qualityTier: form.qualityTier,
    customTierLabel:
      form.qualityTier === "custom" ? optionalText(form.customTierLabel) : null,
    preferredWorkerIds: form.preferredWorkerIds,
    avoidedWorkerIds: form.avoidedWorkerIds,
    finishExpectations: optionalText(form.finishExpectations),
    documentationRequirements: optionalText(form.documentationRequirements),
    signOffRequired: form.signOffRequired,
    signOffNotes: optionalText(form.signOffNotes),
    siteNotes: optionalText(form.siteNotes),
    specialInstructions: optionalText(form.specialInstructions),
    active: form.active,
  };
}

function toggleId(ids: number[], id: number, checked: boolean) {
  return checked ? Array.from(new Set([...ids, id])) : ids.filter((item) => item !== id);
}

function BuilderFormFields({
  form,
  onChange,
  employees,
  clients,
  showActive = false,
}: {
  form: BuilderForm;
  onChange: (updates: Partial<BuilderForm>) => void;
  employees: EmployeeOption[];
  clients: ClientOption[];
  showActive?: boolean;
}) {
  const updatePreferred = (employeeId: number, checked: boolean) => {
    onChange({
      preferredWorkerIds: toggleId(form.preferredWorkerIds, employeeId, checked),
      avoidedWorkerIds: checked
        ? form.avoidedWorkerIds.filter((id) => id !== employeeId)
        : form.avoidedWorkerIds,
    });
  };

  const updateAvoided = (employeeId: number, checked: boolean) => {
    onChange({
      avoidedWorkerIds: toggleId(form.avoidedWorkerIds, employeeId, checked),
      preferredWorkerIds: checked
        ? form.preferredWorkerIds.filter((id) => id !== employeeId)
        : form.preferredWorkerIds,
    });
  };

  return (
    <div className="space-y-4 mt-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <Label>Billing client / head contractor</Label>
          <Select
            value={form.customerId}
            onValueChange={(value) => onChange({ customerId: value })}
          >
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="Select client" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Direct builder / no head contractor</SelectItem>
              {clients.length === 0 ? (
                <SelectItem value="no-clients" disabled>
                  Add a client first
                </SelectItem>
              ) : (
                clients.map((client) => (
                  <SelectItem key={client.id} value={String(client.id)}>
                    {clientLabel(client)}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label>Builder / Company Name</Label>
          <Input
            className="mt-1"
            value={form.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </div>
        <div>
          <Label>Contact Name</Label>
          <Input
            className="mt-1"
            value={form.contactName}
            onChange={(e) => onChange({ contactName: e.target.value })}
          />
        </div>
        <div>
          <div className="flex items-center justify-between gap-2">
            <Label>Contact Phone</Label>
            {phoneHref(form.contactPhone) && (
              <Button asChild size="sm" variant="outline" className="h-8 px-2">
                <a href={phoneHref(form.contactPhone) ?? undefined}>
                  <PhoneCall className="mr-1 h-3 w-3" />
                  Call
                </a>
              </Button>
            )}
          </div>
          <Input
            className="mt-1"
            value={form.contactPhone}
            onChange={(e) => onChange({ contactPhone: e.target.value })}
          />
        </div>
        <div className="sm:col-span-2">
          <Label>Contact Email</Label>
          <Input
            className="mt-1"
            type="email"
            value={form.contactEmail}
            onChange={(e) => onChange({ contactEmail: e.target.value })}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Quality Tier</Label>
          <Select
            value={form.qualityTier}
            onValueChange={(value) => onChange({ qualityTier: value as QualityTier })}
          >
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="premium">Premium - highest quality</SelectItem>
              <SelectItem value="high_end">High End - quality-focused</SelectItem>
              <SelectItem value="standard">Standard - balanced</SelectItem>
              <SelectItem value="production">Production - speed priority</SelectItem>
              <SelectItem value="budget">Budget - price priority</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {form.qualityTier === "custom" && (
          <div>
            <Label>Custom Tier Label</Label>
            <Input
              className="mt-1"
              value={form.customTierLabel}
              onChange={(e) => onChange({ customTierLabel: e.target.value })}
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Finish Expectations</Label>
          <Textarea
            className="mt-1 text-sm"
            rows={3}
            value={form.finishExpectations}
            onChange={(e) => onChange({ finishExpectations: e.target.value })}
          />
        </div>
        <div>
          <Label>Documentation Requirements</Label>
          <Textarea
            className="mt-1 text-sm"
            rows={3}
            value={form.documentationRequirements}
            onChange={(e) =>
              onChange({ documentationRequirements: e.target.value })
            }
          />
        </div>
        <div>
          <Label>Site Notes</Label>
          <Textarea
            className="mt-1 text-sm"
            rows={3}
            value={form.siteNotes}
            onChange={(e) => onChange({ siteNotes: e.target.value })}
          />
        </div>
        <div>
          <Label>Special Instructions</Label>
          <Textarea
            className="mt-1 text-sm"
            rows={3}
            value={form.specialInstructions}
            onChange={(e) => onChange({ specialInstructions: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-3 rounded-md border p-3">
        <div className="flex items-center justify-between gap-3">
          <Label>Builder sign-off required</Label>
          <Switch
            checked={form.signOffRequired}
            onCheckedChange={(checked) => onChange({ signOffRequired: checked })}
          />
        </div>
        {form.signOffRequired && (
          <div>
            <Label>Sign-off Notes</Label>
            <Textarea
              className="mt-1 text-sm"
              rows={2}
              value={form.signOffNotes}
              onChange={(e) => onChange({ signOffNotes: e.target.value })}
            />
          </div>
        )}
        {showActive && (
          <div className="flex items-center justify-between gap-3 border-t pt-3">
            <Label>Active builder profile</Label>
            <Switch
              checked={form.active}
              onCheckedChange={(checked) => onChange({ active: checked })}
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-md border p-3">
          <p className="text-sm font-medium">Preferred employees/subcontractors</p>
          <div className="mt-3 space-y-2">
            {employees.length === 0 && (
              <p className="text-xs text-muted-foreground">No employee/subcontractor profiles yet.</p>
            )}
            {employees.map((employee) => (
              <label key={employee.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.preferredWorkerIds.includes(employee.id)}
                  onCheckedChange={(checked) =>
                    updatePreferred(employee.id, checked === true)
                  }
                />
                <span>{employee.name}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-sm font-medium">Avoided employees/subcontractors</p>
          <div className="mt-3 space-y-2">
            {employees.length === 0 && (
              <p className="text-xs text-muted-foreground">No employee/subcontractor profiles yet.</p>
            )}
            {employees.map((employee) => (
              <label key={employee.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.avoidedWorkerIds.includes(employee.id)}
                  onCheckedChange={(checked) =>
                    updateAvoided(employee.id, checked === true)
                  }
                />
                <span>{employee.name}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

type BuilderProfilesProps = {
  embedded?: boolean;
};

export default function BuilderProfiles({ embedded = false }: BuilderProfilesProps = {}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [selectedProfile, setSelectedProfile] = useState<BuilderProfile | null>(null);
  const [editForm, setEditForm] = useState(emptyForm());
  const editOpen = selectedProfile !== null;

  const { data: profiles = [] } = useQuery<BuilderProfile[]>({
    queryKey: ["builder-profiles"],
    queryFn: () => fetch("/api/builder-profiles").then((r) => r.json()),
  });

  const { data: clients = [] } = useListCustomers();
  const clientMap = useMemo(
    () => new Map((clients as ClientOption[]).map((client) => [client.id, client])),
    [clients],
  );

  const { data: employees = [] } = useQuery<EmployeeOption[]>({
    queryKey: ["subcontractors"],
    queryFn: () => fetch("/api/subcontractors").then((r) => r.json()),
  });

  const { data: ratings = [] } = useQuery<any[]>({
    queryKey: ["builder-ratings"],
    queryFn: () => fetch("/api/builder-ratings").then((r) => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: async (data: BuilderForm) => {
      const response = await fetch("/api/builder-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formPayload(data)),
      });
      if (!response.ok) {
        throw new Error(
          (await response.json().catch(() => null))?.error ??
            "Could not create builder profile",
        );
      }
      return response.json() as Promise<BuilderProfile>;
    },
    onSuccess: (profile) => {
      qc.invalidateQueries({ queryKey: ["builder-profiles"] });
      setOpen(false);
      setForm(emptyForm());
      setSelectedProfile(profile);
      setEditForm(toBuilderForm(profile));
      toast({ title: "Builder profile created" });
    },
    onError: (error) => {
      toast({
        title: "Could not create builder profile",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: BuilderForm }) => {
      const response = await fetch(`/api/builder-profiles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formPayload(data)),
      });
      if (!response.ok) {
        throw new Error(
          (await response.json().catch(() => null))?.error ??
            "Could not save builder profile",
        );
      }
      return response.json() as Promise<BuilderProfile>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["builder-profiles"] });
      setSelectedProfile(null);
      toast({ title: "Builder profile saved" });
    },
    onError: (error) => {
      toast({
        title: "Could not save builder profile",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    },
  });

  const ratingsMap = new Map<number, any[]>();
  for (const r of ratings) {
    const arr = ratingsMap.get(r.builderProfileId) ?? [];
    arr.push(r);
    ratingsMap.set(r.builderProfileId, arr);
  }

  const openProfile = (profile: BuilderProfile) => {
    setSelectedProfile(profile);
    setEditForm(toBuilderForm(profile));
  };

  const profileGroups = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; title: string; subtitle: string; profiles: BuilderProfile[] }
    >();

    for (const profile of profiles) {
      const linkedClient = profile.customerId ? clientMap.get(profile.customerId) : null;
      const key = linkedClient ? `client-${linkedClient.id}` : "direct";
      const existing = groups.get(key);
      if (existing) {
        existing.profiles.push(profile);
        continue;
      }

      groups.set(key, {
        key,
        title: linkedClient ? clientLabel(linkedClient) : "Direct builders",
        subtitle: linkedClient
          ? "Builders and site contacts under this client"
          : "Builder profiles not linked to a head contractor",
        profiles: [profile],
      });
    }

    return Array.from(groups.values()).sort((a, b) => {
      if (a.key === "direct") return 1;
      if (b.key === "direct") return -1;
      return a.title.localeCompare(b.title);
    });
  }, [clientMap, profiles]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          {embedded ? (
            <h2 className="text-xl font-semibold tracking-tight">Builders</h2>
          ) : (
            <h1 className="text-2xl font-bold">Builder Profiles</h1>
          )}
          <p className="text-muted-foreground mt-1">Quality tiers, preferences, sign-off requirements and ratings</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />Add Builder</Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>New Builder Profile</DialogTitle></DialogHeader>
            <BuilderFormFields
              form={form}
              employees={employees}
              clients={clients as ClientOption[]}
              onChange={(updates) => setForm((current) => ({ ...current, ...updates }))}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                onClick={() => createMutation.mutate(form)}
                disabled={!form.name.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? "Creating..." : "Create Profile"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-5">
        {profileGroups.map((group) => (
          <section key={group.key} className="space-y-3">
            <div className="flex flex-col gap-1 border-b pb-2 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.title}
                </h3>
                <p className="text-xs text-muted-foreground">{group.subtitle}</p>
              </div>
              <Badge variant="outline" className="w-fit">
                {group.profiles.length} builder{group.profiles.length === 1 ? "" : "s"}
              </Badge>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {group.profiles.map((p) => {
                const tier = TIER_LABELS[p.qualityTier] ?? TIER_LABELS.standard;
                const bRatings = ratingsMap.get(p.id) ?? [];
                const avgRating = bRatings.length ? (bRatings.reduce((a: number, r: any) => a + r.rating, 0) / bRatings.length).toFixed(1) : null;
                const linkedClient = p.customerId ? clientMap.get(p.customerId) : null;

                return (
                  <Card
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => openProfile(p)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openProfile(p);
                      }
                    }}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="w-9 h-9 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Building2 className="w-5 h-5 text-primary" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="break-words font-semibold leading-snug">{p.name}</p>
                            {linkedClient && (
                              <p className="break-words text-xs text-muted-foreground">
                                Through {clientLabel(linkedClient)}
                              </p>
                            )}
                            {p.contactName && <p className="break-words text-xs text-muted-foreground">{p.contactName}</p>}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-row flex-wrap items-center gap-1 sm:flex-col sm:items-end">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tier.color}`}>{tier.label}</span>
                          {p.active === false && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {p.contactPhone && (
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <div className="flex min-w-0 items-center gap-2">
                            <Phone className="h-3 w-3 shrink-0" />
                            <span className="break-all">{p.contactPhone}</span>
                          </div>
                          {phoneHref(p.contactPhone) && (
                            <Button asChild size="sm" variant="outline" className="h-8 px-2 text-xs">
                              <a
                                href={phoneHref(p.contactPhone) ?? undefined}
                                onClick={(event) => event.stopPropagation()}
                                aria-label={`Call ${p.name}`}
                              >
                                <PhoneCall className="mr-1 h-3 w-3" />
                                Call
                              </a>
                            </Button>
                          )}
                        </div>
                      )}
                      {p.finishExpectations && <p className="break-words text-xs text-muted-foreground"><span className="font-medium text-foreground">Finish: </span>{p.finishExpectations}</p>}
                      {p.documentationRequirements && <p className="break-words text-xs text-muted-foreground"><span className="font-medium text-foreground">Docs: </span>{p.documentationRequirements}</p>}
                      {p.siteNotes && <p className="break-words text-xs text-muted-foreground"><span className="font-medium text-foreground">Site: </span>{p.siteNotes}</p>}
                      {p.specialInstructions && <p className="break-words text-xs text-muted-foreground"><span className="font-medium text-foreground">Instructions: </span>{p.specialInstructions}</p>}
                      <div className="flex flex-wrap items-center gap-4 pt-1">
                        {p.signOffRequired && <Badge variant="outline" className="text-xs">Sign-off required</Badge>}
                        {avgRating && (
                          <div className="flex items-center gap-1 text-amber-600 text-xs">
                            <Star className="w-3 h-3" />
                            <span className="font-semibold">{avgRating}</span>
                            <span className="text-muted-foreground">({bRatings.length} ratings)</span>
                          </div>
                        )}
                      </div>
                      <div className="pt-2 text-xs font-medium text-primary inline-flex items-center gap-1">
                        <Pencil className="w-3 h-3" />
                        View / edit
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      {profiles.length === 0 && (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No builder profiles yet. Add one to start managing quality tiers and preferences.</CardContent></Card>
      )}

      <Dialog
        open={editOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setSelectedProfile(null);
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editForm.name || "Builder Profile"}</DialogTitle>
          </DialogHeader>
          <BuilderFormFields
            form={editForm}
            employees={employees}
            clients={clients as ClientOption[]}
            showActive
            onChange={(updates) => setEditForm((current) => ({ ...current, ...updates }))}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedProfile(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (selectedProfile) updateMutation.mutate({ id: selectedProfile.id, data: editForm });
              }}
              disabled={!editForm.name.trim() || updateMutation.isPending}
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
