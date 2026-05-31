import { useState, type FormEvent } from "react";
import { getListQuotesQueryKey, useCreateQuote, useListCustomers, useListQuotes } from "@workspace/api-client-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, FileText } from "lucide-react";

const emptyQuoteForm = {
  clientId: "none",
  title: "",
  validUntil: "",
  description: "",
  quantity: "1",
  unitPrice: "0",
  taxRate: "10",
  notes: "",
};

export default function Quotes() {
  const { data: quotes, isLoading } = useListQuotes();
  const { data: clients } = useListCustomers();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyQuoteForm);

  const createQuote = useCreateQuote({
    mutation: {
      onSuccess: (quote) => {
        queryClient.invalidateQueries({ queryKey: getListQuotesQueryKey() });
        setForm(emptyQuoteForm);
        setDialogOpen(false);
        toast({ title: "Quote created", description: `${quote.quoteNumber} is ready to review.` });
        setLocation(`/quotes/${quote.id}`);
      },
      onError: () => {
        toast({
          title: "Quote not created",
          description: "Please check the details and try again.",
          variant: "destructive",
        });
      },
    },
  });

  const updateForm = (field: keyof typeof emptyQuoteForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleCreateQuote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const quantity = Number(form.quantity);
    const unitPrice = Number(form.unitPrice);
    const taxRate = Number(form.taxRate);

    if (!form.description.trim() || quantity <= 0 || unitPrice < 0 || taxRate < 0) {
      toast({
        title: "Check quote details",
        description: "Add a line item description, quantity, price, and tax rate.",
        variant: "destructive",
      });
      return;
    }

    createQuote.mutate({
      data: {
        customerId: form.clientId !== "none" ? Number(form.clientId) : undefined,
        title: form.title.trim() || form.description.trim(),
        validUntil: form.validUntil || undefined,
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
          <h1 className="text-3xl font-bold tracking-tight">Quotes</h1>
          <p className="text-muted-foreground mt-2">Manage estimates and proposals.</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> New Quote
        </Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New Quote</DialogTitle>
          </DialogHeader>
          <form className="space-y-5" onSubmit={handleCreateQuote}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="quote-title">Quote title</Label>
                <Input
                  id="quote-title"
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
                <Label htmlFor="quote-description">Line item</Label>
                <Input
                  id="quote-description"
                  value={form.description}
                  onChange={(event) => updateForm("description", event.target.value)}
                  placeholder="Supply and install sealant"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quote-quantity">Qty</Label>
                <Input
                  id="quote-quantity"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.quantity}
                  onChange={(event) => updateForm("quantity", event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quote-price">Unit price</Label>
                <Input
                  id="quote-price"
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
                <Label htmlFor="quote-valid-until">Valid until</Label>
                <Input
                  id="quote-valid-until"
                  type="date"
                  value={form.validUntil}
                  onChange={(event) => updateForm("validUntil", event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quote-tax-rate">Tax rate (%)</Label>
                <Input
                  id="quote-tax-rate"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.taxRate}
                  onChange={(event) => updateForm("taxRate", event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="quote-notes">Notes</Label>
              <Textarea
                id="quote-notes"
                value={form.notes}
                onChange={(event) => updateForm("notes", event.target.value)}
                placeholder="Scope notes, inclusions, exclusions, access details..."
              />
            </div>

            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createQuote.isPending}>
                {createQuote.isPending ? "Creating..." : "Create Quote"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <div className="grid gap-4">
        {isLoading ? (
          [1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)
        ) : quotes?.map(quote => (
          <Link key={quote.id} href={`/quotes/${quote.id}`}>
            <Card className="hover:border-primary transition-colors cursor-pointer">
              <CardContent className="p-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-primary/10 text-primary rounded-full">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{quote.quoteNumber} - {quote.customerName || "No client"}</h3>
                    <p className="text-sm text-muted-foreground">{quote.title || 'Untitled Quote'}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4 sm:gap-8">
                  <div className="sm:text-right">
                    <p className="font-bold text-lg">${quote.total.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">Total</p>
                  </div>
                  <Badge variant={quote.status === "accepted" ? "default" : quote.status === "declined" ? "destructive" : "secondary"}>
                    {quote.status.toUpperCase()}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        {!isLoading && quotes?.length === 0 && (
           <div className="text-center py-12 text-muted-foreground border rounded-lg border-dashed">
             No quotes found.
           </div>
        )}
      </div>
    </div>
  );
}
