import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "wouter";
import { format } from "date-fns";
import {
  useGetWeeklyInvoice,
  useUpdateWeeklyInvoice,
  useSubmitWeeklyInvoice,
  getGetWeeklyInvoiceQueryKey,
} from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { ArrowLeft, Download, Send, CheckCircle2, Save } from "lucide-react";

function formatLineHours(hours?: number | null) {
  return hours && hours > 0 ? `${hours.toFixed(2)} hrs` : null;
}

function lineQuantityLabel(item: {
  payBasis?: string;
  hoursWorked?: number | null;
  metersCompleted: number;
}) {
  if (item.payBasis === "hours")
    return `${(item.hoursWorked ?? 0).toFixed(2)} hrs`;
  return `${item.metersCompleted}m`;
}

function lineRateLabel(item: {
  payBasis?: string;
  hourlyRate?: number | null;
  ratePerMetre: number;
}) {
  if (item.payBasis === "hours")
    return `$${(item.hourlyRate ?? 0).toFixed(2)}/hr`;
  return `$${item.ratePerMetre.toFixed(2)}/m`;
}

export default function WeeklyInvoiceDetail() {
  const { id } = useParams();
  const { toast } = useToast();
  const { user } = useAuth();
  const isWorker = user?.role === "worker";

  const invoiceId = Number(id);
  const {
    data: invoice,
    isLoading,
    refetch,
  } = useGetWeeklyInvoice(invoiceId, {
    query: { queryKey: getGetWeeklyInvoiceQueryKey(invoiceId), enabled: !!id },
  });

  const [notes, setNotes] = useState("");
  const notesInitRef = useRef<number | null>(null);

  useEffect(() => {
    if (invoice && notesInitRef.current !== invoice.id) {
      setNotes(invoice.notes || "");
      notesInitRef.current = invoice.id;
    }
  }, [invoice]);

  const updateInvoice = useUpdateWeeklyInvoice({
    mutation: {
      onSuccess: () => {
        toast({ title: "Notes saved" });
        refetch();
      },
    },
  });

  const submitInvoice = useSubmitWeeklyInvoice({
    mutation: {
      onSuccess: () => {
        toast({ title: "Draft bill created in Xero" });
        refetch();
      },
      onError: (error) => {
        const message =
          error instanceof Error
            ? error.message.replace(/^HTTP 400 Bad Request:\s*/i, "")
            : "Xero is not connected yet. Download the CSV and import it into Xero.";
        toast({
          title: "Xero submission not ready",
          description: message,
          variant: "destructive",
        });
      },
    },
  });

  if (isLoading) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-[500px] w-full" />
      </div>
    );
  }

  if (!invoice) return <div>Not found</div>;

  const totalInvoiceHours =
    invoice.lineItems?.reduce(
      (sum, item) => sum + (item.hoursWorked ?? 0),
      0,
    ) ?? 0;
  const submittedLabel = invoice.xeroInvoiceId
    ? "Submitted to Xero"
    : "Invoice submitted";

  const downloadXeroCsv = () => {
    window.location.assign(`/api/weekly-invoices/${invoice.id}/xero-csv`);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-4">
        <Button asChild variant="ghost" size="icon">
          <Link href="/weekly-invoices">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex-1 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {isWorker
                ? "My Invoice"
                : `Invoice: ${invoice.subcontractorName}`}
            </h1>
            <p className="text-muted-foreground">
              {format(new Date(invoice.weekStartDate), "MMM d")} –{" "}
              {format(new Date(invoice.weekEndDate), "MMM d, yyyy")}
            </p>
          </div>
          <Badge
            variant={
              invoice.status === "paid"
                ? "default"
                : invoice.status === "submitted"
                  ? "secondary"
                  : "outline"
            }
            className="text-sm px-3 py-1"
          >
            {invoice.status.toUpperCase()}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="col-span-1 lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Line Items</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.lineItems?.map((item, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        {item.dispatchDate
                          ? format(new Date(item.dispatchDate), "MMM d")
                          : "-"}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{item.jobTitle}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.jobAddress}
                        </div>
                        {item.jobDescription && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {item.jobDescription}
                          </div>
                        )}
                        {formatLineHours(item.hoursWorked) && (
                          <div className="mt-1 text-xs font-medium text-muted-foreground">
                            Hours: {formatLineHours(item.hoursWorked)}
                          </div>
                        )}
                        {item.hourlyRate != null && item.hourlyRate > 0 ? (
                          <div className="mt-1 text-xs font-medium text-muted-foreground">
                            Hourly rate: ${item.hourlyRate.toFixed(2)}/hr
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        {lineQuantityLabel(item)}
                      </TableCell>
                      <TableCell className="text-right">
                        {lineRateLabel(item)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        ${item.amount.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!invoice.lineItems || invoice.lineItems.length === 0) && (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-center py-8 text-muted-foreground"
                      >
                        No jobs completed this week.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {!isWorker && (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add any adjustments or notes here..."
                  rows={4}
                />
                <div className="flex justify-end mt-4">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      updateInvoice.mutate({ id: invoice.id, data: { notes } })
                    }
                    disabled={
                      updateInvoice.isPending || notes === invoice.notes
                    }
                  >
                    <Save className="h-4 w-4 mr-2" /> Save Notes
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Total Metres</span>
                <span className="font-medium">{invoice.totalMetres}m</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Hours</span>
                <span className="font-medium">
                  {totalInvoiceHours.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>${invoice.subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">GST (10%)</span>
                <span>${invoice.tax.toFixed(2)}</span>
              </div>
              <div className="border-t pt-4 flex justify-between items-center">
                <span className="font-bold">Total</span>
                <span className="text-2xl font-bold text-primary">
                  ${invoice.total.toFixed(2)}
                </span>
              </div>
            </CardContent>
            {!isWorker || invoice.status !== "draft" ? (
              <CardFooter className="flex-col gap-3">
                {!isWorker && (
                  <Button
                    variant="outline"
                    className="w-full h-11"
                    onClick={downloadXeroCsv}
                    disabled={!invoice.lineItems?.length}
                  >
                    <Download className="h-4 w-4 mr-2" /> Download Xero CSV
                  </Button>
                )}
                {!isWorker && invoice.status === "draft" ? (
                  <Button
                    className="w-full h-12 text-lg"
                    onClick={() => submitInvoice.mutate({ id: invoice.id })}
                    disabled={
                      submitInvoice.isPending || !invoice.lineItems?.length
                    }
                  >
                    <Send className="h-5 w-5 mr-2" /> Send to Xero
                  </Button>
                ) : invoice.status !== "draft" ? (
                  <div className="w-full bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400 p-4 rounded-md flex flex-col items-center justify-center text-center space-y-2">
                    <CheckCircle2 className="h-8 w-8" />
                    <div>
                      <div className="font-bold">{submittedLabel}</div>
                      {invoice.xeroInvoiceId && (
                        <div className="text-xs mt-1 opacity-80">
                          ID: {invoice.xeroInvoiceId}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </CardFooter>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}
