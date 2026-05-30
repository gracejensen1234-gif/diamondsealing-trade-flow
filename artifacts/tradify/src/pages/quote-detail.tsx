import { useGetQuote, getGetQuoteQueryKey, useSendQuote, useAcceptQuote, useDeclineQuote, useConvertQuoteToInvoice } from "@workspace/api-client-react";
import { useRoute, Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Send, CheckCircle, XCircle, FilePlus2 } from "lucide-react";

export default function QuoteDetail() {
  const [, params] = useRoute("/quotes/:id");
  const id = Number(params?.id);
  const { data: quote, isLoading } = useGetQuote(id, { query: { enabled: !!id, queryKey: getGetQuoteQueryKey(id) } });
  
  const sendQuote = useSendQuote();
  const acceptQuote = useAcceptQuote();
  const declineQuote = useDeclineQuote();
  const convertToInvoice = useConvertQuoteToInvoice();
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleAction = (action: any, successMessage: string) => {
    action.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Success", description: successMessage });
        queryClient.invalidateQueries({ queryKey: getGetQuoteQueryKey(id) });
      },
      onError: () => {
        toast({ title: "Error", description: "Action failed.", variant: "destructive" });
      }
    });
  };

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (!quote) return <div>Quote not found</div>;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-bold tracking-tight">Quote {quote.quoteNumber}</h1>
            <Badge variant="outline" className="text-sm px-3 py-1">{quote.status.toUpperCase()}</Badge>
          </div>
          <p className="text-xl text-muted-foreground mt-2">{quote.title}</p>
        </div>
        <div className="flex items-center gap-2">
          {quote.status === 'draft' && (
            <Button onClick={() => handleAction(sendQuote, "Quote marked as sent")} disabled={sendQuote.isPending}>
              <Send className="mr-2 h-4 w-4" /> Send
            </Button>
          )}
          {quote.status === 'sent' && (
            <>
              <Button variant="outline" onClick={() => handleAction(acceptQuote, "Quote accepted")} disabled={acceptQuote.isPending} className="text-green-600 border-green-200 hover:bg-green-50">
                <CheckCircle className="mr-2 h-4 w-4" /> Accept
              </Button>
              <Button variant="outline" onClick={() => handleAction(declineQuote, "Quote declined")} disabled={declineQuote.isPending} className="text-red-600 border-red-200 hover:bg-red-50">
                <XCircle className="mr-2 h-4 w-4" /> Decline
              </Button>
            </>
          )}
          {quote.status === 'accepted' && (
            <Button onClick={() => handleAction(convertToInvoice, "Converted to invoice")} disabled={convertToInvoice.isPending}>
              <FilePlus2 className="mr-2 h-4 w-4" /> Convert to Invoice
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
         <Card>
           <CardHeader><CardTitle className="text-sm text-muted-foreground">To</CardTitle></CardHeader>
           <CardContent>
             {quote.customerId ? (
               <Link href={`/customers/${quote.customerId}`} className="font-semibold text-primary hover:underline">
                 {quote.customerName}
               </Link>
             ) : (
               <span className="font-semibold">{quote.customerName}</span>
             )}
           </CardContent>
         </Card>
         <Card>
           <CardHeader><CardTitle className="text-sm text-muted-foreground">Details</CardTitle></CardHeader>
           <CardContent className="space-y-1 text-sm">
             <div className="flex justify-between"><span>Created:</span> <span>{new Date(quote.createdAt).toLocaleDateString()}</span></div>
             {quote.validUntil && <div className="flex justify-between"><span>Valid Until:</span> <span>{new Date(quote.validUntil).toLocaleDateString()}</span></div>}
           </CardContent>
         </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Line Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quote.lineItems?.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.description}</TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right">${item.unitPrice.toFixed(2)}</TableCell>
                  <TableCell className="text-right font-medium">${item.total.toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          
          <div className="flex justify-end mt-8">
            <div className="w-64 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>${quote.subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax ({(quote.taxRate || 0) * 100}%)</span>
                <span>${quote.tax.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-lg pt-3 border-t">
                <span>Total</span>
                <span>${quote.total.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {quote.notes && (
        <Card>
          <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{quote.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
