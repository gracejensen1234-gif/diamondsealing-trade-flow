import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ChangeEvent, type ElementType } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  Brain,
  Camera,
  CheckCircle,
  FileText,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";

const REC_CONFIG: Record<
  string,
  { icon: ElementType; color: string; label: string }
> = {
  recommended: {
    icon: CheckCircle,
    color: "text-green-600",
    label: "Recommended",
  },
  suitable: {
    icon: CheckCircle,
    color: "text-orange-500",
    label: "Suitable",
  },
  possible: {
    icon: AlertTriangle,
    color: "text-amber-500",
    label: "Possible",
  },
  not_recommended: {
    icon: XCircle,
    color: "text-red-500",
    label: "Not Recommended",
  },
};

const emptyAllocationForm = {
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
};

type IntakeDraft = {
  title: string;
  clientName?: string | null;
  builderName?: string | null;
  customerId?: number | null;
  builderProfileId?: number | null;
  address?: string | null;
  suburb?: string | null;
  description?: string | null;
  builderContactName?: string | null;
  builderContactPhone?: string | null;
  requiredColours?: string[];
  scheduledDate?: string | null;
  dueDate?: string | null;
  productType?: string | null;
  jobType?: string | null;
  estimatedMetres?: string | number | null;
  workArea?: string | null;
  timeWindow?: string | null;
  plannedStartTime?: string | null;
  plannedEndTime?: string | null;
  notes?: string | null;
  confidence?: number;
  needsReview?: boolean;
  sourceSummary?: string | null;
};

type CreatedIntakeJob = {
  job: {
    id: number;
    title: string;
    address?: string | null;
    scheduledDate?: string | null;
    dueDate?: string | null;
    requiredColours?: string[];
  };
  assignmentTrigger?: {
    status: string;
    reason: string;
    jobAssignmentId?: number;
    recommendationId?: number;
    selectedSubcontractorId?: number;
    warnings?: string[];
  };
  allocationResult?: {
    recommendationId?: number;
    recommendations?: any[];
    warnings?: string[];
    selectedSubcontractorId?: number | null;
    jobAssignmentId?: number | null;
  } | null;
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

function asText(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function normalizeDraft(draft: any): IntakeDraft {
  return {
    title: asText(draft.title) || "Job from intake",
    clientName: draft.clientName ?? null,
    builderName: draft.builderName ?? null,
    customerId: draft.customerId ?? null,
    builderProfileId: draft.builderProfileId ?? null,
    address: draft.address ?? "",
    suburb: draft.suburb ?? "",
    description: draft.description ?? "",
    builderContactName: draft.builderContactName ?? "",
    builderContactPhone: draft.builderContactPhone ?? "",
    requiredColours: Array.isArray(draft.requiredColours)
      ? draft.requiredColours.map(String)
      : [],
    scheduledDate: draft.scheduledDate ?? "",
    dueDate: draft.dueDate ?? "",
    productType: draft.productType ?? "silicone",
    jobType: draft.jobType ?? "residential",
    estimatedMetres:
      draft.estimatedMetres == null ? "" : String(draft.estimatedMetres),
    workArea: draft.workArea ?? "",
    timeWindow: draft.timeWindow ?? "full_day",
    plannedStartTime: draft.plannedStartTime ?? "",
    plannedEndTime: draft.plannedEndTime ?? "",
    notes: draft.notes ?? "",
    confidence: typeof draft.confidence === "number" ? draft.confidence : 0.5,
    needsReview: Boolean(draft.needsReview),
    sourceSummary: draft.sourceSummary ?? "",
  };
}

function draftPayload(draft: IntakeDraft) {
  return {
    ...draft,
    estimatedMetres: optionalNumber(asText(draft.estimatedMetres)),
    requiredColours: draft.requiredColours ?? [],
  };
}

function formFromCreated(item: CreatedIntakeJob, draft?: IntakeDraft) {
  const job = item.job;
  const colours = draft?.requiredColours ?? job.requiredColours ?? [];
  return {
    ...emptyAllocationForm,
    jobId: String(job.id),
    date: job.scheduledDate ?? job.dueDate ?? emptyAllocationForm.date,
    productType: draft?.productType ?? "silicone",
    colour: colours.join(", "),
    estimatedMetres: asText(draft?.estimatedMetres),
    jobType: draft?.jobType ?? "residential",
    suburb: draft?.suburb ?? "",
    builderProfileId: draft?.builderProfileId
      ? String(draft.builderProfileId)
      : "",
    workArea: draft?.workArea ?? "",
    timeWindow: draft?.timeWindow ?? "full_day",
    plannedStartTime: draft?.plannedStartTime ?? "",
    plannedEndTime: draft?.plannedEndTime ?? "",
    notes: draft?.notes ?? "",
  };
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

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.readAsDataURL(file);
  });
}

async function readAllocationImage(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please upload a screenshot or image.");
  }

  const dataUrl = await readFileAsDataUrl(file);
  return new Promise<string>((resolve) => {
    const image = new Image();
    image.onload = () => {
      const maxSide = 1600;
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return resolve(dataUrl);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}

function triggerLabel(status?: string) {
  if (status === "auto_assigned") return "Auto assigned";
  if (status === "admin_review_required") return "Review needed";
  if (status === "existing_assignment_synced")
    return "Existing assignment synced";
  if (status === "existing_assignment_kept") return "Existing assignment kept";
  return "Not assigned";
}

export default function Allocation() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ ...emptyAllocationForm });
  const [result, setResult] = useState<any>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [intakeSourceText, setIntakeSourceText] = useState("");
  const [intakeImageData, setIntakeImageData] = useState("");
  const [intakeFileName, setIntakeFileName] = useState("");
  const [intakeFileLoading, setIntakeFileLoading] = useState(false);
  const [intakeDrafts, setIntakeDrafts] = useState<IntakeDraft[]>([]);
  const [createdIntakeJobs, setCreatedIntakeJobs] = useState<
    CreatedIntakeJob[]
  >([]);

  const { data: jobs = [] } = useQuery({
    queryKey: ["jobs"],
    queryFn: () => fetch("/api/jobs").then((r) => r.json()),
  });
  const { data: builders = [] } = useQuery({
    queryKey: ["builder-profiles"],
    queryFn: () => fetch("/api/builder-profiles").then((r) => r.json()),
  });

  const analyseIntakeMutation = useMutation({
    mutationFn: () =>
      postJson("/api/allocation/job-intake/analyse", {
        sourceText: intakeSourceText,
        imageData: intakeImageData,
      }),
    onSuccess: (data) => {
      const drafts = Array.isArray(data.drafts)
        ? data.drafts.map(normalizeDraft)
        : [];
      setIntakeDrafts(drafts);
      setCreatedIntakeJobs([]);
      toast({
        title: drafts.length ? "Job draft ready" : "No jobs found",
        description: drafts.length
          ? `${drafts.length} job/work block${drafts.length === 1 ? "" : "s"} extracted. Review before creating.`
          : "Try adding more detail or uploading a clearer screenshot.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not read job intake",
        description:
          error instanceof Error
            ? error.message
            : "Check the details and try again.",
        variant: "destructive",
      });
    },
  });

  const createIntakeMutation = useMutation({
    mutationFn: () =>
      postJson("/api/allocation/job-intake/create-and-allocate", {
        drafts: intakeDrafts.map(draftPayload),
      }),
    onSuccess: (data) => {
      const created: CreatedIntakeJob[] = Array.isArray(data.created)
        ? data.created
        : [];
      setCreatedIntakeJobs(created);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["dispatch"] });
      qc.invalidateQueries({ queryKey: ["allocation-recommendations"] });

      const firstWithRecommendations = created.find(
        (item) => item.allocationResult?.recommendations?.length,
      );
      if (firstWithRecommendations?.allocationResult) {
        const draft = intakeDrafts[created.indexOf(firstWithRecommendations)];
        const allocationResult = firstWithRecommendations.allocationResult;
        setForm(formFromCreated(firstWithRecommendations, draft));
        setResult({
          jobId: firstWithRecommendations.job.id,
          date:
            firstWithRecommendations.job.scheduledDate ??
            firstWithRecommendations.job.dueDate,
          recommendationId: allocationResult.recommendationId,
          recommendations: allocationResult.recommendations ?? [],
          warnings: allocationResult.warnings ?? [],
          autoSelected: allocationResult.selectedSubcontractorId
            ? {
                subcontractorId: allocationResult.selectedSubcontractorId,
              }
            : null,
          jobAssignmentId: allocationResult.jobAssignmentId,
        });
        setSelected(
          allocationResult.selectedSubcontractorId ??
            allocationResult.recommendations?.[0]?.subcontractorId ??
            null,
        );
      }

      toast({
        title: "Jobs created",
        description:
          "Trigger rules have run. Auto matches were scheduled and unclear matches are ready for review.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not create jobs",
        description:
          error instanceof Error
            ? error.message
            : "Review the drafts and try again.",
        variant: "destructive",
      });
    },
  });

  const recommendMutation = useMutation({
    mutationFn: (data: any) => postJson("/api/allocation/recommend", data),
    onSuccess: (data) => {
      setResult(data);
      setSelected(data.autoSelected?.subcontractorId ?? null);
    },
    onError: () =>
      toast({
        title: "Error",
        description: "Could not get recommendations",
        variant: "destructive",
      }),
  });

  const confirmMutation = useMutation({
    mutationFn: (data: any) => postJson("/api/allocation/confirm", data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["dispatch"] });
      setResult((previous: any) =>
        previous
          ? { ...previous, jobAssignmentId: data.jobAssignmentId }
          : previous,
      );
      toast({
        title: "Employee/subcontractor allocated and scheduled",
        description: data.assignment?.workArea
          ? `${data.assignment.workArea} is now in Dispatch.`
          : "This work block is now in Dispatch.",
      });
    },
    onError: (error) =>
      toast({
        title: "Could not schedule work block",
        description:
          error instanceof Error ? error.message : "Try again from Dispatch.",
        variant: "destructive",
      }),
  });

  async function handleIntakeImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setIntakeFileLoading(true);
    try {
      const imageData = await readAllocationImage(file);
      setIntakeImageData(imageData);
      setIntakeFileName(file.name);
    } catch (error) {
      toast({
        title: "Could not load screenshot",
        description:
          error instanceof Error ? error.message : "Choose another image.",
        variant: "destructive",
      });
    } finally {
      setIntakeFileLoading(false);
      event.target.value = "";
    }
  }

  function updateIntakeDraft(index: number, updates: Partial<IntakeDraft>) {
    setIntakeDrafts((current) =>
      current.map((draft, draftIndex) =>
        draftIndex === index ? { ...draft, ...updates } : draft,
      ),
    );
  }

  function run() {
    if (!form.jobId || !form.date) {
      toast({ title: "Job and date are required" });
      return;
    }
    const payload: any = {
      ...form,
      jobId: Number(form.jobId),
      estimatedMetres: optionalNumber(form.estimatedMetres),
    };
    if (form.builderProfileId && form.builderProfileId !== "none") {
      payload.builderProfileId = Number(form.builderProfileId);
    } else {
      delete payload.builderProfileId;
    }
    recommendMutation.mutate(payload);
  }

  const canAnalyse = Boolean(intakeSourceText.trim() || intakeImageData);
  const canCreateDrafts =
    intakeDrafts.length > 0 &&
    intakeDrafts.every(
      (draft) =>
        asText(draft.title).trim() &&
        (asText(draft.scheduledDate).trim() || asText(draft.dueDate).trim()),
    );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Trigger-Based Job Allocation</h1>
        <p className="mt-1 text-muted-foreground">
          Create jobs from builder messages, then let trigger rules assign or
          prepare recommendations for review.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Job Intake
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
            <div>
              <Label>Paste builder email, text message or notes</Label>
              <Textarea
                className="mt-1 min-h-40"
                value={intakeSourceText}
                onChange={(event) => setIntakeSourceText(event.target.value)}
                placeholder="Paste job details here. Include address, builder/client, date, product, colours, areas/units, metres and any site notes."
              />
            </div>
            <div className="space-y-3">
              <div>
                <Label>Screenshot</Label>
                <div className="mt-1 rounded-md border border-dashed p-3">
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={handleIntakeImage}
                    disabled={
                      intakeFileLoading || analyseIntakeMutation.isPending
                    }
                  />
                  <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <Camera className="h-3.5 w-3.5" />
                    {intakeFileLoading
                      ? "Loading image..."
                      : intakeFileName || "Optional email/message screenshot"}
                  </div>
                </div>
              </div>
              {intakeImageData ? (
                <div className="overflow-hidden rounded-md border">
                  <img
                    src={intakeImageData}
                    alt="Job intake screenshot preview"
                    className="max-h-48 w-full object-cover"
                  />
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              onClick={() => analyseIntakeMutation.mutate()}
              disabled={
                !canAnalyse ||
                intakeFileLoading ||
                analyseIntakeMutation.isPending
              }
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {analyseIntakeMutation.isPending ? "Reading..." : "Read Jobs"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setIntakeSourceText("");
                setIntakeImageData("");
                setIntakeFileName("");
                setIntakeDrafts([]);
                setCreatedIntakeJobs([]);
              }}
              disabled={
                analyseIntakeMutation.isPending ||
                createIntakeMutation.isPending
              }
            >
              Clear
            </Button>
          </div>

          {intakeDrafts.length > 0 ? (
            <div className="space-y-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">Review job drafts</p>
                  <p className="text-xs text-muted-foreground">
                    Edit anything unclear before creating real jobs.
                  </p>
                </div>
                <Badge variant="secondary">
                  {intakeDrafts.length} draft
                  {intakeDrafts.length === 1 ? "" : "s"}
                </Badge>
              </div>

              {intakeDrafts.map((draft, index) => (
                <div
                  key={`${draft.title}-${index}`}
                  className="space-y-4 rounded-md border p-4"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium">
                        Draft {index + 1}: {draft.title}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {draft.needsReview ? (
                          <Badge variant="outline">Review details</Badge>
                        ) : (
                          <Badge variant="secondary">Ready</Badge>
                        )}
                        <Badge variant="outline">
                          Confidence{" "}
                          {Math.round((draft.confidence ?? 0.5) * 100)}%
                        </Badge>
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() =>
                        setIntakeDrafts((current) =>
                          current.filter(
                            (_, draftIndex) => draftIndex !== index,
                          ),
                        )
                      }
                      aria-label="Remove draft"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <Label>Job title</Label>
                      <Input
                        className="mt-1"
                        value={draft.title}
                        onChange={(event) =>
                          updateIntakeDraft(index, {
                            title: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label>Client / builder</Label>
                      <Input
                        className="mt-1"
                        value={asText(draft.clientName ?? draft.builderName)}
                        onChange={(event) =>
                          updateIntakeDraft(index, {
                            clientName: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="md:col-span-2">
                      <Label>Address</Label>
                      <Input
                        className="mt-1"
                        value={asText(draft.address)}
                        onChange={(event) =>
                          updateIntakeDraft(index, {
                            address: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label>Scheduled date</Label>
                      <Input
                        type="date"
                        className="mt-1"
                        value={asText(draft.scheduledDate)}
                        onChange={(event) =>
                          updateIntakeDraft(index, {
                            scheduledDate: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label>Due date</Label>
                      <Input
                        type="date"
                        className="mt-1"
                        value={asText(draft.dueDate)}
                        onChange={(event) =>
                          updateIntakeDraft(index, {
                            dueDate: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label>Work block / units</Label>
                      <Input
                        className="mt-1"
                        value={asText(draft.workArea)}
                        onChange={(event) =>
                          updateIntakeDraft(index, {
                            workArea: event.target.value,
                          })
                        }
                        placeholder="Units 1-4, Block B, bathrooms"
                      />
                    </div>
                    <div>
                      <Label>Est. metres</Label>
                      <Input
                        type="number"
                        className="mt-1"
                        value={asText(draft.estimatedMetres)}
                        onChange={(event) =>
                          updateIntakeDraft(index, {
                            estimatedMetres: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label>Product type</Label>
                      <Select
                        value={draft.productType ?? "silicone"}
                        onValueChange={(value) =>
                          updateIntakeDraft(index, { productType: value })
                        }
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="silicone">Silicone</SelectItem>
                          <SelectItem value="sikaflex">Sikaflex</SelectItem>
                          <SelectItem value="fire_rated">Fire-rated</SelectItem>
                          <SelectItem value="waterproofing">
                            Waterproofing
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Job type</Label>
                      <Select
                        value={draft.jobType ?? "residential"}
                        onValueChange={(value) =>
                          updateIntakeDraft(index, { jobType: value })
                        }
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="residential">
                            Residential
                          </SelectItem>
                          <SelectItem value="commercial">Commercial</SelectItem>
                          <SelectItem value="pool">Pool</SelectItem>
                          <SelectItem value="car_park">Car park</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Colours</Label>
                      <Input
                        className="mt-1"
                        value={(draft.requiredColours ?? []).join(", ")}
                        onChange={(event) =>
                          updateIntakeDraft(index, {
                            requiredColours: splitColours(event.target.value),
                          })
                        }
                        placeholder="White, Black, Concrete Grey"
                      />
                    </div>
                    <div>
                      <Label>Day part</Label>
                      <Select
                        value={draft.timeWindow ?? "full_day"}
                        onValueChange={(value) =>
                          updateIntakeDraft(index, { timeWindow: value })
                        }
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="full_day">Full day</SelectItem>
                          <SelectItem value="morning">Morning</SelectItem>
                          <SelectItem value="afternoon">Afternoon</SelectItem>
                          <SelectItem value="custom">Custom time</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Start</Label>
                      <Input
                        type="time"
                        className="mt-1"
                        value={asText(draft.plannedStartTime)}
                        onChange={(event) =>
                          updateIntakeDraft(index, {
                            plannedStartTime: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label>Finish</Label>
                      <Input
                        type="time"
                        className="mt-1"
                        value={asText(draft.plannedEndTime)}
                        onChange={(event) =>
                          updateIntakeDraft(index, {
                            plannedEndTime: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="md:col-span-2">
                      <Label>Notes / instructions</Label>
                      <Textarea
                        className="mt-1"
                        rows={3}
                        value={asText(draft.notes)}
                        onChange={(event) =>
                          updateIntakeDraft(index, {
                            notes: event.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
              ))}

              <Button
                className="w-full sm:w-auto"
                onClick={() => createIntakeMutation.mutate()}
                disabled={!canCreateDrafts || createIntakeMutation.isPending}
              >
                <CheckCircle className="mr-2 h-4 w-4" />
                {createIntakeMutation.isPending
                  ? "Creating and checking rules..."
                  : "Create Jobs & Run Trigger Rules"}
              </Button>
              {!canCreateDrafts ? (
                <p className="text-xs text-destructive">
                  Every draft needs a title and a scheduled or due date before
                  it becomes a real job.
                </p>
              ) : null}
            </div>
          ) : null}

          {createdIntakeJobs.length > 0 ? (
            <div className="space-y-2 rounded-md bg-muted/40 p-3">
              <p className="text-sm font-medium">Created jobs</p>
              {createdIntakeJobs.map((item) => (
                <div
                  key={item.job.id}
                  className="flex flex-col gap-2 rounded-md border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {item.job.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.job.scheduledDate ?? item.job.dueDate ?? "No date"}{" "}
                      {item.job.address ? `- ${item.job.address}` : ""}
                    </p>
                    {item.assignmentTrigger?.reason ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.assignmentTrigger.reason}
                      </p>
                    ) : null}
                  </div>
                  <Badge
                    variant={
                      item.assignmentTrigger?.status === "auto_assigned"
                        ? "secondary"
                        : "outline"
                    }
                  >
                    {triggerLabel(item.assignmentTrigger?.status)}
                  </Badge>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Allocation Request
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label>Job / project</Label>
              <Select
                value={form.jobId}
                onValueChange={(value) =>
                  setForm((previous) => ({ ...previous, jobId: value }))
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select job or project..." />
                </SelectTrigger>
                <SelectContent>
                  {(jobs as any[]).map((job: any) => (
                    <SelectItem key={job.id} value={String(job.id)}>
                      {job.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Date</Label>
              <Input
                type="date"
                className="mt-1"
                value={form.date}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    date: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <Label>Product type</Label>
              <Select
                value={form.productType}
                onValueChange={(value) =>
                  setForm((previous) => ({ ...previous, productType: value }))
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="silicone">Silicone</SelectItem>
                  <SelectItem value="sikaflex">Sikaflex</SelectItem>
                  <SelectItem value="fire_rated">Fire-rated</SelectItem>
                  <SelectItem value="waterproofing">Waterproofing</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Required colours</Label>
              <Input
                className="mt-1"
                placeholder="e.g. Sandstone, White"
                value={form.colour}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    colour: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <Label>Est. metres for this block</Label>
              <Input
                type="number"
                className="mt-1"
                value={form.estimatedMetres}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    estimatedMetres: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <Label>Job type</Label>
              <Select
                value={form.jobType}
                onValueChange={(value) =>
                  setForm((previous) => ({ ...previous, jobType: value }))
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="residential">Residential</SelectItem>
                  <SelectItem value="commercial">Commercial</SelectItem>
                  <SelectItem value="pool">Pool</SelectItem>
                  <SelectItem value="car_park">Car park</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Suburb</Label>
              <Input
                className="mt-1"
                placeholder="e.g. Milton"
                value={form.suburb}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    suburb: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <Label>Builder profile</Label>
              <Select
                value={form.builderProfileId}
                onValueChange={(value) =>
                  setForm((previous) => ({
                    ...previous,
                    builderProfileId: value,
                  }))
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select builder (optional)..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No builder profile</SelectItem>
                  {(builders as any[]).map((builder: any) => (
                    <SelectItem key={builder.id} value={String(builder.id)}>
                      {builder.name} ({builder.qualityTier})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label>Work block / units</Label>
              <Input
                className="mt-1"
                placeholder="e.g. Units 1-4 bathrooms, Level 2 balconies, Block B"
                value={form.workArea}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    workArea: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <Label>Day part</Label>
              <Select
                value={form.timeWindow}
                onValueChange={(value) =>
                  setForm((previous) => ({ ...previous, timeWindow: value }))
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
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
                <Input
                  type="time"
                  className="mt-1"
                  value={form.plannedStartTime}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      plannedStartTime: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label>Finish</Label>
                <Input
                  type="time"
                  className="mt-1"
                  value={form.plannedEndTime}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      plannedEndTime: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div className="md:col-span-2">
              <Label>Instructions for this block</Label>
              <Textarea
                className="mt-1"
                rows={3}
                value={form.notes}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    notes: event.target.value,
                  }))
                }
                placeholder="e.g. Complete wet area internals first, leave balconies for afternoon crew."
              />
            </div>
          </div>
          <Button
            className="w-full sm:w-auto"
            onClick={run}
            disabled={recommendMutation.isPending}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {recommendMutation.isPending
              ? "Checking rules..."
              : "Run Trigger Rules"}
          </Button>
        </CardContent>
      </Card>

      {result ? (
        <div className="space-y-4">
          {result.warnings?.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:bg-amber-950/20">
              {result.warnings.map((warning: string, index: number) => (
                <p
                  key={`${warning}-${index}`}
                  className="text-sm text-amber-700 dark:text-amber-300"
                >
                  {warning}
                </p>
              ))}
            </div>
          ) : null}

          <h2 className="text-lg font-semibold">
            Employee/Subcontractor Recommendations
          </h2>

          {result.recommendations?.map((recommendation: any) => {
            const cfg =
              REC_CONFIG[recommendation.recommendation] ?? REC_CONFIG.possible;
            const Icon = cfg.icon;
            const isSelected = selected === recommendation.subcontractorId;

            return (
              <Card
                key={recommendation.subcontractorId}
                className={isSelected ? "ring-2 ring-primary" : ""}
              >
                <CardContent className="pt-4">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-bold">
                        {recommendation.rank}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <p className="font-semibold">
                          {recommendation.subcontractorName}
                        </p>
                        <Icon className={`h-4 w-4 ${cfg.color}`} />
                        <span className={`text-xs font-medium ${cfg.color}`}>
                          {cfg.label}
                        </span>
                        <span className="ml-auto text-lg font-bold">
                          {recommendation.suitabilityScore}/100
                        </span>
                      </div>

                      <div className="mb-2 flex flex-wrap gap-2">
                        {recommendation.skillMatch ? (
                          <Badge variant="secondary" className="text-xs">
                            Skills match
                          </Badge>
                        ) : null}
                        {recommendation.stockMatch ? (
                          <Badge variant="secondary" className="text-xs">
                            Stock OK
                          </Badge>
                        ) : null}
                        {recommendation.scheduleFit ? (
                          <Badge variant="secondary" className="text-xs">
                            Available
                          </Badge>
                        ) : null}
                        {recommendation.builderTierMatch ? (
                          <Badge variant="secondary" className="text-xs">
                            Quality tier
                          </Badge>
                        ) : null}
                        {recommendation.nearbyJobSuburb ? (
                          <Badge variant="secondary" className="text-xs">
                            Nearby: {recommendation.nearbyJobSuburb}
                          </Badge>
                        ) : null}
                      </div>

                      {recommendation.reasons?.length > 0 ? (
                        <div className="mb-1">
                          {recommendation.reasons.map(
                            (reason: string, index: number) => (
                              <p
                                key={`${reason}-${index}`}
                                className="text-xs text-green-700 dark:text-green-400"
                              >
                                {reason}
                              </p>
                            ),
                          )}
                        </div>
                      ) : null}
                      {recommendation.warnings?.length > 0 ? (
                        <div>
                          {recommendation.warnings.map(
                            (warning: string, index: number) => (
                              <p
                                key={`${warning}-${index}`}
                                className="text-xs text-amber-600 dark:text-amber-400"
                              >
                                {warning}
                              </p>
                            ),
                          )}
                        </div>
                      ) : null}

                      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                        <span>Quality: {recommendation.qualityScore}/100</span>
                        <span>Callbacks: {recommendation.callbackRate}%</span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={isSelected ? "default" : "outline"}
                      onClick={() =>
                        setSelected(recommendation.subcontractorId)
                      }
                    >
                      {isSelected ? "Selected" : "Select"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {selected ? (
            <div className="flex justify-end">
              <Button
                className="w-full sm:w-auto"
                onClick={() =>
                  confirmMutation.mutate({
                    recommendationId: result.recommendationId,
                    subcontractorId: selected,
                    workArea: form.workArea || undefined,
                    timeWindow: form.timeWindow,
                    plannedStartTime: form.plannedStartTime || undefined,
                    plannedEndTime: form.plannedEndTime || undefined,
                    estimatedMetres: optionalNumber(form.estimatedMetres),
                    requiredColours: splitColours(form.colour),
                    notes: form.notes || undefined,
                  })
                }
                disabled={confirmMutation.isPending}
              >
                <CheckCircle className="mr-2 h-4 w-4" />
                {confirmMutation.isPending
                  ? "Scheduling..."
                  : "Confirm & Schedule"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
