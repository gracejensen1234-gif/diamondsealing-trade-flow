import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { useListDispatch, useListStockItems, useCreateJobReport, getListDispatchQueryKey, getListJobReportsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { ArrowLeft, Upload, X, MapPin } from "lucide-react";

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
  const { data: stockItems, isLoading: loadingStock } = useListStockItems();

  const [meters, setMeters] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [colours, setColours] = useState<string[]>([]);
  const [stockUsed, setStockUsed] = useState<Record<number, number>>({});
  const [issueType, setIssueType] = useState<string>("none");
  const [issueDescription, setIssueDescription] = useState("");
  const [notes, setNotes] = useState("");

  const createReport = useCreateJobReport({
    mutation: {
      onSuccess: () => {
        toast({ title: "Job report submitted successfully" });
        queryClient.invalidateQueries({ queryKey: getListJobReportsQueryKey() });
        setLocation("/field");
      }
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

  const handleSubmit = () => {
    if (!assignment) return;
    
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
        generalNotes: notes
      }
    });
  };

  const isValid = Number(meters) > 0 && photos.length > 0;

  if (loadingAssignment || loadingStock) {
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
          {assignment.jobAddress && (
            <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
              <MapPin className="h-3 w-3" /> {assignment.jobAddress}
            </p>
          )}
        </CardHeader>
        <CardContent className="p-4 space-y-6">
          
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

          <div className="space-y-3">
            <div>
              <Label className="text-base">Completion Photos <span className="text-destructive">*</span></Label>
              <p className="text-xs text-muted-foreground mt-0.5">Take photos of the completed work for quality audit and job evidence.</p>
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
            <Label className="text-base">Stock Used (Optional)</Label>
            <div className="space-y-3 border rounded-md p-3">
              {stockItems?.map(item => (
                <div key={item.id} className="flex items-center justify-between gap-2">
                  <span className="text-sm">{item.name} <span className="text-muted-foreground text-xs">({item.unit})</span></span>
                  <Input 
                    type="number" 
                    min="0"
                    placeholder="0"
                    className="w-20 h-8"
                    value={stockUsed[item.id] || ""}
                    onChange={(e) => setStockUsed(prev => ({...prev, [item.id]: Number(e.target.value)}))}
                  />
                </div>
              ))}
            </div>
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
            disabled={!isValid || createReport.isPending}
          >
            Submit Report
          </Button>

        </CardContent>
      </Card>
    </div>
  );
}
