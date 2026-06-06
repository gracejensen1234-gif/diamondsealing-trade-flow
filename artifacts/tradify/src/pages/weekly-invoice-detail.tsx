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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/speech-textarea";
import { Switch } from "@/components/ui/switch";
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
import {
  ArrowLeft,
  Download,
  Send,
  CheckCircle2,
  Save,
  MessageSquare,
  RotateCcw,
  Banknote,
} from "lucide-react";

function formatMoney(value?: number | null) {
  const amount = Number(value ?? 0);
  const sign = amount < 0 ? "-" : "";
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

function formatLineHours(hours?: number | null) {
  return hours && hours > 0 ? `${hours.toFixed(2)} hrs` : null;
}

function isAdjustmentLine(item: {
  payBasis?: string;
  adminAdjustment?: boolean;
}) {
  return Boolean(item.adminAdjustment) || item.payBasis === "adjustment";
}

function lineQuantityLabel(item: {
  payBasis?: string;
  hoursWorked?: number | null;
  metersCompleted: number;
  adminAdjustment?: boolean;
}) {
  if (isAdjustmentLine(item)) return "Adjustment";
  if (item.payBasis === "hours")
    return `${(item.hoursWorked ?? 0).toFixed(2)} hrs`;
  return `${item.metersCompleted}m`;
}

function lineRateLabel(item: {
  payBasis?: string;
  hourlyRate?: number | null;
  ratePerMetre: number;
  amount?: number;
  adminAdjustment?: boolean;
}) {
  if (isAdjustmentLine(item)) return formatMoney(item.amount);
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
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [responseNotes, setResponseNotes] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const notesInitRef = useRef<number | null>(null);
  const reviewInitRef = useRef<string | null>(null);
  const paymentInitRef = useRef<number | null>(null);

  useEffect(() => {
    if (invoice && notesInitRef.current !== invoice.id) {
      setNotes(invoice.notes || "");
      notesInitRef.current = invoice.id;
    }
    if (invoice && paymentInitRef.current !== invoice.id) {
      setPaymentNotes(invoice.paymentNotes || "");
      paymentInitRef.current = invoice.id;
    }
    const reviewKey = invoice
      ? `${invoice.id}-${invoice.reviewStatus ?? "none"}-${invoice.reviewRequestedAt ?? ""}`
      : null;
    if (invoice && reviewInitRef.current !== reviewKey) {
      setAdjustmentAmount(
        invoice.reviewAdjustmentAmount != null
          ? String(invoice.reviewAdjustmentAmount)
          : "",
      );
      setAdjustmentReason(invoice.reviewReason || "");
      setResponseNotes(invoice.reviewResponseNotes || "");
      reviewInitRef.current = reviewKey;
    }
  }, [invoice]);

  const updateInvoice = useUpdateWeeklyInvoice({
    mutation: {
      onSuccess: () => {
        toast({ title: "Invoice updated" });
        refetch();
      },
      onError: (error) => {
        const message =
          error instanceof Error
            ? error.message.replace(/^HTTP 400 Bad Request:\s*/i, "")
            : "Could not update invoice.";
        toast({
          title: "Could not update invoice",
          description: message,
          variant: "destructive",
        });
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
    : invoice.status === "paid"
      ? "Payment recorded"
      : "Invoice submitted";
  const invoiceIncludesGst = Boolean(invoice.gstRegistered) || invoice.tax > 0;
  const reviewStatus = invoice.reviewStatus ?? "none";
  const hasPendingReview = reviewStatus === "changes_requested";
  const hasAcceptedReview = reviewStatus === "accepted";
  const parsedAdjustmentAmount = Number(adjustmentAmount);
  const canSendReview =
    invoice.status === "draft" &&
    adjustmentReason.trim().length > 0 &&
    Number.isFinite(parsedAdjustmentAmount) &&
    parsedAdjustmentAmount !== 0;

  const downloadXeroCsv = () => {
    window.location.assign(`/api/weekly-invoices/${invoice.id}/xero-csv`);
  };

  const sendReviewRequest = () => {
    updateInvoice.mutate({
      id: invoice.id,
      data: {
        reviewStatus: "changes_requested",
        reviewReason: adjustmentReason,
        reviewAdjustmentAmount: parsedAdjustmentAmount,
      },
    });
  };

  const acceptReviewRequest = () => {
    updateInvoice.mutate({
      id: invoice.id,
      data: {
        reviewStatus: "accepted",
        reviewResponseNotes: responseNotes,
      },
    });
  };

  const cancelReviewRequest = () => {
    updateInvoice.mutate({
      id: invoice.id,
      data: { reviewStatus: "none" },
    });
  };

  const markInvoicePaid = () => {
    updateInvoice.mutate({
      id: invoice.id,
      data: {
        status: "paid",
        paymentNotes,
      },
    });
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
          <div className="flex flex-col items-end gap-2">
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
            {hasPendingReview ? (
              <Badge variant="destructive" className="text-xs">
                Worker acceptance needed
              </Badge>
            ) : hasAcceptedReview ? (
              <Badge variant="secondary" className="text-xs">
                Edit accepted
              </Badge>
            ) : null}
          </div>
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
                        {isAdjustmentLine(item) ? (
                          <Badge variant="outline" className="mt-1 text-xs">
                            Admin adjustment
                          </Badge>
                        ) : (
                          <div className="text-xs text-muted-foreground">
                            {item.jobAddress}
                          </div>
                        )}
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
                        {formatMoney(item.amount)}
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

          {isWorker && hasPendingReview ? (
            <Card className="border-orange-300 bg-orange-50/80 dark:bg-orange-950/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <MessageSquare className="h-5 w-5" />
                  Invoice edit request
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-md border bg-background p-3 text-sm">
                  <div className="font-medium">Admin reason</div>
                  <p className="mt-1 text-muted-foreground">
                    {invoice.reviewReason}
                  </p>
                </div>
                <div className="flex items-center justify-between rounded-md border bg-background p-3">
                  <span className="text-sm text-muted-foreground">
                    Suggested adjustment
                  </span>
                  <span className="text-lg font-bold">
                    {formatMoney(invoice.reviewAdjustmentAmount)}
                  </span>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Optional response note
                  </label>
                  <Textarea
                    value={responseNotes}
                    onChange={(event) => setResponseNotes(event.target.value)}
                    placeholder="Add a quick note for admin if needed..."
                    rows={3}
                  />
                </div>
                <Button
                  className="w-full"
                  onClick={acceptReviewRequest}
                  disabled={updateInvoice.isPending}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Accept suggested edit
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {isWorker && hasAcceptedReview ? (
            <Card className="border-green-200 bg-green-50/70 dark:bg-green-950/20">
              <CardContent className="pt-6 text-sm">
                <div className="flex items-center gap-2 font-semibold text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-4 w-4" />
                  Suggested invoice edit accepted
                </div>
                {invoice.reviewReason ? (
                  <p className="mt-2 text-muted-foreground">
                    {invoice.reviewReason}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

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

          {!isWorker && invoice.status === "draft" ? (
            <Card>
              <CardHeader>
                <CardTitle>Suggest Invoice Edit</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {hasPendingReview ? (
                  <div className="rounded-md border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900 dark:bg-orange-950/30 dark:text-orange-300">
                    Waiting for the employee/subcontractor to accept this
                    suggested edit.
                  </div>
                ) : hasAcceptedReview ? (
                  <div className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:bg-green-950/30 dark:text-green-300">
                    The employee/subcontractor accepted the suggested edit.
                  </div>
                ) : null}
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Adjustment amount
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={adjustmentAmount}
                    onChange={(event) =>
                      setAdjustmentAmount(event.target.value)
                    }
                    placeholder="-50.00 or 75.00"
                    disabled={hasPendingReview}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use a negative amount for a deduction, or a positive amount
                    to add pay.
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Reason shown to worker
                  </label>
                  <Textarea
                    value={adjustmentReason}
                    onChange={(event) =>
                      setAdjustmentReason(event.target.value)
                    }
                    placeholder="Explain what does not add up and what change is being suggested..."
                    rows={4}
                    disabled={hasPendingReview}
                  />
                </div>
                {invoice.reviewResponseNotes ? (
                  <div className="rounded-md border bg-muted/30 p-3 text-sm">
                    <div className="font-medium">Worker response note</div>
                    <p className="mt-1 text-muted-foreground">
                      {invoice.reviewResponseNotes}
                    </p>
                  </div>
                ) : null}
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  {hasPendingReview || hasAcceptedReview ? (
                    <Button
                      variant="outline"
                      onClick={cancelReviewRequest}
                      disabled={updateInvoice.isPending}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Clear suggestion
                    </Button>
                  ) : null}
                  <Button
                    onClick={sendReviewRequest}
                    disabled={
                      updateInvoice.isPending ||
                      hasPendingReview ||
                      !canSendReview
                    }
                  >
                    <MessageSquare className="mr-2 h-4 w-4" />
                    Send suggestion to worker
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isWorker && invoice.status === "draft" ? (
                <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">Charge GST</div>
                    <div className="text-xs text-muted-foreground">
                      Turn on only if this employee/subcontractor is GST
                      registered.
                    </div>
                  </div>
                  <Switch
                    checked={invoiceIncludesGst}
                    onCheckedChange={(checked) =>
                      updateInvoice.mutate({
                        id: invoice.id,
                        data: { gstRegistered: checked },
                      })
                    }
                    disabled={updateInvoice.isPending}
                  />
                </div>
              ) : null}
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
              {hasPendingReview ? (
                <div className="flex justify-between items-center text-sm rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-orange-900 dark:bg-orange-950/30 dark:text-orange-300">
                  <span>Pending adjustment</span>
                  <span>{formatMoney(invoice.reviewAdjustmentAmount)}</span>
                </div>
              ) : null}
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">GST status</span>
                <span>
                  {invoiceIncludesGst ? "GST registered" : "No GST charged"}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">
                  {invoiceIncludesGst ? "GST (10%)" : "GST"}
                </span>
                <span>${invoice.tax.toFixed(2)}</span>
              </div>
              <div className="border-t pt-4 flex justify-between items-center">
                <span className="font-bold">Total</span>
                <span className="text-2xl font-bold text-primary">
                  ${invoice.total.toFixed(2)}
                </span>
              </div>
              {invoice.workerAcknowledgedAt ? (
                <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300">
                  <div className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="h-4 w-4" />
                    Worker acknowledged invoice
                  </div>
                  <p className="mt-1">
                    {format(
                      new Date(invoice.workerAcknowledgedAt),
                      "MMM d, yyyy h:mm a",
                    )}
                  </p>
                  {invoice.workerAcknowledgementText ? (
                    <p className="mt-1 text-green-700/80 dark:text-green-300/80">
                      {invoice.workerAcknowledgementText}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {invoice.status === "paid" ? (
                <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300">
                  <div className="flex items-center gap-2 font-semibold">
                    <Banknote className="h-4 w-4" />
                    Payment marked as paid
                  </div>
                  {invoice.paidAt ? (
                    <p className="mt-1">
                      {format(new Date(invoice.paidAt), "MMM d, yyyy h:mm a")}
                    </p>
                  ) : null}
                  {invoice.paymentNotes ? (
                    <p className="mt-1 text-green-700/80 dark:text-green-300/80">
                      {invoice.paymentNotes}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
            {!isWorker || invoice.status !== "draft" ? (
              <CardFooter className="flex-col gap-3">
                {!isWorker && invoice.status !== "paid" ? (
                  <div className="w-full space-y-3 rounded-md border bg-muted/20 p-3">
                    <div>
                      <div className="text-sm font-medium">
                        Manual payment
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Use this when Xero is not connected and the invoice has
                        been paid outside SealFlow.
                      </div>
                    </div>
                    <Textarea
                      value={paymentNotes}
                      onChange={(event) =>
                        setPaymentNotes(event.target.value)
                      }
                      placeholder="Optional note, e.g. Paid by bank transfer..."
                      rows={3}
                    />
                    <Button
                      variant="secondary"
                      className="w-full h-11"
                      onClick={markInvoicePaid}
                      disabled={
                        updateInvoice.isPending ||
                        !invoice.lineItems?.length ||
                        hasPendingReview
                      }
                    >
                      <Banknote className="h-4 w-4 mr-2" />
                      Mark as paid
                    </Button>
                  </div>
                ) : null}
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
                      submitInvoice.isPending ||
                      !invoice.lineItems?.length ||
                      hasPendingReview
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
