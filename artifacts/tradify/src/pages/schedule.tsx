import { useListAppointments } from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CalendarDays, CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/speech-textarea";
import { useToast } from "@/hooks/use-toast";
import {
  type LeaveRequest,
  dateFromInputValue,
  dateInputValue,
  formatDayOffDate,
  leaveStatusBadgeVariant,
  leaveStatusLabel,
} from "@/lib/leave-requests";

export default function Schedule() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [decisionNotes, setDecisionNotes] = useState<Record<number, string>>({});

  const { data: appointments, isLoading } = useListAppointments();
  const { data: leaveRequests = [] } = useQuery<LeaveRequest[]>({
    queryKey: ["leave-requests"],
    queryFn: async () => {
      const response = await fetch("/api/leave-requests");
      if (!response.ok) throw new Error("Could not load day off requests");
      return response.json();
    },
  });

  const decisionMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: "approved" | "declined" }) => {
      const response = await fetch(`/api/leave-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, adminNote: decisionNotes[id] || undefined }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Could not update day off request");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      setDecisionNotes({});
      toast({ title: "Day off request updated" });
    },
    onError: (error) => {
      toast({
        title: "Could not update request",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    },
  });

  const selectedDateValue = date ? dateInputValue(date) : "";
  const selectedDateAppointments = appointments?.filter((app) => {
    if (!date || !app.startTime) return false;
    return new Date(app.startTime).toDateString() === date.toDateString();
  });
  const selectedDateLeave = leaveRequests.filter(
    (request) => request.dayOffDate === selectedDateValue && request.status !== "cancelled",
  );
  const pendingLeave = leaveRequests.filter((request) => request.status === "pending");
  const approvedDates = leaveRequests.filter((request) => request.status === "approved").map((request) => dateFromInputValue(request.dayOffDate));
  const pendingDates = pendingLeave.map((request) => dateFromInputValue(request.dayOffDate));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Schedule</h1>
        <p className="text-muted-foreground mt-2">Manage appointments, scheduling and employee/subcontractor day off requests.</p>
      </div>

      <div className="grid gap-8 md:grid-cols-3">
        <Card className="border-none bg-transparent shadow-none md:col-span-1">
          <Calendar
            mode="single"
            selected={date}
            onSelect={setDate}
            className="rounded-md border bg-card"
            modifiers={{ approvedLeave: approvedDates, pendingLeave: pendingDates }}
            modifiersClassNames={{
              approvedLeave: "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-200",
              pendingLeave: "bg-orange-100 text-orange-900 dark:bg-orange-950/50 dark:text-orange-100",
            }}
          />
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-sm bg-orange-100 px-2 py-1 text-orange-900 dark:bg-orange-950/50 dark:text-orange-100">Pending day off</span>
            <span className="rounded-sm bg-green-100 px-2 py-1 text-green-800 dark:bg-green-950/50 dark:text-green-200">Approved day off</span>
          </div>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>
              {date ? date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) : "Select a date"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">Appointments</h2>
              </div>
              {isLoading ? (
                [1, 2].map((item) => <Skeleton key={item} className="h-20 w-full" />)
              ) : selectedDateAppointments?.length ? (
                selectedDateAppointments.map((app) => (
                  <div key={app.id} className="flex gap-4 rounded-lg border p-4">
                    <div className="min-w-24 border-r pr-4 text-sm font-medium">
                      {new Date(app.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                    <div>
                      <h4 className="font-semibold">{app.title}</h4>
                      <p className="text-sm text-muted-foreground">{app.customerName}</p>
                      <div className="mt-2">
                        <Badge variant="outline">{app.status}</Badge>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No appointments for this date.</p>
              )}
            </div>

            <div className="space-y-3 border-t pt-5">
              <h2 className="text-sm font-semibold">Day Off Requests</h2>
              {selectedDateLeave.length > 0 ? (
                selectedDateLeave.map((request) => (
                  <div key={request.id} className="rounded-lg border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{request.subcontractorName ?? `Sub #${request.subcontractorId}`}</p>
                        {request.reason ? <p className="mt-1 text-sm text-muted-foreground">{request.reason}</p> : null}
                        {request.adminNote ? <p className="mt-1 text-sm text-muted-foreground">Admin: {request.adminNote}</p> : null}
                      </div>
                      <Badge variant={leaveStatusBadgeVariant(request.status)}>{leaveStatusLabel(request.status)}</Badge>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No day off requests for this date.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3 text-lg">
            <span>Pending Day Off Approvals</span>
            <Badge variant="secondary">{pendingLeave.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pendingLeave.length > 0 ? (
            <div className="space-y-3">
              {pendingLeave.map((request) => (
                <div key={request.id} className="rounded-lg border p-4">
                  <div className="grid gap-4 md:grid-cols-[1fr_18rem] md:items-start">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{request.subcontractorName ?? `Sub #${request.subcontractorId}`}</p>
                        <Badge variant="outline">{formatDayOffDate(request.dayOffDate)}</Badge>
                      </div>
                      {request.reason ? <p className="mt-2 text-sm text-muted-foreground">{request.reason}</p> : null}
                    </div>
                    <div className="space-y-2">
                      <Textarea
                        rows={2}
                        value={decisionNotes[request.id] ?? ""}
                        onChange={(event) => setDecisionNotes((notes) => ({ ...notes, [request.id]: event.target.value }))}
                        placeholder="Optional admin note..."
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          size="sm"
                          onClick={() => decisionMutation.mutate({ id: request.id, status: "approved" })}
                          disabled={decisionMutation.isPending}
                        >
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => decisionMutation.mutate({ id: request.id, status: "declined" })}
                          disabled={decisionMutation.isPending}
                        >
                          <XCircle className="mr-2 h-4 w-4" />
                          Decline
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No pending day off requests.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
