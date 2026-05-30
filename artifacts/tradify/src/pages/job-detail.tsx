import { useGetJob, getGetJobQueryKey, useUpdateJob, useListAppointments, useListQuotes, useListInvoices } from "@workspace/api-client-react";
import { useRoute } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function JobDetail() {
  const [, params] = useRoute("/jobs/:id");
  const id = Number(params?.id);
  const { data: job, isLoading } = useGetJob(id, { query: { enabled: !!id, queryKey: getGetJobQueryKey(id) } });
  const updateJob = useUpdateJob();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleStatusChange = (newStatus: any) => {
    updateJob.mutate({ id, data: { status: newStatus } }, {
      onSuccess: () => {
        toast({ title: "Job updated", description: "Status changed successfully." });
        queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(id) });
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to update job status.", variant: "destructive" });
      }
    });
  };

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (!job) return <div>Job not found</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{job.title}</h1>
          <p className="text-muted-foreground mt-1">Customer: {job.customerName}</p>
          <p className="text-muted-foreground">Address: {job.address}</p>
        </div>
        <div className="flex items-center gap-4">
          <Select value={job.status} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-[180px]">
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
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div><span className="font-semibold">Priority:</span> <Badge variant="outline">{job.priority}</Badge></div>
            <div><span className="font-semibold">Scheduled Date:</span> {job.scheduledDate ? new Date(job.scheduledDate).toLocaleDateString() : 'Unscheduled'}</div>
            <div><span className="font-semibold">Description:</span> <p className="mt-1 text-sm">{job.description || 'No description'}</p></div>
            <div><span className="font-semibold">Notes:</span> <p className="mt-1 text-sm text-muted-foreground">{job.notes || 'No notes'}</p></div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
