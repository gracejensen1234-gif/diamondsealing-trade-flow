import { useEffect, useState } from "react";
import { useGetAdminLive } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";
import { MapPin, Clock, Briefcase, Activity } from "lucide-react";

export default function AdminLive() {
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [now, setNow] = useState(new Date());
  
  const { data: liveData, isLoading, refetch } = useGetAdminLive();

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
    switch(status) {
      case 'active': return 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-200 dark:border-green-900';
      case 'on_break': return 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-900';
      case 'clocked_off': return 'bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-200 dark:border-slate-800';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getStatusLabel = (status: string) => {
    return status.replace('_', ' ').toUpperCase();
  };

  const sortedData = liveData ? [...liveData].sort((a, b) => {
    const order = { active: 0, on_break: 1, not_started: 2, clocked_off: 3 };
    return order[a.sessionStatus] - order[b.sessionStatus];
  }) : [];

  const activeCount = liveData?.filter(s => s.sessionStatus === 'active').length || 0;

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

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {isLoading ? (
          [1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-48 w-full" />)
        ) : sortedData.length === 0 ? (
          <div className="col-span-full py-12 text-center text-muted-foreground">
            No subcontractors found.
          </div>
        ) : (
          sortedData.map(sub => (
            <Card key={sub.subcontractorId} className="overflow-hidden border-t-4" style={{
              borderTopColor: 
                sub.sessionStatus === 'active' ? 'hsl(var(--primary))' : 
                sub.sessionStatus === 'on_break' ? '#f59e0b' : 
                sub.sessionStatus === 'clocked_off' ? '#64748b' : 'hsl(var(--muted))'
            }}>
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start">
                  <CardTitle className="text-xl">{sub.subcontractorName}</CardTitle>
                  <Badge className={getStatusColor(sub.sessionStatus)} variant="outline">
                    {getStatusLabel(sub.sessionStatus)}
                  </Badge>
                </div>
                {sub.clockedOnAt && (
                  <div className="text-sm text-muted-foreground flex items-center gap-1.5 mt-2">
                    <Clock className="h-3.5 w-3.5" />
                    Clocked on at {new Date(sub.clockedOnAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    <span className="mx-1">•</span>
                    {formatDistanceToNow(new Date(sub.clockedOnAt))}
                  </div>
                )}
              </CardHeader>
              
              <CardContent className="pb-4 space-y-4">
                {(sub.sessionStatus === 'active' || sub.sessionStatus === 'on_break') && sub.currentJobTitle ? (
                  <div className="bg-primary/5 p-3 rounded-md border border-primary/10">
                    <div className="text-xs font-semibold text-primary uppercase tracking-wider mb-1">Current Job</div>
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

                {sub.lastLocation && (
                  <div className="text-xs text-muted-foreground pt-2 flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    Last seen: {formatDistanceToNow(new Date(sub.lastLocation.recordedAt!))} ago
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}