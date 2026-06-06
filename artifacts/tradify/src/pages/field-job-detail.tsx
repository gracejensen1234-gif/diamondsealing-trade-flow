import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { useListDispatch, useCreateJobReport, getListDispatchQueryKey, getListJobReportsQueryKey } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/speech-textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { ArrowLeft, Upload, X, MapPin } from "lucide-react";

const timeWindowLabels: Record<string, string> = {
  full_day: "Full day",
  morning: "Morning",
  afternoon: "Afternoon",
  custom: "Custom time",
};

type ReportInventoryItem = {
  id: number;
  stockItemId: number;
  stockItemName: string;
  colour?: string | null;
  unit?: string | null;
  currentQuantity: number;
};

type LocationVerificationResult = {
  id?: number;
  status: string;
  distanceMetres?: number | null;
};

function formatQty(quantity: number, unit?: string | null) {
  return `${Number(quantity).toLocaleString("en-AU", { maximumFractionDigits: 2 })} ${unit ?? "unit"}`;
}

function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object" && "error" in data) {
      const message = (data as { error?: unknown }).error;
      if (typeof message === "string") return message;
    }
  }
  return error instanceof Error ? error.message : "Try again.";
}

function compressPhoto(file: File) {
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const maxEdge = 1600;
      const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not prepare photo"));
        return;
      }

      ctx.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.78));
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read photo"));
    };

    image.src = objectUrl;
  });
}

function getBrowserLocation(): Promise<GeolocationCoordinates | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position.coords),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

async function postLocationVerification(payload: Record<string, unknown>): Promise<LocationVerificationResult> {
  const response = await fetch("/api/location-verifications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error ?? "Could not verify job departure location");
  }
  return data;
}

export default function FieldJobDetail() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const subcontractorId = user?.role === "worker" ? user.subcontractorId ?? undefined : undefined;

  const today = new Date().toISOString().split('T')[0];
  const { data: dispatchList, isLoading: loadingAssignment } = useListDispatch(
    { date: today, subcontractorId },
    { query: { queryKey: getListDispatchQueryKey({ date: today, subcontractorId }), enabled: !!id } }
  );
  const assignment = dispatchList?.find(a => a.id === Number(id));
  const [meters, setMeters] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [colours, setColours] = useState<string[]>([]);
  const [stockUsed, setStockUsed] = useState<Record<number, number>>({});
  const [stockUsageChecked, setStockUsageChecked] = useState(false);
  const [issueType, setIssueType] = useState<string>("none");
  const [issueDescription, setIssueDescription] = useState("");
  const [hoursWorked, setHoursWorked] = useState("");
  const [workDescription, setWorkDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [verifyingLocation, setVerifyingLocation] = useState(false);
  const initializedAssignmentRef = useRef<number | null>(null);

  const checkedJobHours = useMemo(() => {
    if (!assignment?.arrivedAt) return null;
    const start = new Date(assignment.arrivedAt).getTime();
    const end = assignment.departedAt ? new Date(assignment.departedAt).getTime() : Date.now();
    const hours = Math.max(0, (end - start) / 3_600_000);
    return Number.isFinite(hours) && hours > 0 ? Number(hours.toFixed(2)) : null;
  }, [assignment?.arrivedAt, assignment?.departedAt]);

  const inventorySubcontractorId = assignment?.subcontractorId ?? undefined;
  const { data: inventoryItems = [], isLoading: loadingInventory } = useQuery<ReportInventoryItem[]>({
    queryKey: ["field-report-inventory", inventorySubcontractorId],
    queryFn: async () => {
      const response = await fetch(`/api/sub-inventory/${inventorySubcontractorId}`);
      if (!response.ok) throw new Error("Could not load inventory");
      return response.json();
    },
    enabled: Boolean(inventorySubcontractorId),
  });

  const stockUsageWithinInventory = useMemo(() => {
    const inventoryByStockId = new Map(inventoryItems.map((item) => [item.stockItemId, item]));
    return Object.entries(stockUsed).every(([stockItemId, quantity]) => {
      if (!quantity || quantity <= 0) return true;
      const item = inventoryByStockId.get(Number(stockItemId));
      return Boolean(item && quantity <= item.currentQuantity);
    });
  }, [inventoryItems, stockUsed]);
  const stockUsedTotal = useMemo(
    () => Object.values(stockUsed).reduce((total, quantity) => total + (Number.isFinite(quantity) && quantity > 0 ? quantity : 0), 0),
    [stockUsed],
  );
  const stockInventoryAvailable = useMemo(
    () => inventoryItems.some((item) => Number(item.currentQuantity) > 0),
    [inventoryItems],
  );
  const hasRecordedStockUsage = stockUsedTotal > 0;

  useEffect(() => {
    if (!assignment) return;
    if (initializedAssignmentRef.current === assignment.id) return;
    initializedAssignmentRef.current = assignment.id;
    if (checkedJobHours) {
      setHoursWorked(checkedJobHours.toFixed(2));
    }
    setWorkDescription(assignment.workArea || assignment.jobDescription || assignment.notes || "");
  }, [assignment, checkedJobHours]);

  const createReport = useCreateJobReport({
    mutation: {
      onSuccess: () => {
        toast({ title: "Job report submitted successfully" });
        queryClient.invalidateQueries({ queryKey: getListJobReportsQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["field-report-inventory", assignment?.subcontractorId] });
        queryClient.invalidateQueries({ queryKey: ["field-inventory", assignment?.subcontractorId] });
        queryClient.invalidateQueries({ queryKey: ["field-inventory-transactions", assignment?.subcontractorId] });
        queryClient.invalidateQueries({ queryKey: ["sub-inventory"] });
        queryClient.invalidateQueries({ queryKey: ["sub-inventory-transactions"] });
        setLocation("/field");
      },
      onError: (error) => {
        toast({
          title: "Could not submit job report",
          description: errorMessage(error),
          variant: "destructive",
        });
      },
    }
  });

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;

    Array.from(e.target.files).forEach(async (file) => {
      try {
        const photo = await compressPhoto(file);
        setPhotos(prev => [...prev, photo]);
      } catch {
        toast({ title: "Photo could not be added", variant: "destructive" });
      }
    });
    e.currentTarget.value = "";
  };

  const removePhoto = (index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!assignment) return;
    if (photos.length === 0) {
      toast({
        title: "Completion photo required",
        description: "Upload at least one photo before leaving this job.",
        variant: "destructive",
      });
      return;
    }

    if (user?.role === "worker") {
      setVerifyingLocation(true);
      try {
        const coords = await getBrowserLocation();
        if (!coords) {
          await postLocationVerification({
            subcontractorId: assignment.subcontractorId,
            eventType: "job_departed",
            jobAssignmentId: assignment.id,
            status: "location_error",
            workerConsented: false,
          }).catch(() => undefined);
          toast({
            title: "Location required",
            description: "Allow location access before submitting the report and leaving this job.",
            variant: "destructive",
          });
          return;
        }

        const verification = await postLocationVerification({
          subcontractorId: assignment.subcontractorId,
          eventType: "job_departed",
          jobAssignmentId: assignment.id,
          reportedLat: coords.latitude,
          reportedLng: coords.longitude,
          reportedAccuracyMetres: coords.accuracy,
          workerConsented: true,
        });

        if (verification.status === "outside_range") {
          toast({
            title: "Location check recorded",
            description: `You appear to be ${verification.distanceMetres ?? "?"}m from the job address. Admin will be able to review it.`,
            variant: "destructive",
          });
        }
      } catch (error) {
        toast({
          title: "Location check failed",
          description: error instanceof Error ? error.message : "Try again before leaving this job.",
          variant: "destructive",
        });
        return;
      } finally {
        setVerifyingLocation(false);
      }
    }
    
    const stockPayload = Object.entries(stockUsed)
      .filter(([_, qty]) => qty > 0)
      .map(([id, qty]) => ({ stockItemId: Number(id), quantityUsed: qty }));

    createReport.mutate({
      data: {
        jobId: assignment.jobId!,
        jobAssignmentId: assignment.id,
        subcontractorId: assignment.subcontractorId!,
        dispatchDate: assignment.dispatchDate,
        metersCompleted: Number(meters),
        photos,
        silikoneColoursUsed: colours,
        stockUsed: stockPayload,
        issueType: issueType as any,
        issueDescription: issueType !== "none" ? issueDescription : undefined,
        hoursWorked: Number(hoursWorked) > 0 ? Number(hoursWorked) : undefined,
        workDescription: workDescription.trim() || undefined,
        generalNotes: notes
      }
    });
  };

  const isValid = Number(meters) > 0 && photos.length > 0 && stockInventoryAvailable && hasRecordedStockUsage && stockUsageChecked && stockUsageWithinInventory;

  if (loadingAssignment || loadingInventory) {
    return <div className="p-4 space-y-4 max-w-md mx-auto"><Skeleton className="h-10 w-32" /><Skeleton className="h-64 w-full" /></div>;
  }

  if (!assignment) {
    return <div className="p-4 text-center">Job assignment not found</div>;
  }

  return (
    <div className="max-w-md mx-auto space-y-6 pb-20">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/field")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-bold tracking-tight">Job Report</h1>
      </div>

      <Card>
        <CardHeader className="p-4 pb-2 bg-muted/50">
          <CardTitle className="text-lg">{assignment.jobTitle}</CardTitle>
          {assignment.workArea && (
            <p className="text-sm font-medium mt-1">{assignment.workArea}</p>
          )}
          {assignment.jobAddress && (
            <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
              <MapPin className="h-3 w-3" /> {assignment.jobAddress}
            </p>
          )}
        </CardHeader>
        <CardContent className="p-4 space-y-6">
          <div className="rounded-md border bg-background px-3 py-2 text-sm">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span><strong>Block:</strong> {timeWindowLabels[assignment.timeWindow ?? "full_day"] ?? assignment.timeWindow}</span>
              {(assignment.plannedStartTime || assignment.plannedEndTime) && (
                <span><strong>Time:</strong> {assignment.plannedStartTime || "Start"} - {assignment.plannedEndTime || "Finish"}</span>
              )}
              {assignment.estimatedMetres != null && (
                <span><strong>Target:</strong> {assignment.estimatedMetres}m</span>
              )}
            </div>
            {assignment.notes && (
              <p className="mt-2 text-muted-foreground">{assignment.notes}</p>
            )}
          </div>

          
          <div className="space-y-2">
            <Label className="text-base">Meters Completed <span className="text-destructive">*</span></Label>
            <Input 
              type="number" 
              placeholder="e.g. 150" 
              className="text-lg h-12"
              value={meters}
              onChange={(e) => setMeters(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-base">Hours Worked</Label>
            <Input
              type="number"
              min="0"
              step="0.25"
              placeholder={checkedJobHours ? checkedJobHours.toFixed(2) : "e.g. 3.5"}
              className="text-lg h-12"
              value={hoursWorked}
              onChange={(e) => setHoursWorked(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-base">Invoice Work Description</Label>
            <Textarea
              placeholder="e.g. Unit 4 bathrooms, balconies, pool coping"
              value={workDescription}
              onChange={(e) => setWorkDescription(e.target.value)}
            />
          </div>

          <div className="space-y-3">
            <div>
              <Label className="text-base">Completion Photos <span className="text-destructive">*</span></Label>
              <p className="text-xs text-muted-foreground mt-0.5">Upload at least one completion photo before leaving this job.</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {photos.map((src, i) => (
                <div key={i} className="relative aspect-square rounded-md overflow-hidden bg-muted">
                  <img src={src} alt="completion photo" className="object-cover w-full h-full" />
                  <button 
                    onClick={() => removePhoto(i)}
                    className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <label className="aspect-square flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-muted-foreground/30 hover:bg-muted cursor-pointer transition-colors text-muted-foreground">
                <Upload className="h-6 w-6" />
                <span className="text-xs font-medium">Add Photo</span>
                <input 
                  type="file" 
                  accept="image/*" 
                  capture="environment" 
                  multiple 
                  className="hidden" 
                  onChange={handlePhotoUpload}
                />
              </label>
            </div>
            {photos.length === 0 && <p className="text-xs text-destructive">At least 1 completion photo is required</p>}
          </div>

          <div className="space-y-3">
            <Label className="text-base">Silicone Colours Used</Label>
            <div className="space-y-2">
              {assignment.requiredColours?.map(c => (
                <div key={c} className="flex items-center space-x-2">
                  <Checkbox 
                    id={`color-${c}`} 
                    checked={colours.includes(c)}
                    onCheckedChange={(checked) => {
                      if (checked) setColours(prev => [...prev, c]);
                      else setColours(prev => prev.filter(x => x !== c));
                    }}
                  />
                  <label htmlFor={`color-${c}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                    {c} (Required)
                  </label>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-base">Stock Used <span className="text-destructive">*</span></Label>
            <div className="space-y-3 rounded-md border p-3">
              {inventoryItems.length > 0 ? (
                inventoryItems.map(item => {
                  const quantity = stockUsed[item.stockItemId] ?? 0;
                  const tooHigh = quantity > item.currentQuantity;
                  return (
                    <div key={item.id} className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{item.stockItemName}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.colour ?? "No colour recorded"} · Held: {formatQty(item.currentQuantity, item.unit)}
                          </p>
                        </div>
                        <Input
                          type="number"
                          min="0"
                          max={item.currentQuantity}
                          step="0.01"
                          placeholder="0"
                          className="h-9 w-24"
                          disabled={Number(item.currentQuantity) <= 0}
                          value={stockUsed[item.stockItemId] || ""}
                          onChange={(e) => setStockUsed(prev => ({ ...prev, [item.stockItemId]: Number(e.target.value) }))}
                        />
                      </div>
                      {tooHigh ? (
                        <p className="text-xs text-destructive">More than current stock held</p>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-muted-foreground">No inventory has been recorded for this employee/subcontractor yet.</p>
              )}
              <div className="flex items-center gap-2 border-t pt-3">
                <Checkbox
                  id="stock-usage-checked"
                  checked={stockUsageChecked}
                  disabled={!stockInventoryAvailable || !hasRecordedStockUsage}
                  onCheckedChange={(checked) => setStockUsageChecked(Boolean(checked))}
                />
                <label htmlFor="stock-usage-checked" className="text-sm font-medium leading-none">
                  Stock usage checked
                </label>
              </div>
            </div>
            {!stockInventoryAvailable ? (
              <p className="text-xs text-destructive">Admin must issue stock to this employee/subcontractor before the report can be submitted.</p>
            ) : !hasRecordedStockUsage ? (
              <p className="text-xs text-destructive">Enter at least one stock quantity used for this job.</p>
            ) : !stockUsageChecked ? (
              <p className="text-xs text-destructive">Confirm stock usage before submitting</p>
            ) : null}
          </div>

          <div className="space-y-3">
            <Label className="text-base">Issues on Site</Label>
            <RadioGroup value={issueType} onValueChange={setIssueType}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="none" id="issue-none" />
                <Label htmlFor="issue-none">None (All good)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="excessive_cleaning" id="issue-clean" />
                <Label htmlFor="issue-clean">Excessive Cleaning Required</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="site_not_ready" id="issue-ready" />
                <Label htmlFor="issue-ready">Site Not Ready</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="unsafe_environment" id="issue-unsafe" />
                <Label htmlFor="issue-unsafe">Unsafe Environment</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="builder_complaint" id="issue-complaint" />
                <Label htmlFor="issue-complaint">Builder Complaint</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="other" id="issue-other" />
                <Label htmlFor="issue-other">Other</Label>
              </div>
            </RadioGroup>

            {issueType !== "none" && (
              <Textarea 
                placeholder="Describe the issue in detail..." 
                value={issueDescription}
                onChange={(e) => setIssueDescription(e.target.value)}
                className="mt-2"
              />
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-base">General Notes</Label>
            <Textarea 
              placeholder="Any other notes about this job?" 
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <Button 
            className="w-full h-12 text-lg" 
            onClick={handleSubmit}
            disabled={!isValid || createReport.isPending || verifyingLocation}
          >
            {verifyingLocation ? "Checking Location..." : createReport.isPending ? "Submitting..." : "Submit Report & Leave Job"}
          </Button>

        </CardContent>
      </Card>
    </div>
  );
}
