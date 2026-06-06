import { useGetJob, getGetJobQueryKey, getListJobsQueryKey, useUpdateJob, useListDispatch, useListAppointments, useListInvoices } from "@workspace/api-client-react";
import { useRoute } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

function formatJobDate(value: string | null | undefined, fallback: string): string {
  return value ? new Date(value).toLocaleDateString("en-AU") : fallback;
}

const timeWindowLabels: Record<string, string> = {
  full_day: "Full day",
  morning: "Morning",
  afternoon: "Afternoon",
  custom: "Custom time",
};

export default function JobDetail() {
  const [, params] = useRoute("/jobs/:id");
  const id = Number(params?.id);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const { data: job, isLoading } = useGetJob(id, { query: { enabled: !!id, queryKey: getGetJobQueryKey(id) } });
  const { data: dispatchBlocks = [], isLoading: loadingDispatch } = useListDispatch(
    undefined,
    { query: { enabled: !!id, queryKey: ["job-dispatch-blocks", id] } },
  );
  const updateJob = useUpdateJob();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleStatusChange = (newStatus: any) => {
    updateJob.mutate({ id, data: { status: newStatus } }, {
      onSuccess: () => {
        toast({ title: "Job updated", description: "Status changed successfully." });
        queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["job-dispatch-blocks", id] });
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to update job status.", variant: "destructive" });
      }
    });
  };

  const handleCancelJob = () => {
    updateJob.mutate({ id, data: { status: "cancelled" } }, {
      onSuccess: () => {
        toast({ title: "Job cancelled", description: "Pending dispatch blocks were removed." });
        setCancelDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["job-dispatch-blocks", id] });
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to cancel job.", variant: "destructive" });
      },
    });
  };

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (!job) return <div>Job not found</div>;

  const jobBlocks = dispatchBlocks
    .filter((block) => block.jobId === id)
    .sort((a, b) => {
      const dateCompare = new Date(a.dispatchDate).getTime() - new Date(b.dispatchDate).getTime();
      return dateCompare || a.scheduledOrder - b.scheduledOrder;
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">{job.title}</h1>
          <p className="text-muted-foreground mt-1">Client: {job.customerName}</p>
          <p className="text-muted-foreground">Address: {job.address}</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-4">
          <Select value={job.status} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="invoiced">Invoiced</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="destructive"
            className="w-full sm:w-auto"
            onClick={() => setCancelDialogOpen(true)}
            disabled={job.status === "cancelled" || updateJob.isPending}
          >
            Cancel Job
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div><span className="font-semibold">Job type:</span> {job.title}</div>
            <div><span className="font-semibold">Priority:</span> <Badge variant="outline">{job.priority}</Badge></div>
            <div><span className="font-semibold">Scheduled date:</span> {formatJobDate(job.scheduledDate, "Unscheduled")}</div>
            <div><span className="font-semibold">Due date:</span> {formatJobDate(job.dueDate, "No due date")}</div>
            {job.completedDate && (
              <div><span className="font-semibold">Completed date:</span> {formatJobDate(job.completedDate, "Not completed")}</div>
            )}
            <div><span className="font-semibold">Description:</span> <p className="mt-1 text-sm">{job.description || 'No description'}</p></div>
            <div><span className="font-semibold">Notes:</span> <p className="mt-1 text-sm text-muted-foreground">{job.notes || 'No notes'}</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Schedule Breakdown</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {loadingDispatch ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : jobBlocks.length > 0 ? (
              jobBlocks.map((block) => (
                <div key={block.id} className="rounded-md border bg-background p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {formatJobDate(block.dispatchDate, "Unscheduled")} &bull; Stop {block.scheduledOrder}
                      </p>
                      {block.workArea && <p className="mt-0.5 text-sm font-medium">{block.workArea}</p>}
                      <p className="mt-1 text-sm text-muted-foreground">
                        {block.subcontractorName || "Unassigned"} &bull; {timeWindowLabels[block.timeWindow ?? "full_day"] ?? block.timeWindow}
                        {(block.plannedStartTime || block.plannedEndTime) ? ` (${block.plannedStartTime || "Start"} - ${block.plannedEndTime || "Finish"})` : ""}
                      </p>
                    </div>
                    <Badge variant={block.status === "completed" ? "secondary" : block.status === "pending" ? "outline" : "default"}>
                      {block.status.replace("_", " ")}
                    </Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {block.estimatedMetres != null && <Badge variant="secondary">Target: {block.estimatedMetres}m</Badge>}
                    {block.requiredColours?.map((colour) => <Badge key={colour} variant="outline">{colour}</Badge>)}
                  </div>
                  {block.notes && <p className="mt-2 text-sm text-muted-foreground">{block.notes}</p>}
                </div>
              ))
            ) : (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                No work blocks scheduled yet. Add them from Dispatch.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel job?</DialogTitle>
            <DialogDescription>
              This marks the job as cancelled and removes any pending dispatch blocks that have not been worked yet.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-muted/50 px-3 py-2 text-sm font-medium">{job.title}</div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setCancelDialogOpen(false)} disabled={updateJob.isPending}>
              Keep Job
            </Button>
            <Button variant="destructive" onClick={handleCancelJob} disabled={updateJob.isPending}>
              {updateJob.isPending ? "Cancelling..." : "Cancel Job"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
