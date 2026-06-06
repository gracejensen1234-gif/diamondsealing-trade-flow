import { useState, type FormEvent } from "react";
import { getListInvoicesQueryKey, useCreateInvoice, useListCustomers, useListInvoices } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/speech-textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, Receipt } from "lucide-react";

const emptyInvoiceForm = {
  clientId: "none",
  title: "",
  dueDate: "",
  description: "",
  quantity: "1",
  unitPrice: "0",
  taxRate: "10",
  notes: "",
};

export default function Invoices() {
  const { data: invoices, isLoading } = useListInvoices();
  const { data: clients } = useListCustomers();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyInvoiceForm);

  const createInvoice = useCreateInvoice({
    mutation: {
      onSuccess: (invoice) => {
        queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        setForm(emptyInvoiceForm);
        setDialogOpen(false);
        toast({ title: "Invoice created", description: `${invoice.invoiceNumber} is ready to review.` });
        setLocation(`/invoices/${invoice.id}`);
      },
      onError: () => {
        toast({
          title: "Invoice not created",
          description: "Please check the details and try again.",
          variant: "destructive",
        });
      },
    },
  });

  const updateForm = (field: keyof typeof emptyInvoiceForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleCreateInvoice = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const quantity = Number(form.quantity);
    const unitPrice = Number(form.unitPrice);
    const taxRate = Number(form.taxRate);

    if (!form.description.trim() || quantity <= 0 || unitPrice < 0 || taxRate < 0) {
      toast({
        title: "Check invoice details",
        description: "Add a line item description, quantity, price, and tax rate.",
        variant: "destructive",
      });
      return;
    }

    createInvoice.mutate({
      data: {
        customerId: form.clientId !== "none" ? Number(form.clientId) : undefined,
        title: form.title.trim() || form.description.trim(),
        dueDate: form.dueDate || undefined,
        notes: form.notes.trim() || undefined,
        taxRate,
        lineItems: [
          {
            description: form.description.trim(),
            quantity,
            unitPrice,
          },
        ],
      },
    });
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Invoices</h1>
          <p className="text-muted-foreground mt-2">Manage billing and payments.</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> New Invoice
        </Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New Invoice</DialogTitle>
          </DialogHeader>
          <form className="space-y-5" onSubmit={handleCreateInvoice}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="invoice-title">Invoice title</Label>
                <Input
                  id="invoice-title"
                  value={form.title}
                  onChange={(event) => updateForm("title", event.target.value)}
                  placeholder="Residential silicone sealing"
                />
              </div>
              <div className="space-y-2">
                <Label>Client</Label>
                <Select value={form.clientId} onValueChange={(value) => updateForm("clientId", value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select client" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No client selected</SelectItem>
                    {(clients ?? []).map((client) => (
                      <SelectItem key={client.id} value={String(client.id)}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_120px_140px]">
              <div className="space-y-2">
                <Label htmlFor="invoice-description">Line item</Label>
                <Input
                  id="invoice-description"
                  value={form.description}
                  onChange={(event) => updateForm("description", event.target.value)}
                  placeholder="Supply and install sealant"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invoice-quantity">Qty</Label>
                <Input
                  id="invoice-quantity"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.quantity}
                  onChange={(event) => updateForm("quantity", event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invoice-price">Unit price</Label>
                <Input
                  id="invoice-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.unitPrice}
                  onChange={(event) => updateForm("unitPrice", event.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="invoice-due-date">Due date</Label>
                <Input
                  id="invoice-due-date"
                  type="date"
                  value={form.dueDate}
                  onChange={(event) => updateForm("dueDate", event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invoice-tax-rate">Tax rate (%)</Label>
                <Input
                  id="invoice-tax-rate"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.taxRate}
                  onChange={(event) => updateForm("taxRate", event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="invoice-notes">Notes</Label>
              <Textarea
                id="invoice-notes"
                value={form.notes}
                onChange={(event) => updateForm("notes", event.target.value)}
                placeholder="Payment notes, scope notes, access details..."
              />
            </div>

            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createInvoice.isPending}>
                {createInvoice.isPending ? "Creating..." : "Create Invoice"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <div className="grid gap-4">
        {isLoading ? (
          [1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)
        ) : invoices?.map(invoice => (
          <Link key={invoice.id} href={`/invoices/${invoice.id}`}>
            <Card className="hover:border-primary transition-colors cursor-pointer">
              <CardContent className="p-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-primary/10 text-primary rounded-full">
                    <Receipt className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{invoice.invoiceNumber} - {invoice.customerName || "No client"}</h3>
                    <p className="text-sm text-muted-foreground">Due: {invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : 'N/A'}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4 sm:gap-8">
                  <div className="sm:text-right">
                    <p className="font-bold text-lg">${invoice.total.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">Total</p>
                  </div>
                  <Badge variant={invoice.status === "paid" ? "default" : invoice.status === "overdue" ? "destructive" : "secondary"}>
                    {invoice.status.toUpperCase()}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        {!isLoading && invoices?.length === 0 && (
           <div className="text-center py-12 text-muted-foreground border rounded-lg border-dashed">
             No invoices found.
           </div>
        )}
      </div>
    </div>
  );
}
