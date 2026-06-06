import { useState } from "react";
import { format, subDays, addDays, startOfWeek, endOfWeek } from "date-fns";
import {
  useClockOff,
  useClockOn,
  useGetAdminTimesheets,
  useGetTodaySession,
  useUpdateWorkSession,
  useListSubcontractors,
  getGetTodaySessionQueryKey,
} from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, ChevronLeft, ChevronRight, Edit2, Play, Square } from "lucide-react";

function apiErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Try again.";
}

export default function AdminTimesheets() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [subId, setSubId] = useState<string>("all");
  const [manualSubId, setManualSubId] = useState<string>("");
  const [earlyClockOffReason, setEarlyClockOffReason] = useState("");
  
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 }); // Monday start
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });

  const { data: subs } = useListSubcontractors();
  const manualSubcontractorId = manualSubId ? parseInt(manualSubId) : undefined;
  const manualSessionParams = { subcontractorId: manualSubcontractorId ?? 0 };
  const { data: manualSession, isFetching: loadingManualSession } = useGetTodaySession(
    manualSessionParams,
    {
      query: {
        enabled: Boolean(manualSubcontractorId),
        queryKey: getGetTodaySessionQueryKey(manualSessionParams),
        retry: false,
      },
    },
  );
  const { data: timesheets, isLoading } = useGetAdminTimesheets({
    weekStart: format(weekStart, 'yyyy-MM-dd'),
    subcontractorId: subId !== "all" ? parseInt(subId) : undefined
  });

  const [editSessionId, setEditSessionId] = useState<number | null>(null);
  const [editClockOn, setEditClockOn] = useState("");
  const [editClockOff, setEditClockOff] = useState("");
  const [editBreak, setEditBreak] = useState("");

  const updateSession = useUpdateWorkSession({
    mutation: {
      onSuccess: () => {
        toast({ title: "Timesheet updated" });
        queryClient.invalidateQueries(); // Simple blanket invalidate
        setEditSessionId(null);
      }
    }
  });

  const manualClockOn = useClockOn({
    mutation: {
      onSuccess: () => {
        toast({ title: "Employee/subcontractor clocked on" });
        queryClient.invalidateQueries();
      },
      onError: (error) => {
        toast({
          title: "Could not clock on",
          description: error instanceof Error ? error.message : "Try again.",
          variant: "destructive",
        });
      },
    },
  });

  const manualClockOff = useClockOff({
    mutation: {
      onSuccess: () => {
        toast({ title: "Employee/subcontractor clocked off" });
        queryClient.invalidateQueries();
      },
      onError: (error) => {
        toast({
          title: "Could not clock off",
          description: apiErrorMessage(error),
          variant: "destructive",
        });
      },
    },
  });

  const earlyClockOff = useMutation({
    mutationFn: async ({ subcontractorId, reason }: { subcontractorId: number; reason?: string }) => {
      const response = await fetch("/api/work-sessions/admin-clock-off-early", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subcontractorId, reason: reason || undefined }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Could not clock off early");
      }
      return payload as {
        remainingAssignmentsChecked: number;
        reassignedCount: number;
        reviewRequiredCount: number;
      };
    },
    onSuccess: (result) => {
      toast({
        title: "Clocked off early",
        description: `${result.reassignedCount} reassigned, ${result.reviewRequiredCount} need review from ${result.remainingAssignmentsChecked} remaining work block(s).`,
      });
      setEarlyClockOffReason("");
      queryClient.invalidateQueries();
    },
    onError: (error) => {
      toast({
        title: "Could not clock off early",
        description: apiErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  const formatHours = (mins: number | null | undefined) => {
    if (!mins) return "-";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
  };

  const handleSaveEdit = () => {
    if (!editSessionId) return;
    updateSession.mutate({
      id: editSessionId,
      data: {
        clockedOnAt: editClockOn ? new Date(editClockOn).toISOString() : undefined,
        clockedOffAt: editClockOff ? new Date(editClockOff).toISOString() : undefined,
        totalBreakMinutes: parseInt(editBreak) || 0
      }
    });
  };

  const groupedBySub = timesheets?.reduce((acc, entry) => {
    if (!acc[entry.subcontractorId]) {
      acc[entry.subcontractorId] = {
        name: entry.subcontractorName,
        entries: [],
        totalWorkMins: 0,
        totalBreakMins: 0,
        totalJobs: 0,
        totalMetres: 0
      };
    }
    acc[entry.subcontractorId].entries.push(entry);
    acc[entry.subcontractorId].totalWorkMins += entry.totalWorkMinutes || 0;
    acc[entry.subcontractorId].totalBreakMins += entry.totalBreakMinutes || 0;
    acc[entry.subcontractorId].totalJobs += entry.jobsCompleted || 0;
    acc[entry.subcontractorId].totalMetres += entry.totalMetres || 0;
    return acc;
  }, {} as Record<number, any>);

  const canManualClockOn = Boolean(manualSubcontractorId && !manualSession && !loadingManualSession);
  const canManualClockOff = Boolean(
    manualSubcontractorId &&
    manualSession &&
    manualSession.status !== "clocked_off" &&
    !loadingManualSession,
  );
  const canEarlyClockOff = Boolean(manualSubcontractorId && !loadingManualSession);
  const manualStatusLabel = !manualSubcontractorId
    ? "Select employee/subcontractor"
    : loadingManualSession
    ? "Checking..."
    : manualSession
    ? manualSession.status.replace("_", " ")
    : "not clocked on";

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Timesheets</h1>
          <p className="text-muted-foreground mt-2">Review work sessions and hours.</p>
        </div>
        
        <div className="flex items-center gap-4">
          <Select value={subId} onValueChange={setSubId}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="All employees/subcontractors" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All employees/subcontractors</SelectItem>
              {subs?.map(s => (
                <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center bg-muted rounded-md p-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentDate(subDays(currentDate, 7))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="px-4 text-sm font-medium">
              {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentDate(addDays(currentDate, 7))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Admin Clock Controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[minmax(14rem,1fr)_auto_auto_auto] md:items-end">
            <div className="space-y-2">
              <Label>Employee/Subcontractor</Label>
              <Select value={manualSubId} onValueChange={setManualSubId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select employee/subcontractor..." />
                </SelectTrigger>
                <SelectContent>
                  {subs?.map((s) => (
                    <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Today</Label>
              <div>
                <Badge variant={manualSession?.status === "clocked_off" ? "secondary" : manualSession ? "default" : "outline"}>
                  {manualStatusLabel}
                </Badge>
              </div>
            </div>

            <Button
              type="button"
              onClick={() => manualSubcontractorId && manualClockOn.mutate({ data: { subcontractorId: manualSubcontractorId } })}
              disabled={!canManualClockOn || manualClockOn.isPending || manualClockOff.isPending || earlyClockOff.isPending}
            >
              <Play className="mr-2 h-4 w-4" />
              Clock On Now
            </Button>

            <Button
              type="button"
              variant="destructive"
              onClick={() => manualSubcontractorId && manualClockOff.mutate({ data: { subcontractorId: manualSubcontractorId } })}
              disabled={!canManualClockOff || manualClockOn.isPending || manualClockOff.isPending || earlyClockOff.isPending}
            >
              <Square className="mr-2 h-4 w-4" />
              Clock Off Now
            </Button>
          </div>

          <div className="grid gap-3 rounded-md border bg-muted/30 p-3 md:grid-cols-[minmax(14rem,1fr)_auto] md:items-end">
            <div className="space-y-2">
              <Label>Early finish reason</Label>
              <Input
                value={earlyClockOffReason}
                onChange={(event) => setEarlyClockOffReason(event.target.value)}
                placeholder="e.g. Sick, family emergency, wet weather"
              />
            </div>
            <Button
              type="button"
              variant="destructive"
              className="w-full whitespace-normal text-center md:w-auto"
              onClick={() =>
                manualSubcontractorId &&
                earlyClockOff.mutate({
                  subcontractorId: manualSubcontractorId,
                  reason: earlyClockOffReason.trim(),
                })
              }
              disabled={!canEarlyClockOff || manualClockOn.isPending || manualClockOff.isPending || earlyClockOff.isPending}
            >
              <AlertTriangle className="mr-2 h-4 w-4" />
              {earlyClockOff.isPending ? "Reassigning..." : "Early Clock-Off & Reassign"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Card><CardContent className="p-6"><Skeleton className="h-64 w-full" /></CardContent></Card>
      ) : !groupedBySub || Object.keys(groupedBySub).length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            No timesheet data for this week.
          </CardContent>
        </Card>
      ) : (
        Object.values(groupedBySub).map((subData: any) => (
          <Card key={subData.name} className="overflow-hidden">
            <CardHeader className="bg-muted/30 py-4">
              <CardTitle className="text-lg flex justify-between items-center">
                {subData.name}
                <span className="text-sm font-normal text-muted-foreground">
                  Total: <strong className="text-foreground">{formatHours(subData.totalWorkMins)}</strong>
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Clock In</TableHead>
                    <TableHead>Clock Out</TableHead>
                    <TableHead>Break</TableHead>
                    <TableHead>Work Hours</TableHead>
                    <TableHead>Metres / Jobs</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subData.entries.map((entry: any) => (
                    <TableRow key={entry.sessionId}>
                      <TableCell className="font-medium">{format(new Date(entry.date), 'EEE, MMM d')}</TableCell>
                      <TableCell>{entry.clockedOnAt ? format(new Date(entry.clockedOnAt), 'HH:mm') : '-'}</TableCell>
                      <TableCell>{entry.clockedOffAt ? format(new Date(entry.clockedOffAt), 'HH:mm') : entry.status === 'active' ? 'Active' : '-'}</TableCell>
                      <TableCell>{entry.totalBreakMinutes}m</TableCell>
                      <TableCell className="font-semibold">{formatHours(entry.totalWorkMinutes)}</TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <span className="font-medium">{entry.totalMetres || 0}m</span>
                          <span className="text-muted-foreground ml-2">({entry.jobsCompleted || 0} jobs)</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Dialog open={editSessionId === entry.sessionId} onOpenChange={(open) => {
                          if (open) {
                            setEditSessionId(entry.sessionId);
                            // Set datetime-local format format: YYYY-MM-DDThh:mm
                            const toDateTimeLocal = (dateStr: string) => {
                               if(!dateStr) return "";
                               const d = new Date(dateStr);
                               // adjust for timezone to keep local visually same in input
                               d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
                               return d.toISOString().slice(0,16);
                            }
                            setEditClockOn(entry.clockedOnAt ? toDateTimeLocal(entry.clockedOnAt) : "");
                            setEditClockOff(entry.clockedOffAt ? toDateTimeLocal(entry.clockedOffAt) : "");
                            setEditBreak(entry.totalBreakMinutes?.toString() || "0");
                          } else {
                            setEditSessionId(null);
                          }
                        }}>
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8"><Edit2 className="h-4 w-4" /></Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Edit Timesheet: {format(new Date(entry.date), 'MMM d')}</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                              <div className="space-y-2">
                                <Label>Clock On Time</Label>
                                <Input type="datetime-local" value={editClockOn} onChange={e => setEditClockOn(e.target.value)} />
                              </div>
                              <div className="space-y-2">
                                <Label>Clock Off Time</Label>
                                <Input type="datetime-local" value={editClockOff} onChange={e => setEditClockOff(e.target.value)} />
                              </div>
                              <div className="space-y-2">
                                <Label>Total Break (minutes)</Label>
                                <Input type="number" value={editBreak} onChange={e => setEditBreak(e.target.value)} min="0" />
                              </div>
                            </div>
                            <DialogFooter>
                              <Button variant="outline" onClick={() => setEditSessionId(null)}>Cancel</Button>
                              <Button onClick={handleSaveEdit} disabled={updateSession.isPending}>Save Changes</Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50 font-medium">
                    <TableCell colSpan={3} className="text-right">Week Totals:</TableCell>
                    <TableCell>{subData.totalBreakMins}m</TableCell>
                    <TableCell>{formatHours(subData.totalWorkMins)}</TableCell>
                    <TableCell>{subData.totalMetres}m ({subData.totalJobs} jobs)</TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
