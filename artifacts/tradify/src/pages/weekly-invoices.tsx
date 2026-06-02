import { useState } from "react";
import { Link } from "wouter";
import { format, subDays, startOfWeek } from "date-fns";
import { useListWeeklyInvoices, useGenerateWeeklyInvoices, useSubmitWeeklyInvoice } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { Download, FileSpreadsheet, Send, Info, Eye } from "lucide-react";

export default function WeeklyInvoices() {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const isWorker = user?.role === "worker";
  
  // Get this week's Monday
  const thisMonday = startOfWeek(new Date(), { weekStartsOn: 1 });
  
  const { data: invoices, isLoading } = useListWeeklyInvoices({
    // Optional filters could go here if api supported status natively, we filter client side for now
  });

  const generateInvoices = useGenerateWeeklyInvoices({
    mutation: {
      onSuccess: () => {
        toast({ title: "Invoices generated successfully" });
        queryClient.invalidateQueries();
      }
    }
  });

  const submitInvoice = useSubmitWeeklyInvoice({
    mutation: {
      onSuccess: () => {
        toast({ title: "Draft bill created in Xero" });
        queryClient.invalidateQueries();
      },
      onError: (error) => {
        const message = error instanceof Error
          ? error.message.replace(/^HTTP 400 Bad Request:\s*/i, "")
          : "Xero is not connected yet. Download the CSV and import it into Xero.";
        toast({ title: "Xero submission not ready", description: message, variant: "destructive" });
      },
    }
  });

  const handleGenerate = () => {
    generateInvoices.mutate({
      data: { weekStartDate: format(thisMonday, 'yyyy-MM-dd') }
    });
  };

  const downloadXeroCsv = (invoiceId: number) => {
    window.location.assign(`/api/weekly-invoices/${invoiceId}/xero-csv`);
  };

  const filteredInvoices = invoices?.filter(inv => {
    if (statusFilter === "all") return true;
    return inv.status === statusFilter;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{isWorker ? "My Invoices" : "Weekly Invoices"}</h1>
          <p className="text-muted-foreground mt-2">
            {isWorker ? "View your submitted job reports and weekly invoice totals." : "Manage and sync subcontractor pay to Xero."}
          </p>
        </div>
        
        <div className="flex items-center gap-4">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
            </SelectContent>
          </Select>

          {!isWorker && (
            <Button onClick={handleGenerate} disabled={generateInvoices.isPending}>
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Generate This Week
            </Button>
          )}
        </div>
      </div>

      {!isWorker && (
        <div className="bg-orange-50 dark:bg-orange-950/30 text-orange-900 dark:text-orange-300 p-4 rounded-lg flex gap-3 text-sm">
        <Info className="h-5 w-5 shrink-0" />
        <p>Invoices are generated from completed job reports. If the direct Xero API connection is not ready, download the Xero CSV and import it as a draft bill in Xero.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {isLoading ? (
          [1,2,3].map(i => <Skeleton key={i} className="h-64 w-full" />)
        ) : filteredInvoices?.length === 0 ? (
          <div className="col-span-full py-12 text-center text-muted-foreground border rounded-lg border-dashed">
            No invoices found.
          </div>
        ) : (
          filteredInvoices?.map(inv => (
            <Card key={inv.id} className="flex flex-col">
              <CardHeader className="pb-4 border-b">
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-lg">{inv.subcontractorName}</CardTitle>
                    <CardDescription className="mt-1">
                      {format(new Date(inv.weekStartDate), 'MMM d')} – {format(new Date(inv.weekEndDate), 'MMM d, yyyy')}
                    </CardDescription>
                  </div>
                  <Badge variant={
                    inv.status === 'paid' ? 'default' :
                    inv.status === 'submitted' ? 'secondary' : 'outline'
                  }>
                    {inv.status.toUpperCase()}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="py-6 flex-1 flex flex-col justify-center items-center text-center space-y-2">
                <div className="text-sm text-muted-foreground uppercase tracking-wider font-semibold">Total Amount</div>
                <div className="text-4xl font-bold text-primary">${inv.total.toFixed(2)}</div>
                <div className="text-sm text-muted-foreground mt-2 bg-muted px-3 py-1 rounded-full">
                  {inv.totalMetres}m Completed
                </div>
                {inv.lineItems?.some((item) => (item.hoursWorked ?? 0) > 0) ? (
                  <div className="text-sm text-muted-foreground bg-muted px-3 py-1 rounded-full">
                    {inv.lineItems.reduce((sum, item) => sum + (item.hoursWorked ?? 0), 0).toFixed(2)} hrs recorded
                  </div>
                ) : null}
              </CardContent>
              <CardFooter className="pt-4 border-t gap-2 flex-wrap">
                <Button asChild variant="outline" className="flex-1">
                  <Link href={`/weekly-invoices/${inv.id}`}><Eye className="h-4 w-4 mr-2" /> View</Link>
                </Button>
                {!isWorker && (
                  <Button variant="outline" className="flex-1" onClick={() => downloadXeroCsv(inv.id)}>
                    <Download className="h-4 w-4 mr-2" /> CSV
                  </Button>
                )}
                {!isWorker && inv.status === 'draft' && (
                  <Button
                    className="flex-1"
                    onClick={() => submitInvoice.mutate({ id: inv.id })}
                    disabled={submitInvoice.isPending}
                  >
                    <Send className="h-4 w-4 mr-2" /> Send
                  </Button>
                )}
              </CardFooter>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
