import { useEffect, useState } from "react";
import { useGetAdminLive } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";
import { MapPin, Clock, Activity, Navigation, AlertTriangle, CheckCircle2, XCircle, SkipForward } from "lucide-react";

const EVENT_LABELS: Record<string, string> = {
  clock_on: "Clock On",
  clock_off: "Clock Off",
  job_arrived: "Arrived",
  job_departed: "Departed",
};

const STATUS_CFG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  verified: { label: "Verified", icon: <CheckCircle2 className="h-3.5 w-3.5" />, color: "text-green-600" },
  outside_range: { label: "Outside range", icon: <AlertTriangle className="h-3.5 w-3.5" />, color: "text-red-600" },
  skipped: { label: "Skipped", icon: <SkipForward className="h-3.5 w-3.5" />, color: "text-amber-600" },
  location_error: { label: "Error", icon: <XCircle className="h-3.5 w-3.5" />, color: "text-red-500" },
  geocode_failed: { label: "Address unresolved", icon: <AlertTriangle className="h-3.5 w-3.5" />, color: "text-amber-600" },
  captured: { label: "Captured", icon: <Navigation className="h-3.5 w-3.5" />, color: "text-orange-600" },
  no_job_address: { label: "No address", icon: <Navigation className="h-3.5 w-3.5" />, color: "text-slate-500" },
};

export default function AdminLive() {
  const qc = useQueryClient();
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [now, setNow] = useState(new Date());
  const today = new Date().toISOString().split("T")[0];

  const { data: liveData, isLoading, refetch } = useGetAdminLive();

  const { data: locationFlags = [] } = useQuery<any[]>({
    queryKey: ["location-flags", today],
    queryFn: () =>
      fetch(`/api/location-verifications?flagsOnly=true&date=${today}`)
        .then((r) => r.json()),
    refetchInterval: 30000,
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, notes }: { id: number; notes?: string }) =>
      fetch(`/api/location-verifications/${id}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminNotes: notes }),
      }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["location-flags", today] }),
  });

  // Auto refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      refetch().then(() => setLastRefreshed(new Date()));
    }, 30000);
    return () => clearInterval(interval);
  }, [refetch]);

  // Update timer every second
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return "bg-green-500/10 text-green-700 dark:text-green-400 border-green-200 dark:border-green-900";
      case "on_break": return "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-900";
      case "clocked_off": return "bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-200 dark:border-slate-800";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const sortedData = liveData
    ? [...liveData].sort((a, b) => {
        const order: Record<string, number> = { active: 0, on_break: 1, not_started: 2, clocked_off: 3 };
        return (order[a.sessionStatus] ?? 4) - (order[b.sessionStatus] ?? 4);
      })
    : [];

  const activeCount = liveData?.filter((s) => s.sessionStatus === "active").length || 0;
  const unreviewedFlags = (locationFlags as any[]).filter((f) => !f.adminReviewed);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Live Operations</h1>
          <p className="text-muted-foreground mt-2">Real-time status of all field subcontractors.</p>
        </div>
        <div className="flex items-center gap-3 bg-muted px-4 py-2 rounded-full text-sm">
          <Activity className="h-4 w-4 text-green-500 animate-pulse" />
          <span className="font-medium">{activeCount} Active Now</span>
          <span className="text-muted-foreground border-l pl-3 ml-1">
            Updated {Math.floor((now.getTime() - lastRefreshed.getTime()) / 1000)}s ago
          </span>
        </div>
      </div>

      {/* Location verification review flags */}
      {unreviewedFlags.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Navigation className="h-4 w-4 text-amber-500" />
            <h2 className="font-semibold text-sm">Location Review Flags — Today</h2>
            <Badge variant="destructive" className="text-xs">{unreviewedFlags.length} unreviewed</Badge>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {unreviewedFlags.map((flag: any) => {
              const cfg = STATUS_CFG[flag.status] ?? STATUS_CFG.captured;
              return (
                <Card key={flag.id} className="border-l-4 border-l-amber-400">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{flag.subcontractorName ?? `Sub #${flag.subcontractorId}`}</span>
                          <Badge variant="outline" className="text-xs">{EVENT_LABELS[flag.eventType] ?? flag.eventType}</Badge>
                          <span className={`flex items-center gap-1 text-xs font-medium ${cfg.color}`}>
                            {cfg.icon} {cfg.label}
                          </span>
                        </div>
                        {flag.distanceMetres != null && (
                          <p className="text-xs text-muted-foreground mt-1">
                            <MapPin className="h-3 w-3 inline mr-0.5" />
                            {flag.distanceMetres}m from job address
                            {flag.allowedDistanceMetres && ` (allowed: ${flag.allowedDistanceMetres}m)`}
                          </p>
                        )}
                        {flag.jobAddress && (
                          <p className="text-xs text-muted-foreground truncate">{flag.jobAddress}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(flag.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs flex-shrink-0"
                        onClick={() => reviewMutation.mutate({ id: flag.id })}
                        disabled={reviewMutation.isPending}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Reviewed
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Subcontractor status grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {isLoading ? (
          [1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-48 w-full" />)
        ) : sortedData.length === 0 ? (
          <div className="col-span-full py-12 text-center text-muted-foreground">
            No subcontractors found.
          </div>
        ) : (
          sortedData.map((sub) => (
            <Card
              key={sub.subcontractorId}
              className="overflow-hidden border-t-4"
              style={{
                borderTopColor:
                  sub.sessionStatus === "active"
                    ? "hsl(var(--primary))"
                    : sub.sessionStatus === "on_break"
                    ? "#f59e0b"
                    : sub.sessionStatus === "clocked_off"
                    ? "#64748b"
                    : "hsl(var(--muted))",
              }}
            >
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start">
                  <CardTitle className="text-xl">{sub.subcontractorName}</CardTitle>
                  <Badge className={getStatusColor(sub.sessionStatus)} variant="outline">
                    {sub.sessionStatus.replace("_", " ").toUpperCase()}
                  </Badge>
                </div>
                {sub.clockedOnAt && (
                  <div className="text-sm text-muted-foreground flex items-center gap-1.5 mt-2">
                    <Clock className="h-3.5 w-3.5" />
                    Clocked on at{" "}
                    {new Date(sub.clockedOnAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    <span className="mx-1">•</span>
                    {formatDistanceToNow(new Date(sub.clockedOnAt))}
                  </div>
                )}
              </CardHeader>

              <CardContent className="pb-4 space-y-4">
                {(sub.sessionStatus === "active" || sub.sessionStatus === "on_break") &&
                sub.currentJobTitle ? (
                  <div className="bg-primary/5 p-3 rounded-md border border-primary/10">
                    <div className="text-xs font-semibold text-primary uppercase tracking-wider mb-1">
                      Current Job
                    </div>
                    <div className="font-medium text-sm">{sub.currentJobTitle}</div>
                    {sub.currentJobAddress && (
                      <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="truncate">{sub.currentJobAddress}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-muted/50 p-3 rounded-md text-sm text-muted-foreground text-center">
                    No active job
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                  <div>
                    <div className="text-xs text-muted-foreground">Jobs Completed</div>
                    <div className="font-bold text-lg">{sub.jobsCompleted || 0}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Metres Today</div>
                    <div className="font-bold text-lg">{sub.totalMetresToday || 0}m</div>
                  </div>
                </div>

                {/* Today's location verification summary for this employee/subcontractor */}
                {(() => {
                  const workerFlags = (locationFlags as any[]).filter(
                    (f) => f.subcontractorId === sub.subcontractorId
                  );
                  if (!workerFlags.length) return null;
                  const hasOutside = workerFlags.some((f) => f.status === "outside_range");
                  return (
                    <div className={`flex items-center gap-1.5 text-xs pt-2 border-t ${hasOutside ? "text-red-600" : "text-amber-600"}`}>
                      <Navigation className="h-3 w-3" />
                      <span>
                        {workerFlags.length} location flag{workerFlags.length !== 1 ? "s" : ""} today
                        {hasOutside && " — outside range"}
                      </span>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
