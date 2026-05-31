import { getListJobsQueryKey, useCreateJob, useListCustomers, useListJobs } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";

const emptyJobForm = {
  title: "",
  customerId: "none",
  address: "",
  scheduledDate: "",
  dueDate: "",
  priority: "medium",
  status: "pending",
  description: "",
  notes: "",
};

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleDateString("en-AU") : "Not set";
}

function dueDateVariant(value: string | null | undefined, status: string): "outline" | "secondary" | "destructive" {
  if (!value || status === "completed" || status === "cancelled") return "secondary";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(value);
  due.setHours(0, 0, 0, 0);
  return due < today ? "destructive" : "outline";
}

export default function Jobs() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyJobForm);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: jobs, isLoading } = useListJobs();
  const { data: customers } = useListCustomers();

  const createJob = useCreateJob({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
        setForm(emptyJobForm);
        setOpen(false);
        toast({ title: "Job created" });
      },
      onError: () => {
        toast({
          title: "Could not create job",
          description: "Check the required fields and try again.",
          variant: "destructive",
        });
      },
    },
  });

  const updateForm = (field: keyof typeof emptyJobForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleCreateJob = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = form.title.trim();
    if (!title) {
      toast({
        title: "Job type required",
        description: "Enter a job type before saving.",
        variant: "destructive",
      });
      return;
    }

    createJob.mutate({
      data: {
        title,
        customerId: form.customerId !== "none" ? Number(form.customerId) : undefined,
        address: optionalText(form.address),
        scheduledDate: optionalText(form.scheduledDate),
        dueDate: optionalText(form.dueDate),
        priority: form.priority as "low" | "medium" | "high",
        status: form.status as "pending" | "in_progress" | "completed" | "invoiced" | "cancelled",
        description: optionalText(form.description),
        notes: optionalText(form.notes),
      },
    });
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">Jobs</h1>
          <p className="text-muted-foreground mt-2">Manage your active and completed jobs.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <Button
            type="button"
            className="w-full sm:w-auto"
            aria-haspopup="dialog"
            onClick={() => setOpen(true)}
          >
            <Plus className="mr-2 h-4 w-4" /> New Job
          </Button>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>New job</DialogTitle>
            </DialogHeader>
            <form className="space-y-5" onSubmit={handleCreateJob}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="job-title">Job type</Label>
                  <Input
                    id="job-title"
                    value={form.title}
                    onChange={(event) => updateForm("title", event.target.value)}
                    placeholder="e.g. Residential sealing, commercial caulking"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Client</Label>
                  <Select value={form.customerId} onValueChange={(value) => updateForm("customerId", value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select client" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No client</SelectItem>
                      {(customers ?? []).map((customer) => (
                        <SelectItem key={customer.id} value={String(customer.id)}>
                          {customer.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="job-scheduled-date">Scheduled date</Label>
                  <Input
                    id="job-scheduled-date"
                    type="date"
                    value={form.scheduledDate}
                    onChange={(event) => updateForm("scheduledDate", event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="job-due-date">Due date</Label>
                  <Input
                    id="job-due-date"
                    type="date"
                    value={form.dueDate}
                    onChange={(event) => updateForm("dueDate", event.target.value)}
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="job-address">Address</Label>
                  <Input
                    id="job-address"
                    value={form.address}
                    onChange={(event) => updateForm("address", event.target.value)}
                    placeholder="Job address"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Select value={form.priority} onValueChange={(value) => updateForm("priority", value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={(value) => updateForm("status", value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="in_progress">In progress</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="invoiced">Invoiced</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="job-description">Description</Label>
                  <Textarea
                    id="job-description"
                    value={form.description}
                    onChange={(event) => updateForm("description", event.target.value)}
                    placeholder="Work description"
                    rows={3}
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="job-notes">Notes</Label>
                  <Textarea
                    id="job-notes"
                    value={form.notes}
                    onChange={(event) => updateForm("notes", event.target.value)}
                    placeholder="Internal notes"
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createJob.isPending}>
                  {createJob.isPending ? "Saving..." : "Save Job"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4">
        {isLoading ? (
          [1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)
        ) : jobs?.map(job => (
          <Link key={job.id} href={`/jobs/${job.id}`}>
            <Card className="hover:border-primary transition-colors cursor-pointer">
              <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                <div className="min-w-0">
                  <h3 className="font-semibold text-lg">{job.title}</h3>
                  <p className="text-muted-foreground text-sm mt-1">
                    {job.customerName || "No client"} &bull; {job.address || "No address"}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="secondary">Scheduled: {formatDate(job.scheduledDate)}</Badge>
                    <Badge variant={dueDateVariant(job.dueDate, job.status)}>Due: {formatDate(job.dueDate)}</Badge>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  <Badge variant={job.status === "completed" ? "secondary" : "default"}>
                    {job.status.replace("_", " ").toUpperCase()}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        {!isLoading && jobs?.length === 0 && (
           <div className="text-center py-12 text-muted-foreground border rounded-lg border-dashed">
             No jobs found.
           </div>
        )}
      </div>
    </div>
  );
}
