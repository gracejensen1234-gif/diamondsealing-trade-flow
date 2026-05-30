import { useState, useEffect } from "react";
import { Link } from "wouter";
import { 
  useListSubcontractors, 
  useGetTodaySession, 
  useClockOn, 
  useClockOff, 
  useStartBreak, 
  useEndBreak, 
  useListDispatch, 
  useMarkArrived, 
  useMarkDeparted,
  getGetTodaySessionQueryKey,
  getListDispatchQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, Clock, RotateCcw, AlertTriangle, Play, Square, Pause } from "lucide-react";

export default function FieldView() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [subId, setSubId] = useState<number | undefined>(() => {
    const saved = localStorage.getItem("ds_selected_subcontractor_id");
    return saved ? parseInt(saved) : undefined;
  });

  const [gpsEnabled, setGpsEnabled] = useState(true);
  const [gpsDisabledOnBreak, setGpsDisabledOnBreak] = useState(true);

  useEffect(() => {
    if (subId) {
      localStorage.setItem("ds_selected_subcontractor_id", subId.toString());
    } else {
      localStorage.removeItem("ds_selected_subcontractor_id");
    }
  }, [subId]);

  const { data: subs, isLoading: loadingSubs } = useListSubcontractors();
  
  // Custom fetch for session since the hook might not handle the query param correctly if not defined
  const { data: session, isLoading: loadingSession } = useGetTodaySession(
    { subcontractorId: subId! }, 
    { query: { enabled: !!subId, queryKey: getGetTodaySessionQueryKey({ subcontractorId: subId! }) } }
  );

  const { data: dispatchList, isLoading: loadingDispatch, refetch: refetchDispatch } = useListDispatch(
    { subcontractorId: subId, date: new Date().toISOString().split('T')[0] },
    { query: { enabled: !!subId, queryKey: getListDispatchQueryKey({ subcontractorId: subId, date: new Date().toISOString().split('T')[0] }) } }
  );

  const clockOn = useClockOn({
    mutation: {
      onSuccess: () => {
        toast({ title: "Clocked on — have a great day!" });
        if (subId) queryClient.invalidateQueries({ queryKey: getGetTodaySessionQueryKey({ subcontractorId: subId }) });
      }
    }
  });

  const clockOff = useClockOff({
    mutation: {
      onSuccess: () => {
        toast({ title: "Good work — clocked off" });
        if (subId) queryClient.invalidateQueries({ queryKey: getGetTodaySessionQueryKey({ subcontractorId: subId }) });
      }
    }
  });

  const startBreak = useStartBreak({
    mutation: {
      onSuccess: () => {
        toast({ title: "Break started — GPS paused" });
        if (subId) queryClient.invalidateQueries({ queryKey: getGetTodaySessionQueryKey({ subcontractorId: subId }) });
      }
    }
  });

  const endBreak = useEndBreak({
    mutation: {
      onSuccess: () => {
        toast({ title: "Welcome back!" });
        if (subId) queryClient.invalidateQueries({ queryKey: getGetTodaySessionQueryKey({ subcontractorId: subId }) });
      }
    }
  });

  const markArrived = useMarkArrived({
    mutation: {
      onSuccess: () => {
        toast({ title: "Marked as arrived" });
        if (subId) queryClient.invalidateQueries({ queryKey: getListDispatchQueryKey({ subcontractorId: subId, date: new Date().toISOString().split('T')[0] }) });
      }
    }
  });

  const markDeparted = useMarkDeparted({
    mutation: {
      onSuccess: () => {
        toast({ title: "Marked as departed" });
        if (subId) queryClient.invalidateQueries({ queryKey: getListDispatchQueryKey({ subcontractorId: subId, date: new Date().toISOString().split('T')[0] }) });
      }
    }
  });

  const today = new Date().toISOString().split('T')[0];

  const isClockedOn = session?.status === 'active' || session?.status === 'on_break';
  const isOnBreak = session?.status === 'on_break';

  const handleClockOn = () => {
    if (subId) clockOn.mutate({ data: { subcontractorId: subId, gpsEnabled, gpsDisabledOnBreak } });
  };

  const handleClockOff = () => {
    if (subId) clockOff.mutate({ data: { subcontractorId: subId } });
  };

  const handleStartBreak = () => {
    if (subId) startBreak.mutate({ data: { subcontractorId: subId } });
  };

  const handleEndBreak = () => {
    if (subId) endBreak.mutate({ data: { subcontractorId: subId } });
  };

  return (
    <div className="max-w-md mx-auto space-y-6 pb-20">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Field View</h1>
        <Button variant="ghost" size="icon" onClick={() => refetchDispatch()}>
          <RotateCcw className="h-5 w-5" />
        </Button>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="space-y-2">
            <Label>Who are you?</Label>
            {loadingSubs ? <Skeleton className="h-10 w-full" /> : (
              <Select value={subId?.toString() || ""} onValueChange={(v) => setSubId(parseInt(v))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select subcontractor..." />
                </SelectTrigger>
                <SelectContent>
                  {subs?.map(s => (
                    <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {subId && (
            <div className="space-y-4 pt-4 border-t">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>GPS tracking</Label>
                  <p className="text-xs text-muted-foreground">{gpsEnabled ? 'ON' : 'OFF'}</p>
                </div>
                <Switch checked={gpsEnabled} onCheckedChange={setGpsEnabled} disabled={isClockedOn} />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Auto-pause on break</Label>
                  <p className="text-xs text-muted-foreground">{gpsDisabledOnBreak ? 'YES' : 'NO'}</p>
                </div>
                <Switch checked={gpsDisabledOnBreak} onCheckedChange={setGpsDisabledOnBreak} disabled={isClockedOn} />
              </div>

              {!isClockedOn ? (
                <Button 
                  className="w-full h-16 text-lg" 
                  size="lg" 
                  onClick={handleClockOn}
                  disabled={clockOn.isPending}
                >
                  <Play className="mr-2 h-6 w-6" /> CLOCK ON
                </Button>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {isOnBreak ? (
                    <Button 
                      variant="outline" 
                      className="h-14" 
                      onClick={handleEndBreak}
                      disabled={endBreak.isPending}
                    >
                      <Play className="mr-2 h-5 w-5" /> END BREAK
                    </Button>
                  ) : (
                    <Button 
                      variant="outline" 
                      className="h-14" 
                      onClick={handleStartBreak}
                      disabled={startBreak.isPending}
                    >
                      <Pause className="mr-2 h-5 w-5" /> START BREAK
                    </Button>
                  )}
                  
                  <Button 
                    variant="destructive" 
                    className="h-14" 
                    onClick={handleClockOff}
                    disabled={clockOff.isPending}
                  >
                    <Square className="mr-2 h-5 w-5" /> CLOCK OFF
                  </Button>
                </div>
              )}

              {session && (
                <div className="bg-muted p-3 rounded-md text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status:</span>
                    <span className="font-medium uppercase">{session.status.replace('_', ' ')}</span>
                  </div>
                  {session.clockedOnAt && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Clocked on:</span>
                      <span className="font-medium">{new Date(session.clockedOnAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Break time:</span>
                    <span className="font-medium">{session.totalBreakMinutes || 0} min</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {subId && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">Today's Jobs</h2>
          {loadingDispatch ? (
            <div className="space-y-3">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : dispatchList?.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                <Briefcase className="h-8 w-8 mx-auto mb-2 opacity-20" />
                <p>No jobs assigned for today.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {dispatchList?.map((assignment) => (
                <Card key={assignment.id} className={assignment.status === 'completed' ? 'opacity-70' : ''}>
                  <CardHeader className="p-4 pb-2">
                    <div className="flex justify-between items-start gap-2">
                      <CardTitle className="text-base">{assignment.jobTitle}</CardTitle>
                      <Badge variant={
                        assignment.status === 'completed' ? 'secondary' :
                        assignment.status === 'in_progress' ? 'default' :
                        assignment.status === 'arrived' ? 'default' : 'outline'
                      }>
                        {assignment.status.replace('_', ' ')}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4 pt-0 space-y-2 text-sm">
                    {assignment.jobAddress && (
                      <div className="flex items-start gap-2 text-muted-foreground">
                        <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>{assignment.jobAddress}</span>
                      </div>
                    )}
                    {assignment.builderContactName && (
                      <div className="flex items-start gap-2 text-muted-foreground">
                        <Users className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>{assignment.builderContactName} {assignment.builderContactPhone && `(${assignment.builderContactPhone})`}</span>
                      </div>
                    )}
                    {assignment.requiredColours && assignment.requiredColours.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {assignment.requiredColours.map(c => (
                          <Badge key={c} variant="secondary" className="text-xs bg-muted">{c}</Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                  <CardFooter className="p-4 pt-0 flex gap-2">
                    {assignment.status === 'pending' && (
                      <Button 
                        className="w-full" 
                        onClick={() => markArrived.mutate({ id: assignment.id })}
                        disabled={markArrived.isPending}
                      >
                        Mark Arrived
                      </Button>
                    )}
                    {(assignment.status === 'arrived' || assignment.status === 'in_progress') && (
                      <div className="flex w-full gap-2">
                        {assignment.status === 'arrived' && (
                          <Button 
                            variant="secondary" 
                            className="flex-1"
                            onClick={() => {/* no explicit start job endpoint, perhaps just local status change or assumed when arrived */}}
                          >
                            Start Work
                          </Button>
                        )}
                        <Button 
                          className="flex-1" 
                          onClick={() => markDeparted.mutate({ id: assignment.id })}
                          disabled={markDeparted.isPending}
                        >
                          Mark Departed
                        </Button>
                      </div>
                    )}
                    {assignment.status === 'completed' && (
                      <Button asChild variant="outline" className="w-full">
                        <Link href={`/field/jobs/${assignment.id}`}>Submit Job Report</Link>
                      </Button>
                    )}
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Briefcase(props: any) { return <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg> }
function Users(props: any) { return <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> }