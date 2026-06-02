import { useState } from "react";
import { format } from "date-fns";
import { useListJobReports, useListSubcontractors } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Image as ImageIcon, AlertTriangle, CheckCircle2 } from "lucide-react";

export default function AdminReports() {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [subId, setSubId] = useState<string>("all");
  const [hasIssues, setHasIssues] = useState(false);

  const { data: subs } = useListSubcontractors();
  const { data: reports, isLoading } = useListJobReports({
    date,
    subcontractorId: subId !== "all" ? parseInt(subId) : undefined,
    hasIssues: hasIssues ? true : undefined
  });

  const totalMetres = reports?.reduce((sum, r) => sum + r.metersCompleted, 0) || 0;
  const issuesCount = reports?.filter(r => r.issueType !== 'none').length || 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Job Reports</h1>
        <p className="text-muted-foreground mt-2">Review completed jobs and issues from the field.</p>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-col md:flex-row gap-4 items-end md:items-center">
          <div className="space-y-1.5 flex-1">
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5 flex-1">
            <Label>Subcontractor</Label>
            <Select value={subId} onValueChange={setSubId}>
              <SelectTrigger><SelectValue placeholder="All Subcontractors" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Subcontractors</SelectItem>
                {subs?.map(s => (
                  <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center space-x-2 pb-2 pl-4">
            <Switch id="issues-only" checked={hasIssues} onCheckedChange={setHasIssues} />
            <Label htmlFor="issues-only">With issues only</Label>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-muted-foreground mb-1">Reports Today</div>
            <div className="text-2xl font-bold">{reports?.length || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-muted-foreground mb-1">Total Metres</div>
            <div className="text-2xl font-bold">{totalMetres}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-muted-foreground mb-1">Reported Issues</div>
            <div className="text-2xl font-bold text-destructive">{issuesCount}</div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        {isLoading ? (
          [1,2,3].map(i => <Skeleton key={i} className="h-48 w-full" />)
        ) : reports?.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground border rounded-lg bg-card/50">
            No reports found for these filters.
          </div>
        ) : (
          reports?.map(report => (
            <Card key={report.id} className={report.issueType !== 'none' ? 'border-destructive/50 shadow-sm shadow-destructive/10' : ''}>
              <CardHeader className="p-4 pb-2 flex flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-lg">{report.jobTitle}</CardTitle>
                  <CardDescription className="flex gap-2 mt-1">
                    <span className="font-medium text-foreground">{report.subcontractorName}</span>
                    <span>•</span>
                    <span>{format(new Date(report.createdAt), 'h:mm a')}</span>
                  </CardDescription>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="bg-primary/10 text-primary px-3 py-1 rounded-full font-bold text-lg">
                    {report.metersCompleted}m
                  </div>
                  {report.hoursWorked ? (
                    <div className="text-xs font-medium text-muted-foreground">
                      {report.hoursWorked.toFixed(2)} hrs
                    </div>
                  ) : null}
                </div>
              </CardHeader>
              
              <CardContent className="p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    {report.issueType !== 'none' && (
                      <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm">
                        <div className="font-bold flex items-center gap-2 mb-1">
                          <AlertTriangle className="h-4 w-4" />
                          {report.issueType.replace('_', ' ').toUpperCase()}
                        </div>
                        {report.issueDescription && <p>{report.issueDescription}</p>}
                      </div>
                    )}
                    
                    {report.workDescription && (
                      <div className="text-sm bg-muted p-3 rounded-md">
                        <span className="font-semibold block mb-1">Invoice description:</span>
                        {report.workDescription}
                      </div>
                    )}

                    {report.generalNotes && (
                      <div className="text-sm bg-muted p-3 rounded-md">
                        <span className="font-semibold block mb-1">Notes:</span>
                        {report.generalNotes}
                      </div>
                    )}
                  </div>
                  
                  <div className="space-y-3 text-sm">
                    <div>
                      <span className="font-semibold text-muted-foreground">Silicone Used: </span>
                      {report.silikoneColoursUsed.length > 0 ? (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {report.silikoneColoursUsed.map(c => <Badge key={c} variant="secondary">{c}</Badge>)}
                        </div>
                      ) : "None recorded"}
                    </div>
                    
                    <div>
                      <span className="font-semibold text-muted-foreground">Stock Used: </span>
                      {report.stockUsed && report.stockUsed.length > 0 ? (
                        <ul className="mt-1 space-y-1">
                          {report.stockUsed.map(s => (
                            <li key={s.stockItemId} className="flex justify-between border-b pb-1">
                              <span>{s.stockItemName}</span>
                              <span className="font-medium">{s.quantityUsed} {s.unit}</span>
                            </li>
                          ))}
                        </ul>
                      ) : "None recorded"}
                    </div>
                  </div>
                </div>
                
                <div className="flex justify-end pt-2 border-t">
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm">
                        <ImageIcon className="h-4 w-4 mr-2" /> View Photos ({report.photos.length})
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-3xl">
                      <DialogHeader>
                        <DialogTitle>Photos for {report.jobTitle}</DialogTitle>
                      </DialogHeader>
                      <div className="grid grid-cols-2 gap-4 py-4 max-h-[70vh] overflow-y-auto">
                        {report.photos.map((url, idx) => (
                          <div key={idx} className="aspect-video relative rounded-md overflow-hidden bg-muted">
                            <img src={url} alt={`Job photo ${idx+1}`} className="w-full h-full object-cover" />
                          </div>
                        ))}
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
