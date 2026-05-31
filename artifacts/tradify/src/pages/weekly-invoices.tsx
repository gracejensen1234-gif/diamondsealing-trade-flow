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
import { FileSpreadsheet, Send, Info, Eye } from "lucide-react";

export default function WeeklyInvoices() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  
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
        toast({ title: "Invoice submitted to Xero" });
        queryClient.invalidateQueries();
      }
    }
  });

  const handleGenerate = () => {
    generateInvoices.mutate({
      data: { weekStartDate: format(thisMonday, 'yyyy-MM-dd') }
    });
  };

  const filteredInvoices = invoices?.filter(inv => {
    if (statusFilter === "all") return true;
    return inv.status === statusFilter;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Weekly Invoices</h1>
          <p className="text-muted-foreground mt-2">Manage and sync subcontractor pay to Xero.</p>
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

          <Button onClick={handleGenerate} disabled={generateInvoices.isPending}>
            <FileSpreadsheet className="h-4 w-4 mr-2" /> 
            Generate This Week
          </Button>
        </div>
      </div>

      <div className="bg-orange-50 dark:bg-orange-950/30 text-orange-900 dark:text-orange-300 p-4 rounded-lg flex gap-3 text-sm">
        <Info className="h-5 w-5 shrink-0" />
        <p>Diamond Sealing invoices are automatically generated every Thursday evening, based on completed job reports for the week. You can manually generate them anytime above.</p>
      </div>

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
              </CardContent>
              <CardFooter className="pt-4 border-t gap-3">
                <Button asChild variant="outline" className="flex-1">
                  <Link href={`/weekly-invoices/${inv.id}`}><Eye className="h-4 w-4 mr-2" /> View</Link>
                </Button>
                {inv.status === 'draft' && (
                  <Button 
                    className="flex-1" 
                    onClick={() => submitInvoice.mutate({ id: inv.id })}
                    disabled={submitInvoice.isPending}
                  >
                    <Send className="h-4 w-4 mr-2" /> Xero
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
