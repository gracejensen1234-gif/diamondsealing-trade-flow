import { useListJobs } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";

export default function Jobs() {
  const { data: jobs, isLoading } = useListJobs();

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Jobs</h1>
          <p className="text-muted-foreground mt-2">Manage your active and completed jobs.</p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> New Job
        </Button>
      </div>

      <div className="grid gap-4">
        {isLoading ? (
          [1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)
        ) : jobs?.map(job => (
          <Link key={job.id} href={`/jobs/${job.id}`}>
            <Card className="hover:border-primary transition-colors cursor-pointer">
              <CardContent className="p-6 flex justify-between items-center">
                <div>
                  <h3 className="font-semibold text-lg">{job.title}</h3>
                  <p className="text-muted-foreground text-sm mt-1">{job.customerName} &bull; {job.address}</p>
                </div>
                <div className="flex items-center gap-4">
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
