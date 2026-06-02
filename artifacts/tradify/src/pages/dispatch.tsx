import { useState } from "react";
import { format } from "date-fns";
import { 
  useListDispatch, 
  useListJobs, 
  useListSubcontractors,
  useCreateDispatch,
  useUpdateJobAssignment,
  getListDispatchQueryKey
} from "@workspace/api-client-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarIcon, GripVertical, Plus, Trash2 } from "lucide-react";

const timeWindowLabels: Record<string, string> = {
  full_day: "Full day",
  morning: "Morning",
  afternoon: "Afternoon",
  custom: "Custom time",
};

function optionalText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function optionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export default function Dispatch() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  
  // Create dispatch form state
  const [selectedJob, setSelectedJob] = useState("");
  const [selectedSub, setSelectedSub] = useState("");
  const [order, setOrder] = useState("1");
  const [workArea, setWorkArea] = useState("");
  const [timeWindow, setTimeWindow] = useState("full_day");
  const [plannedStartTime, setPlannedStartTime] = useState("");
  const [plannedEndTime, setPlannedEndTime] = useState("");
  const [estimatedMetres, setEstimatedMetres] = useState("");
  const [colours, setColours] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [notes, setNotes] = useState("");

  const { data: dispatchList, isLoading: loadingDispatch } = useListDispatch({ date });
  const { data: jobs, isLoading: loadingJobs } = useListJobs();
  const { data: subs, isLoading: loadingSubs } = useListSubcontractors();

  const createDispatch = useCreateDispatch({
    mutation: {
      onSuccess: () => {
        toast({ title: "Dispatch created" });
        queryClient.invalidateQueries({ queryKey: getListDispatchQueryKey({ date }) });
        setCreateDialogOpen(false);
        resetForm();
      }
    }
  });

  const deleteAssignment = useMutation({
    mutationFn: (id: number) => fetch(`/api/dispatch/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Assignment removed" });
      queryClient.invalidateQueries({ queryKey: getListDispatchQueryKey({ date }) });
    },
  });

  const resetForm = () => {
    setSelectedJob("");
    setSelectedSub("");
    setOrder("1");
    setWorkArea("");
    setTimeWindow("full_day");
    setPlannedStartTime("");
    setPlannedEndTime("");
    setEstimatedMetres("");
    setColours("");
    setContactName("");
    setContactPhone("");
    setNotes("");
  };

  const handleCreate = () => {
    if (!selectedJob) return;
    createDispatch.mutate({
      data: {
        dispatchDate: date,
        assignments: [
          {
            jobId: parseInt(selectedJob),
            subcontractorId: selectedSub ? parseInt(selectedSub) : undefined,
            scheduledOrder: parseInt(order),
            workArea: optionalText(workArea),
            timeWindow,
            plannedStartTime: optionalText(plannedStartTime),
            plannedEndTime: optionalText(plannedEndTime),
            estimatedMetres: optionalNumber(estimatedMetres),
            requiredColours: colours ? colours.split(',').map(c => c.trim()) : [],
            builderContactName: optionalText(contactName),
            builderContactPhone: optionalText(contactPhone),
            notes: optionalText(notes)
          }
        ]
      }
    });
  };

  const pendingJobs = jobs?.filter(j => j.status === 'pending' || j.status === 'in_progress') || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dispatch</h1>
          <p className="text-muted-foreground mt-2">Break larger jobs into daily work blocks for employees/subcontractors.</p>
        </div>
        
        <div className="flex items-center gap-2">
          <Input 
            type="date" 
            value={date} 
            onChange={(e) => setDate(e.target.value)}
            className="w-auto"
          />
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" /> Assign Work Block</Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Assign Work Block</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Job / project</Label>
                  <Select value={selectedJob} onValueChange={setSelectedJob}>
                    <SelectTrigger><SelectValue placeholder="Select a job or project" /></SelectTrigger>
                    <SelectContent>
                      {pendingJobs.map(j => (
                        <SelectItem key={j.id} value={j.id.toString()}>{j.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Work block / units</Label>
                  <Input
                    value={workArea}
                    onChange={(e) => setWorkArea(e.target.value)}
                    placeholder="e.g. Units 1-4 bathrooms, Level 2 balconies, Block B"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Employee/Subcontractor</Label>
                    <Select value={selectedSub || "none"} onValueChange={(value) => setSelectedSub(value === "none" ? "" : value)}>
                      <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Unassigned</SelectItem>
                        {subs?.map(s => (
                          <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Order / Stop #</Label>
                    <Input type="number" value={order} onChange={(e) => setOrder(e.target.value)} min="1" />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Day part</Label>
                    <Select value={timeWindow} onValueChange={setTimeWindow}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="full_day">Full day</SelectItem>
                        <SelectItem value="morning">Morning</SelectItem>
                        <SelectItem value="afternoon">Afternoon</SelectItem>
                        <SelectItem value="custom">Custom time</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Start</Label>
                    <Input type="time" value={plannedStartTime} onChange={(e) => setPlannedStartTime(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Finish</Label>
                    <Input type="time" value={plannedEndTime} onChange={(e) => setPlannedEndTime(e.target.value)} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Estimated metres for this block</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.1"
                    value={estimatedMetres}
                    onChange={(e) => setEstimatedMetres(e.target.value)}
                    placeholder="e.g. 80"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Required Colours (comma separated)</Label>
                  <Input value={colours} onChange={(e) => setColours(e.target.value)} placeholder="e.g. Alabaster, White, Clear" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Site Contact Name</Label>
                    <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Site Contact Phone</Label>
                    <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Instructions for this block</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Complete wet area internals first, leave balconies for afternoon crew."
                    rows={3}
                  />
                </div>

                <Button className="w-full mt-4" onClick={handleCreate} disabled={!selectedJob || createDispatch.isPending}>
                  Add Work Block
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Available Jobs */}
        <Card className="col-span-1 border-dashed">
          <CardHeader className="bg-muted/30">
            <CardTitle className="text-lg">Pending Jobs / Projects</CardTitle>
            <CardDescription>Select one, then schedule one block at a time</CardDescription>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            {loadingJobs ? (
              [1,2,3].map(i => <Skeleton key={i} className="h-20 w-full" />)
            ) : pendingJobs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No pending jobs found.</p>
            ) : (
              pendingJobs.map(job => (
                <div key={job.id} className="p-3 border rounded-md bg-card hover:border-primary/50 transition-colors cursor-pointer" onClick={() => {
                  setSelectedJob(job.id.toString());
                  setCreateDialogOpen(true);
                }}>
                  <div className="font-medium text-sm">{job.title}</div>
                  {job.address && <div className="text-xs text-muted-foreground mt-1 truncate">{job.address}</div>}
                  <div className="flex gap-2 mt-2">
                    <Badge variant="outline" className="text-[10px]">#{job.id}</Badge>
                    {job.priority === 'high' && <Badge variant="destructive" className="text-[10px]">High Priority</Badge>}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Right Column: Scheduled */}
        <Card className="col-span-1 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Work Blocks for {format(new Date(date), 'MMM do, yyyy')}</CardTitle>
            <CardDescription>Use stop numbers and day parts to split larger unit or apartment jobs.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {loadingDispatch ? (
                <div className="p-4 space-y-4">
                  {[1,2].map(i => <Skeleton key={i} className="h-24 w-full" />)}
                </div>
              ) : dispatchList?.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  No work blocks scheduled for this date.
                </div>
              ) : (
                dispatchList?.sort((a, b) => a.scheduledOrder - b.scheduledOrder).map(assignment => (
                  <div key={assignment.id} className="p-4 flex gap-4 hover:bg-muted/30 transition-colors">
                    <div className="flex flex-col items-center justify-center cursor-grab text-muted-foreground/50 hover:text-foreground">
                      <GripVertical className="h-5 w-5" />
                      <span className="text-xs font-bold mt-1">{assignment.scheduledOrder}</span>
                    </div>
                    
                    <div className="flex-1 space-y-1">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-semibold">{assignment.jobTitle}</h4>
                          {assignment.workArea && <p className="text-sm font-medium text-foreground">{assignment.workArea}</p>}
                          <p className="text-sm text-muted-foreground">{assignment.jobAddress}</p>
                        </div>
                        <Badge variant={
                          assignment.status === 'completed' ? 'secondary' :
                          assignment.status === 'in_progress' ? 'default' :
                          assignment.status === 'arrived' ? 'default' : 'outline'
                        }>
                          {assignment.status.replace('_', ' ')}
                        </Badge>
                      </div>
                      
                      <div className="flex flex-wrap gap-x-4 gap-y-2 mt-2 text-sm">
                        <div className="flex items-center gap-1.5 bg-muted/50 px-2 py-0.5 rounded-md">
                          <span className="text-muted-foreground">Sub:</span>
                          <span className="font-medium">{assignment.subcontractorName || 'Unassigned'}</span>
                        </div>

                        <div className="flex items-center gap-1.5 bg-muted/50 px-2 py-0.5 rounded-md">
                          <span className="text-muted-foreground">Block:</span>
                          <span className="font-medium">{timeWindowLabels[assignment.timeWindow ?? "full_day"] ?? assignment.timeWindow}</span>
                        </div>

                        {(assignment.plannedStartTime || assignment.plannedEndTime) && (
                          <div className="flex items-center gap-1.5 bg-muted/50 px-2 py-0.5 rounded-md">
                            <span className="text-muted-foreground">Time:</span>
                            <span className="font-medium">
                              {assignment.plannedStartTime || "Start"} - {assignment.plannedEndTime || "Finish"}
                            </span>
                          </div>
                        )}

                        {assignment.estimatedMetres != null && (
                          <div className="flex items-center gap-1.5 bg-muted/50 px-2 py-0.5 rounded-md">
                            <span className="text-muted-foreground">Target:</span>
                            <span className="font-medium">{assignment.estimatedMetres}m</span>
                          </div>
                        )}
                        
                        {assignment.requiredColours && assignment.requiredColours.length > 0 && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">Colours:</span>
                            <div className="flex gap-1">
                              {assignment.requiredColours.map(c => (
                                <Badge key={c} variant="secondary" className="text-[10px] h-5">{c}</Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {assignment.notes && (
                        <p className="mt-2 rounded-md bg-muted/40 px-2 py-1.5 text-sm text-muted-foreground">
                          {assignment.notes}
                        </p>
                      )}
                      
                      {(assignment.arrivedAt || assignment.departedAt) && (
                        <div className="flex gap-4 text-xs text-muted-foreground mt-2 border-t pt-2">
                          {assignment.arrivedAt && <span>Arrived: {format(new Date(assignment.arrivedAt), 'HH:mm')}</span>}
                          {assignment.departedAt && <span>Departed: {format(new Date(assignment.departedAt), 'HH:mm')}</span>}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-2">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => {
                          if (confirm('Remove assignment?')) {
                            deleteAssignment.mutate(assignment.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
