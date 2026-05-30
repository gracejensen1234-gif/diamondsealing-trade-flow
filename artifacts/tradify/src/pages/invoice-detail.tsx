import { useGetInvoice, getGetInvoiceQueryKey, useSendInvoice, usePayInvoice } from "@workspace/api-client-react";
import { useRoute, Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Send, DollarSign } from "lucide-react";

export default function InvoiceDetail() {
  const [, params] = useRoute("/invoices/:id");
  const id = Number(params?.id);
  const { data: invoice, isLoading } = useGetInvoice(id, { query: { enabled: !!id, queryKey: getGetInvoiceQueryKey(id) } });
  
  const sendInvoice = useSendInvoice();
  const payInvoice = usePayInvoice();
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleAction = (action: any, successMessage: string) => {
    action.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Success", description: successMessage });
        queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id) });
      },
      onError: () => {
        toast({ title: "Error", description: "Action failed.", variant: "destructive" });
      }
    });
  };

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (!invoice) return <div>Invoice not found</div>;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-bold tracking-tight">Invoice {invoice.invoiceNumber}</h1>
            <Badge variant="outline" className="text-sm px-3 py-1">{invoice.status.toUpperCase()}</Badge>
          </div>
          <p className="text-xl text-muted-foreground mt-2">{invoice.title}</p>
        </div>
        <div className="flex items-center gap-2">
          {invoice.status === 'draft' && (
            <Button onClick={() => handleAction(sendInvoice, "Invoice marked as sent")} disabled={sendInvoice.isPending}>
              <Send className="mr-2 h-4 w-4" /> Send
            </Button>
          )}
          {invoice.status === 'sent' && (
            <Button onClick={() => handleAction(payInvoice, "Invoice marked as paid")} disabled={payInvoice.isPending} className="bg-green-600 hover:bg-green-700 text-white">
              <DollarSign className="mr-2 h-4 w-4" /> Mark Paid
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
         <Card>
           <CardHeader><CardTitle className="text-sm text-muted-foreground">Bill To</CardTitle></CardHeader>
           <CardContent>
             {invoice.customerId ? (
               <Link href={`/customers/${invoice.customerId}`} className="font-semibold text-primary hover:underline">
                 {invoice.customerName}
               </Link>
             ) : (
               <span className="font-semibold">{invoice.customerName}</span>
             )}
           </CardContent>
         </Card>
         <Card>
           <CardHeader><CardTitle className="text-sm text-muted-foreground">Details</CardTitle></CardHeader>
           <CardContent className="space-y-1 text-sm">
             <div className="flex justify-between"><span>Created:</span> <span>{new Date(invoice.createdAt).toLocaleDateString()}</span></div>
             {invoice.dueDate && <div className="flex justify-between"><span>Due Date:</span> <span>{new Date(invoice.dueDate).toLocaleDateString()}</span></div>}
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
              {invoice.lineItems?.map((item) => (
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
                <span>${invoice.subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax ({(invoice.taxRate || 0) * 100}%)</span>
                <span>${invoice.tax.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-lg pt-3 border-t">
                <span>Total</span>
                <span>${invoice.total.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {invoice.notes && (
        <Card>
          <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{invoice.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
