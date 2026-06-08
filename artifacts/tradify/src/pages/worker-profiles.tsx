import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/speech-textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  DollarSign,
  FileCheck2,
  HardHat,
  ImageIcon,
  KeyRound,
  Star,
  StickyNote,
  Trash2,
  Upload,
  UserPlus,
} from "lucide-react";
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

const EXPERIENCE_LEVELS = [
  { value: "junior", label: "Junior" },
  { value: "intermediate", label: "Intermediate" },
  { value: "senior", label: "Senior" },
  { value: "specialist", label: "Specialist" },
];

const EMPLOYMENT_TYPES = [
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
  { value: "casual", label: "Casual" },
] as const;

const WORK_DAYS = [
  { value: 1, short: "Mon", label: "Monday" },
  { value: 2, short: "Tue", label: "Tuesday" },
  { value: 3, short: "Wed", label: "Wednesday" },
  { value: 4, short: "Thu", label: "Thursday" },
  { value: 5, short: "Fri", label: "Friday" },
  { value: 6, short: "Sat", label: "Saturday" },
  { value: 0, short: "Sun", label: "Sunday" },
];

type EmploymentType = (typeof EMPLOYMENT_TYPES)[number]["value"];
type ScheduleEdit = {
  employmentType: EmploymentType;
  availableDays: number[];
  scheduleNotes: string;
};

const DEFAULT_FULL_TIME_DAYS = [1, 2, 3, 4, 5];

function experienceLabel(value?: string | null) {
  return (
    EXPERIENCE_LEVELS.find((level) => level.value === value)?.label ??
    "Intermediate"
  );
}

function employmentLabel(value?: string | null) {
  return (
    EMPLOYMENT_TYPES.find((type) => type.value === value)?.label ?? "Casual"
  );
}

function normalizeAvailableDays(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((day) => Number(day))
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
    ),
  ).sort((a, b) => a - b);
}

function displayAvailableDays(employmentType: string, availableDays: number[]) {
  const days =
    availableDays.length > 0
      ? availableDays
      : employmentType === "full_time"
        ? DEFAULT_FULL_TIME_DAYS
        : [];

  if (days.length === 0) return "No set days";
  return WORK_DAYS.filter((day) => days.includes(day.value))
    .map((day) => day.short)
    .join(", ");
}

export default function WorkerProfiles() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [edits, setEdits] = useState<Record<number, any>>({});
  const [rateEdits, setRateEdits] = useState<
    Record<
      number,
      { hourlyRate: string; ratePerMetre: string; gstRegistered: boolean }
    >
  >({});
  const [scheduleEdits, setScheduleEdits] = useState<
    Record<number, ScheduleEdit>
  >({});
  const [accountDrafts, setAccountDrafts] = useState<
    Record<number, { email: string; temporaryPassword: string }>
  >({});
  const [credentialDrafts, setCredentialDrafts] = useState<
    Record<number, CredentialDraft>
  >({});
  const [showNewWorker, setShowNewWorker] = useState(false);
  const [newWorker, setNewWorker] = useState({
    name: "",
    email: "",
    phone: "",
    abn: "",
    hourlyRate: "",
    gstRegistered: false,
    employmentType: "casual" as EmploymentType,
    availableDays: [] as number[],
    scheduleNotes: "",
    temporaryPassword: "",
  });

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
    mutationFn: async ({ subId, data }: { subId: number; data: any }) => {
      const response = await fetch(`/api/worker-skills/${subId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        throw new Error(
          (await response.json().catch(() => null))?.error ??
            "Could not save employee/subcontractor profile",
        );
      }
      return response.json();
    },
    onSuccess: (saved) => {
      if (saved?.subcontractorId) {
        setEdits((prev) => ({
          ...prev,
          [saved.subcontractorId]: saved,
        }));
      }
      qc.invalidateQueries({ queryKey: ["worker-skills"] });
      toast({ title: "Saved" });
    },
    onError: (error) => {
      toast({
        title: "Could not save profile",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    },
  });

  const createWorkerMutation = useMutation({
    mutationFn: async (data: typeof newWorker) => {
      const createResponse = await fetch("/api/subcontractors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          email: data.email,
          phone: data.phone || undefined,
          abn: data.abn || undefined,
          hourlyRate:
            Number(data.hourlyRate) > 0 ? Number(data.hourlyRate) : undefined,
          gstRegistered: data.gstRegistered,
          employmentType: data.employmentType,
          availableDays: data.availableDays,
          scheduleNotes: data.scheduleNotes || undefined,
          active: true,
        }),
      });
      if (!createResponse.ok) {
        throw new Error(
          (await createResponse.json().catch(() => null))?.error ??
            "Could not add employee/subcontractor",
        );
      }

      const sub = await createResponse.json();
      if (data.temporaryPassword) {
        const accountResponse = await fetch(
          `/api/subcontractors/${sub.id}/worker-account`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: data.email,
              name: data.name,
              password: data.temporaryPassword,
            }),
          },
        );
        if (!accountResponse.ok) {
          throw new Error(
            (await accountResponse.json().catch(() => null))?.error ??
              "Employee/subcontractor was added, but the app login could not be created",
          );
        }
        return { sub, loginCreated: true };
      }

      return { sub, loginCreated: false };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["subcontractors"] });
      setNewWorker({
        name: "",
        email: "",
        phone: "",
        abn: "",
        hourlyRate: "",
        gstRegistered: false,
        employmentType: "casual",
        availableDays: [],
        scheduleNotes: "",
        temporaryPassword: "",
      });
      setShowNewWorker(false);
      toast({
        title: result.loginCreated
          ? "Employee/subcontractor and login added"
          : "Employee/subcontractor added",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not add employee/subcontractor",
        description:
          error instanceof Error
            ? error.message
            : "Check the employee/subcontractor details and try again.",
        variant: "destructive",
      });
    },
  });

  const updateRatesMutation = useMutation({
    mutationFn: async ({
      subId,
      rates,
    }: {
      subId: number;
      rates: {
        hourlyRate: string;
        ratePerMetre: string;
        gstRegistered: boolean;
      };
    }) => {
      const response = await fetch(`/api/subcontractors/${subId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hourlyRate:
            Number(rates.hourlyRate) > 0 ? Number(rates.hourlyRate) : 0,
          ratePerMetre:
            Number(rates.ratePerMetre) > 0 ? Number(rates.ratePerMetre) : 0,
          gstRegistered: rates.gstRegistered,
        }),
      });
      if (!response.ok)
        throw new Error(
          (await response.json().catch(() => null))?.error ??
            "Could not save pay rates",
        );
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

  const updateScheduleMutation = useMutation({
    mutationFn: async ({
      subId,
      schedule,
    }: {
      subId: number;
      schedule: ScheduleEdit;
    }) => {
      const response = await fetch(`/api/subcontractors/${subId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employmentType: schedule.employmentType,
          availableDays: schedule.availableDays,
          scheduleNotes: schedule.scheduleNotes,
        }),
      });
      if (!response.ok)
        throw new Error(
          (await response.json().catch(() => null))?.error ??
            "Could not save schedule",
        );
      return response.json();
    },
    onSuccess: (_saved, variables) => {
      qc.invalidateQueries({ queryKey: ["subcontractors"] });
      setScheduleEdits((prev) => {
        const next = { ...prev };
        delete next[variables.subId];
        return next;
      });
      toast({ title: "Schedule saved" });
    },
    onError: (error) => {
      toast({
        title: "Could not save schedule",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    },
  });

  const workerAccountMutation = useMutation({
    mutationFn: async ({
      sub,
      draft,
    }: {
      sub: any;
      draft: { email: string; temporaryPassword: string };
    }) => {
      const response = await fetch(
        `/api/subcontractors/${sub.id}/worker-account`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: draft.email,
            name: sub.name,
            password: draft.temporaryPassword,
          }),
        },
      );
      if (!response.ok)
        throw new Error(
          (await response.json().catch(() => null))?.error ??
            "Could not set employee/subcontractor login",
        );
      return response.json();
    },
    onSuccess: (_result, variables) => {
      qc.invalidateQueries({ queryKey: ["subcontractors"] });
      setAccountDrafts((prev) => ({
        ...prev,
        [variables.sub.id]: {
          email: prev[variables.sub.id]?.email ?? variables.sub.email ?? "",
          temporaryPassword: "",
        },
      }));
      toast({ title: "Employee/subcontractor login ready" });
    },
    onError: (error) => {
      toast({
        title: "Could not set employee/subcontractor login",
        description:
          error instanceof Error
            ? error.message
            : "Check the login email and temporary password.",
        variant: "destructive",
      });
    },
  });

  const uploadCredentialMutation = useMutation({
    mutationFn: async ({
      subId,
      file,
      draft,
    }: {
      subId: number;
      file: File;
      draft: CredentialDraft;
    }) => {
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
      if (!response.ok)
        throw new Error(
          (await response.json().catch(() => null))?.error ??
            "Could not upload credential",
        );
      return response.json();
    },
    onSuccess: (_credential, variables) => {
      qc.invalidateQueries({ queryKey: ["worker-credentials"] });
      setCredentialDrafts((prev) => ({
        ...prev,
        [variables.subId]: {
          documentType: variables.draft.documentType,
          expiryDate: "",
          notes: "",
        },
      }));
      toast({ title: "Credential uploaded" });
    },
    onError: (error) => {
      toast({
        title: "Could not upload credential",
        description:
          error instanceof Error
            ? error.message
            : "Choose a clear image and try again.",
        variant: "destructive",
      });
    },
  });

  const deleteCredentialMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/worker-credentials/${id}`, {
        method: "DELETE",
      });
      if (!response.ok)
        throw new Error(
          (await response.json().catch(() => null))?.error ??
            "Could not delete credential",
        );
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

  const skillMap = new Map(
    (skills as any[]).map((s: any) => [s.subcontractorId, s]),
  );
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
    return (
      rateEdits[sub.id] ?? {
        hourlyRate: sub.hourlyRate != null ? String(sub.hourlyRate) : "",
        ratePerMetre: sub.ratePerMetre != null ? String(sub.ratePerMetre) : "",
        gstRegistered: Boolean(sub.gstRegistered),
      }
    );
  }

  function initialScheduleEdit(sub: any): ScheduleEdit {
    const employmentType = EMPLOYMENT_TYPES.some(
      (type) => type.value === sub.employmentType,
    )
      ? (sub.employmentType as EmploymentType)
      : "casual";

    return {
      employmentType,
      availableDays: normalizeAvailableDays(sub.availableDays),
      scheduleNotes: sub.scheduleNotes ?? "",
    };
  }

  function getScheduleEdit(sub: any): ScheduleEdit {
    return scheduleEdits[sub.id] ?? initialScheduleEdit(sub);
  }

  function getAccountDraft(sub: any) {
    return (
      accountDrafts[sub.id] ?? {
        email: sub.email ?? "",
        temporaryPassword: "",
      }
    );
  }

  function updateRateEdit(
    sub: any,
    key: "hourlyRate" | "ratePerMetre",
    value: string,
  ) {
    setRateEdits((prev) => ({
      ...prev,
      [sub.id]: { ...getRateEdit(sub), [key]: value },
    }));
  }

  function updateRateGstEdit(sub: any, value: boolean) {
    setRateEdits((prev) => ({
      ...prev,
      [sub.id]: { ...getRateEdit(sub), gstRegistered: value },
    }));
  }

  function updateScheduleType(sub: any, employmentType: EmploymentType) {
    setScheduleEdits((prev) => {
      const current = prev[sub.id] ?? initialScheduleEdit(sub);
      const availableDays =
        employmentType === "full_time" && current.availableDays.length === 0
          ? DEFAULT_FULL_TIME_DAYS
          : current.availableDays;
      return {
        ...prev,
        [sub.id]: { ...current, employmentType, availableDays },
      };
    });
  }

  function toggleScheduleDay(sub: any, day: number) {
    setScheduleEdits((prev) => {
      const current = prev[sub.id] ?? initialScheduleEdit(sub);
      const selected = current.availableDays.includes(day);
      const availableDays = selected
        ? current.availableDays.filter((value) => value !== day)
        : [...current.availableDays, day].sort((a, b) => a - b);
      return { ...prev, [sub.id]: { ...current, availableDays } };
    });
  }

  function updateScheduleNotes(sub: any, value: string) {
    setScheduleEdits((prev) => {
      const current = prev[sub.id] ?? initialScheduleEdit(sub);
      return { ...prev, [sub.id]: { ...current, scheduleNotes: value } };
    });
  }

  function updateNewWorkerEmploymentType(employmentType: EmploymentType) {
    setNewWorker((worker) => ({
      ...worker,
      employmentType,
      availableDays:
        employmentType === "full_time" && worker.availableDays.length === 0
          ? DEFAULT_FULL_TIME_DAYS
          : worker.availableDays,
    }));
  }

  function toggleNewWorkerDay(day: number) {
    setNewWorker((worker) => {
      const selected = worker.availableDays.includes(day);
      return {
        ...worker,
        availableDays: selected
          ? worker.availableDays.filter((value) => value !== day)
          : [...worker.availableDays, day].sort((a, b) => a - b),
      };
    });
  }

  function updateAccountDraft(
    sub: any,
    key: "email" | "temporaryPassword",
    value: string,
  ) {
    setAccountDrafts((prev) => {
      const existing = prev[sub.id] ?? {
        email: sub.email ?? "",
        temporaryPassword: "",
      };
      return { ...prev, [sub.id]: { ...existing, [key]: value } };
    });
  }

  function updateEdit(subId: number, key: string, value: any) {
    setEdits((prev) => ({
      ...prev,
      [subId]: { ...getEdit(subId, skillMap.get(subId)), [key]: value },
    }));
  }

  function updateCredentialDraft(
    subId: number,
    key: keyof CredentialDraft,
    value: string,
  ) {
    setCredentialDrafts((prev) => ({
      ...prev,
      [subId]: { ...getCredentialDraft(subId), [key]: value },
    }));
  }

  function handleCredentialUpload(
    subId: number,
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    uploadCredentialMutation.mutate({
      subId,
      file,
      draft: getCredentialDraft(subId),
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">
              {isAdmin ? "Employee/Subcontractor Profiles" : "My Profile"}
            </h1>
            <p className="text-muted-foreground mt-1">
              {isAdmin
                ? "Skill sets, competencies, experience and performance scores"
                : "Your contact details, pay rate and site credentials"}
            </p>
            {isAdmin && user?.companySlug ? (
              <p className="mt-2 text-sm font-medium text-muted-foreground">
                Company code:{" "}
                <span className="text-foreground">{user.companySlug}</span>
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
          <CardContent className="grid gap-4 pt-6 md:grid-cols-3 xl:grid-cols-6">
            <div className="space-y-2">
              <Label htmlFor="newWorkerName">Name</Label>
              <Input
                id="newWorkerName"
                value={newWorker.name}
                onChange={(event) =>
                  setNewWorker((worker) => ({
                    ...worker,
                    name: event.target.value,
                  }))
                }
                autoComplete="name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newWorkerEmail">Email</Label>
              <Input
                id="newWorkerEmail"
                type="email"
                value={newWorker.email}
                onChange={(event) =>
                  setNewWorker((worker) => ({
                    ...worker,
                    email: event.target.value,
                  }))
                }
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newWorkerPhone">Phone</Label>
              <Input
                id="newWorkerPhone"
                value={newWorker.phone}
                onChange={(event) =>
                  setNewWorker((worker) => ({
                    ...worker,
                    phone: event.target.value,
                  }))
                }
                autoComplete="tel"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newWorkerAbn">ABN</Label>
              <Input
                id="newWorkerAbn"
                value={newWorker.abn}
                onChange={(event) =>
                  setNewWorker((worker) => ({
                    ...worker,
                    abn: event.target.value,
                  }))
                }
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
                onChange={(event) =>
                  setNewWorker((worker) => ({
                    ...worker,
                    hourlyRate: event.target.value,
                  }))
                }
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2">
              <div>
                <Label htmlFor="newWorkerGstRegistered">GST registered</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Turn on only if this worker charges GST.
                </p>
              </div>
              <Switch
                id="newWorkerGstRegistered"
                checked={newWorker.gstRegistered}
                onCheckedChange={(checked) =>
                  setNewWorker((worker) => ({
                    ...worker,
                    gstRegistered: checked,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newWorkerEmploymentType">Schedule type</Label>
              <Select
                value={newWorker.employmentType}
                onValueChange={(value) =>
                  updateNewWorkerEmploymentType(value as EmploymentType)
                }
              >
                <SelectTrigger id="newWorkerEmploymentType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EMPLOYMENT_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2 xl:col-span-3">
              <Label>Available days</Label>
              <div className="flex flex-wrap gap-2">
                {WORK_DAYS.map((day) => {
                  const selected = newWorker.availableDays.includes(day.value);
                  return (
                    <Button
                      key={day.value}
                      type="button"
                      size="sm"
                      variant={selected ? "default" : "outline"}
                      className="h-9 min-w-12 px-3"
                      onClick={() => toggleNewWorkerDay(day.value)}
                      aria-pressed={selected}
                      title={day.label}
                    >
                      {day.short}
                    </Button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-2 md:col-span-3 xl:col-span-6">
              <Label htmlFor="newWorkerScheduleNotes">Schedule notes</Label>
              <Textarea
                id="newWorkerScheduleNotes"
                className="min-h-20 text-sm"
                value={newWorker.scheduleNotes}
                onChange={(event) =>
                  setNewWorker((worker) => ({
                    ...worker,
                    scheduleNotes: event.target.value,
                  }))
                }
                placeholder="Preferred days, school pickup limits, part-time hours, casual availability..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newWorkerTemporaryPassword">
                Temporary password
              </Label>
              <Input
                id="newWorkerTemporaryPassword"
                value={newWorker.temporaryPassword}
                onChange={(event) =>
                  setNewWorker((worker) => ({
                    ...worker,
                    temporaryPassword: event.target.value,
                  }))
                }
                autoComplete="new-password"
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row md:col-span-6">
              <Button
                className="sm:w-auto"
                onClick={() => createWorkerMutation.mutate(newWorker)}
                disabled={
                  !newWorker.name ||
                  !newWorker.email ||
                  Boolean(
                    newWorker.temporaryPassword &&
                    newWorker.temporaryPassword.length < 6,
                  ) ||
                  createWorkerMutation.isPending
                }
              >
                {createWorkerMutation.isPending
                  ? "Adding..."
                  : newWorker.temporaryPassword
                    ? "Add and set login"
                    : "Add employee/subcontractor"}
              </Button>
              <Button
                variant="outline"
                className="sm:w-auto"
                onClick={() => setShowNewWorker(false)}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-3">
        {(subs as any[])
          .filter((s: any) => s.active)
          .map((sub: any) => {
            const sk = skillMap.get(sub.id);
            const edit = getEdit(sub.id, sk);
            const rates = getRateEdit(sub);
            const accountDraft = getAccountDraft(sub);
            const subCredentials = credentialsBySub.get(sub.id) ?? [];
            const credentialDraft = getCredentialDraft(sub.id);
            const savedSchedule = initialScheduleEdit(sub);
            const schedule = getScheduleEdit(sub);
            const isOpen = expanded === sub.id;

            return (
              <Card key={sub.id}>
                <CardHeader
                  className="pb-3 cursor-pointer"
                  onClick={() => setExpanded(isOpen ? null : sub.id)}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="w-9 h-9 shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
                        <HardHat className="w-5 h-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold leading-snug">{sub.name}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          {isAdmin ? (
                            <Badge variant="outline" className="text-xs">
                              Grade: {experienceLabel(sk?.experienceLevel)}
                            </Badge>
                          ) : null}
                          {isAdmin && sk?.canSilicone && (
                            <Badge variant="secondary" className="text-xs">
                              Silicone
                            </Badge>
                          )}
                          {isAdmin && sk?.canSikaflex && (
                            <Badge variant="secondary" className="text-xs">
                              Sikaflex
                            </Badge>
                          )}
                          {isAdmin && sk?.canCommercial && (
                            <Badge variant="secondary" className="text-xs">
                              Commercial
                            </Badge>
                          )}
                          {isAdmin && sk?.canPools && (
                            <Badge variant="secondary" className="text-xs">
                              Pools
                            </Badge>
                          )}
                          {isAdmin && sk?.notes ? (
                            <Badge variant="outline" className="gap-1 text-xs">
                              <StickyNote className="h-3 w-3" /> Notes
                            </Badge>
                          ) : null}
                          <Badge variant="outline" className="gap-1 text-xs">
                            <CalendarDays className="h-3 w-3" />
                            {employmentLabel(savedSchedule.employmentType)}
                          </Badge>
                          <Badge variant="secondary" className="text-xs">
                            {displayAvailableDays(
                              savedSchedule.employmentType,
                              savedSchedule.availableDays,
                            )}
                          </Badge>
                          {!isAdmin ? (
                            <Badge variant="outline" className="gap-1 text-xs">
                              <DollarSign className="h-3 w-3" />
                              {sub.hourlyRate != null
                                ? `$${Number(sub.hourlyRate).toFixed(2)}/hr`
                                : "Hourly rate not set"}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center justify-between gap-4 sm:justify-end">
                      {isAdmin ? (
                        <div className="text-right text-sm">
                          <div className="flex items-center justify-end gap-1 text-amber-600">
                            <Star className="w-3.5 h-3.5" />
                            <span className="font-semibold">
                              {Number(sk?.qualityScore ?? 100).toFixed(0)}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            quality score
                          </p>
                        </div>
                      ) : null}
                      {isOpen ? (
                        <ChevronUp className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>
                </CardHeader>

                {isOpen && (
                  <CardContent className="pt-0 space-y-5">
                    {isAdmin ? (
                      <div className="rounded-lg border bg-muted/20 p-3">
                        <div className="mb-3 flex items-start gap-2">
                          <StickyNote className="mt-0.5 h-4 w-4 text-primary" />
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Admin notes
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Internal notes for office/admin only.
                              Employees/subcontractors cannot see this section.
                            </p>
                          </div>
                        </div>
                        <Textarea
                          className="min-h-24 text-sm"
                          value={edit.notes ?? ""}
                          onChange={(event) =>
                            updateEdit(sub.id, "notes", event.target.value)
                          }
                          placeholder="Availability notes, preferred builders, work habits, follow-up items, payroll reminders..."
                        />
                      </div>
                    ) : null}

                    <div className="rounded-lg border bg-muted/20 p-3">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                        Pay rates
                      </p>
                      {isAdmin ? (
                        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                          <div className="space-y-1">
                            <Label className="text-xs">Hourly rate</Label>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={rates.hourlyRate}
                              onChange={(event) =>
                                updateRateEdit(
                                  sub,
                                  "hourlyRate",
                                  event.target.value,
                                )
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Rate per metre</Label>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={rates.ratePerMetre}
                              onChange={(event) =>
                                updateRateEdit(
                                  sub,
                                  "ratePerMetre",
                                  event.target.value,
                                )
                              }
                            />
                          </div>
                          <div className="flex flex-col gap-3 rounded-md border bg-background px-3 py-2 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <Label className="text-xs">GST registered</Label>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Adds 10% GST to this worker's weekly invoices.
                              </p>
                            </div>
                            <Switch
                              checked={rates.gstRegistered}
                              onCheckedChange={(checked) =>
                                updateRateGstEdit(sub, checked)
                              }
                            />
                          </div>
                          <div className="flex items-end sm:justify-end">
                            <Button
                              size="sm"
                              onClick={() =>
                                updateRatesMutation.mutate({
                                  subId: sub.id,
                                  rates,
                                })
                              }
                              disabled={updateRatesMutation.isPending}
                            >
                              Save rates
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div className="rounded-md border bg-background px-3 py-2">
                            <p className="text-xs text-muted-foreground">
                              Hourly rate
                            </p>
                            <p className="mt-1 text-lg font-semibold">
                              {sub.hourlyRate != null
                                ? `$${Number(sub.hourlyRate).toFixed(2)}/hr`
                                : "Not set"}
                            </p>
                          </div>
                          <div className="rounded-md border bg-background px-3 py-2">
                            <p className="text-xs text-muted-foreground">GST</p>
                            <p className="mt-1 text-lg font-semibold">
                              {sub.gstRegistered ? "GST registered" : "No GST"}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="rounded-lg border bg-muted/20 p-3">
                      <div className="mb-3 flex items-start gap-2">
                        <CalendarDays className="mt-0.5 h-4 w-4 text-primary" />
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Schedule
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {isAdmin
                              ? "Used by automatic allocation and daily capacity."
                              : "Your current work schedule."}
                          </p>
                        </div>
                      </div>
                      {isAdmin ? (
                        <div className="grid gap-3 lg:grid-cols-[14rem_1fr_auto]">
                          <div className="space-y-1">
                            <Label className="text-xs">Schedule type</Label>
                            <Select
                              value={schedule.employmentType}
                              onValueChange={(value) =>
                                updateScheduleType(sub, value as EmploymentType)
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {EMPLOYMENT_TYPES.map((type) => (
                                  <SelectItem
                                    key={type.value}
                                    value={type.value}
                                  >
                                    {type.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Available days</Label>
                            <div className="flex flex-wrap gap-2">
                              {WORK_DAYS.map((day) => {
                                const selected = schedule.availableDays.includes(
                                  day.value,
                                );
                                return (
                                  <Button
                                    key={day.value}
                                    type="button"
                                    size="sm"
                                    variant={selected ? "default" : "outline"}
                                    className="h-9 min-w-12 px-3"
                                    onClick={() =>
                                      toggleScheduleDay(sub, day.value)
                                    }
                                    aria-pressed={selected}
                                    title={day.label}
                                  >
                                    {day.short}
                                  </Button>
                                );
                              })}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Full-time defaults to Monday-Friday if no days are
                              selected.
                            </p>
                          </div>
                          <div className="flex items-end lg:justify-end">
                            <Button
                              size="sm"
                              onClick={() =>
                                updateScheduleMutation.mutate({
                                  subId: sub.id,
                                  schedule,
                                })
                              }
                              disabled={updateScheduleMutation.isPending}
                            >
                              {updateScheduleMutation.isPending
                                ? "Saving..."
                                : "Save schedule"}
                            </Button>
                          </div>
                          <div className="space-y-1 lg:col-span-3">
                            <Label className="text-xs">Schedule notes</Label>
                            <Textarea
                              className="min-h-20 text-sm"
                              value={schedule.scheduleNotes}
                              onChange={(event) =>
                                updateScheduleNotes(sub, event.target.value)
                              }
                              placeholder="Preferred days, blocked times, part-time hours, casual availability..."
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-md border bg-background px-3 py-2">
                            <p className="text-xs text-muted-foreground">
                              Schedule type
                            </p>
                            <p className="mt-1 text-lg font-semibold">
                              {employmentLabel(savedSchedule.employmentType)}
                            </p>
                          </div>
                          <div className="rounded-md border bg-background px-3 py-2">
                            <p className="text-xs text-muted-foreground">
                              Available days
                            </p>
                            <p className="mt-1 text-lg font-semibold">
                              {displayAvailableDays(
                                savedSchedule.employmentType,
                                savedSchedule.availableDays,
                              )}
                            </p>
                          </div>
                          {savedSchedule.scheduleNotes ? (
                            <div className="rounded-md border bg-background px-3 py-2 sm:col-span-2">
                              <p className="text-xs text-muted-foreground">
                                Notes
                              </p>
                              <p className="mt-1 whitespace-pre-wrap text-sm">
                                {savedSchedule.scheduleNotes}
                              </p>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>

                    {isAdmin ? (
                      <div className="rounded-lg border bg-muted/20 p-3">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                          App login
                        </p>
                        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                          <div className="space-y-1">
                            <Label
                              className="text-xs"
                              htmlFor={`workerLoginEmail-${sub.id}`}
                            >
                              Login email
                            </Label>
                            <Input
                              id={`workerLoginEmail-${sub.id}`}
                              type="email"
                              value={accountDraft.email}
                              onChange={(event) =>
                                updateAccountDraft(
                                  sub,
                                  "email",
                                  event.target.value,
                                )
                              }
                              autoComplete="off"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label
                              className="text-xs"
                              htmlFor={`workerLoginPassword-${sub.id}`}
                            >
                              Temporary password
                            </Label>
                            <Input
                              id={`workerLoginPassword-${sub.id}`}
                              value={accountDraft.temporaryPassword}
                              onChange={(event) =>
                                updateAccountDraft(
                                  sub,
                                  "temporaryPassword",
                                  event.target.value,
                                )
                              }
                              autoComplete="new-password"
                            />
                          </div>
                          <div className="flex items-end sm:justify-end">
                            <Button
                              size="sm"
                              className="gap-2"
                              onClick={() =>
                                workerAccountMutation.mutate({
                                  sub,
                                  draft: accountDraft,
                                })
                              }
                              disabled={
                                !accountDraft.email ||
                                accountDraft.temporaryPassword.length < 6 ||
                                workerAccountMutation.isPending
                              }
                            >
                              <KeyRound className="h-4 w-4" />
                              {workerAccountMutation.isPending
                                ? "Saving..."
                                : "Set login"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {/* Admin-only grading */}
                    {isAdmin ? (
                      <div className="rounded-lg border bg-muted/20 p-3">
                        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                              Admin-only grading
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              This controls the internal grade used for matching
                              jobs. Employees/subcontractors cannot see this.
                            </p>
                          </div>
                          <Badge variant="outline" className="shrink-0 text-xs">
                            {experienceLabel(
                              edit.experienceLevel ?? sk?.experienceLevel,
                            )}
                          </Badge>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-[1fr_10rem_10rem_auto]">
                          <div className="space-y-1">
                            <Label className="text-xs">Worker grade</Label>
                            <Select
                              value={edit.experienceLevel ?? "intermediate"}
                              onValueChange={(v) =>
                                updateEdit(sub.id, "experienceLevel", v)
                              }
                            >
                              <SelectTrigger className="mt-1">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {EXPERIENCE_LEVELS.map((level) => (
                                  <SelectItem
                                    key={level.value}
                                    value={level.value}
                                  >
                                    {level.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Years experience</Label>
                            <Input
                              type="number"
                              min="0"
                              step="1"
                              value={edit.yearsExperience ?? 0}
                              onChange={(event) =>
                                updateEdit(
                                  sub.id,
                                  "yearsExperience",
                                  Number(event.target.value),
                                )
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Quality score</Label>
                            <Input
                              type="number"
                              min="0"
                              max="100"
                              step="1"
                              value={edit.qualityScore ?? sk?.qualityScore ?? 100}
                              onChange={(event) =>
                                updateEdit(
                                  sub.id,
                                  "qualityScore",
                                  Number(event.target.value),
                                )
                              }
                            />
                          </div>
                          <div className="flex items-end sm:justify-end">
                            <Button
                              size="sm"
                              onClick={() =>
                                saveMutation.mutate({
                                  subId: sub.id,
                                  data: edit,
                                })
                              }
                              disabled={saveMutation.isPending}
                            >
                              {saveMutation.isPending
                                ? "Saving..."
                                : "Save grading"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {/* Skills grid */}
                    {isAdmin
                      ? ["Products", "Job Types"].map((group) => (
                          <div key={group}>
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                              {group}
                            </p>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              {SKILL_FIELDS.filter(
                                (f) => f.group === group,
                              ).map((f) => (
                                <div
                                  key={f.key}
                                  className="flex min-w-0 items-center gap-2"
                                >
                                  <Switch
                                    checked={edit[f.key] ?? false}
                                    onCheckedChange={(v) =>
                                      updateEdit(sub.id, f.key, v)
                                    }
                                  />
                                  <Label className="min-w-0 cursor-pointer text-sm leading-snug">
                                    {f.label}
                                  </Label>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))
                      : null}

                    {/* Credentials */}
                    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          Licences & Documents
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Upload white cards, scissor lift licences, EWP tickets
                          and other site credentials.
                        </p>
                      </div>
                      {subCredentials.length > 0 ? (
                        <div className="grid gap-2 sm:grid-cols-2">
                          {subCredentials.map(
                            (credential: WorkerCredential) => (
                              <div
                                key={credential.id}
                                className="overflow-hidden rounded-md border bg-background"
                              >
                                <div className="aspect-[4/3] bg-muted">
                                  <img
                                    src={credential.imageData}
                                    alt={credential.label}
                                    className="h-full w-full object-cover"
                                  />
                                </div>
                                <div className="space-y-2 p-3">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="truncate text-sm font-semibold">
                                        {credential.label}
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        {credential.expiryDate
                                          ? `Expires ${new Date(credential.expiryDate).toLocaleDateString("en-AU")}`
                                          : "No expiry date"}
                                      </p>
                                      {credential.notes ? (
                                        <p className="mt-1 text-xs text-muted-foreground">
                                          {credential.notes}
                                        </p>
                                      ) : null}
                                    </div>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                                      onClick={() =>
                                        deleteCredentialMutation.mutate(
                                          credential.id,
                                        )
                                      }
                                      disabled={
                                        deleteCredentialMutation.isPending
                                      }
                                      title="Delete credential"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            ),
                          )}
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
                            onValueChange={(value) =>
                              updateCredentialDraft(
                                sub.id,
                                "documentType",
                                value,
                              )
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CREDENTIAL_TYPES.map((type) => (
                                <SelectItem key={type.value} value={type.value}>
                                  {type.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Expiry date</Label>
                          <Input
                            type="date"
                            value={credentialDraft.expiryDate}
                            onChange={(event) =>
                              updateCredentialDraft(
                                sub.id,
                                "expiryDate",
                                event.target.value,
                              )
                            }
                          />
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <Label className="text-xs">Notes</Label>
                          <Input
                            value={credentialDraft.notes}
                            onChange={(event) =>
                              updateCredentialDraft(
                                sub.id,
                                "notes",
                                event.target.value,
                              )
                            }
                            placeholder="Card number, licence class, restrictions..."
                          />
                        </div>
                        <label className="flex cursor-pointer flex-wrap items-center justify-center gap-2 rounded-md border-2 border-dashed border-muted-foreground/30 bg-background px-3 py-3 text-center text-sm font-medium text-muted-foreground transition-colors hover:bg-muted sm:col-span-2">
                          {uploadCredentialMutation.isPending ? (
                            <ImageIcon className="h-4 w-4 animate-pulse" />
                          ) : (
                            <Upload className="h-4 w-4" />
                          )}
                          {uploadCredentialMutation.isPending
                            ? "Uploading..."
                            : `Upload ${credentialLabel(credentialDraft.documentType)}`}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(event) =>
                              handleCredentialUpload(sub.id, event)
                            }
                            disabled={uploadCredentialMutation.isPending}
                          />
                        </label>
                      </div>
                    </div>

                    {/* Performance scores (read-only) */}
                    {isAdmin && sk && (
                      <div className="grid grid-cols-2 gap-3 p-3 bg-muted/30 rounded-lg text-xs sm:grid-cols-4">
                        <div>
                          <p className="text-muted-foreground">Punctuality</p>
                          <p className="font-semibold">
                            {Number(sk.punctualityScore).toFixed(0)}/100
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">
                            Photo Compliance
                          </p>
                          <p className="font-semibold">
                            {Number(sk.photoComplianceScore).toFixed(0)}/100
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Callback Rate</p>
                          <p className="font-semibold">
                            {Number(sk.callbackRate).toFixed(1)}%
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">
                            Builder Rating
                          </p>
                          <p className="font-semibold">
                            {sk.builderRatingAvg
                              ? `${Number(sk.builderRatingAvg).toFixed(1)}/5`
                              : "—"}
                          </p>
                        </div>
                      </div>
                    )}

                    {isAdmin ? (
                      <Button
                        size="sm"
                        onClick={() =>
                          saveMutation.mutate({ subId: sub.id, data: edit })
                        }
                        disabled={saveMutation.isPending}
                      >
                        {saveMutation.isPending ? "Saving..." : "Save Profile"}
                      </Button>
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
