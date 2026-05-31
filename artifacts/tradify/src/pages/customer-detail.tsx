import {
  getGetCustomerQueryKey,
  getListCustomersQueryKey,
  useGetCustomer,
  useListInvoices,
  useListJobs,
  useListQuotes,
  useUpdateCustomer,
} from "@workspace/api-client-react";
import { useRoute, Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Mail, Phone, MapPin, Building, Briefcase, FileText, Receipt } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

const emptyClientForm = {
  name: "",
  company: "",
  email: "",
  phone: "",
  address: "",
  suburb: "",
  state: "",
  postcode: "",
  notes: "",
};

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export default function CustomerDetail() {
  const [, params] = useRoute("/customers/:id");
  const id = Number(params?.id);
  const { data: customer, isLoading } = useGetCustomer(id, { query: { enabled: !!id, queryKey: getGetCustomerQueryKey(id) } });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState(emptyClientForm);

  const { data: jobs, isLoading: isLoadingJobs } = useListJobs({ customerId: id });
  const { data: quotes, isLoading: isLoadingQuotes } = useListQuotes({ customerId: id });
  const { data: invoices, isLoading: isLoadingInvoices } = useListInvoices({ customerId: id });

  useEffect(() => {
    if (!customer) return;
    setForm({
      name: customer.name ?? "",
      company: customer.company ?? "",
      email: customer.email ?? "",
      phone: customer.phone ?? "",
      address: customer.address ?? "",
      suburb: customer.suburb ?? "",
      state: customer.state ?? "",
      postcode: customer.postcode ?? "",
      notes: customer.notes ?? "",
    });
  }, [customer]);

  const updateCustomer = useUpdateCustomer({
    mutation: {
      onSuccess: (updatedCustomer) => {
        queryClient.setQueryData(getGetCustomerQueryKey(id), updatedCustomer);
        queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() });
        setEditOpen(false);
        toast({ title: "Client updated" });
      },
      onError: () => {
        toast({
          title: "Could not update client",
          description: "Check the required fields and try again.",
          variant: "destructive",
        });
      },
    },
  });

  const updateForm = (field: keyof typeof emptyClientForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleUpdateClient = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = form.name.trim();

    if (!name) {
      toast({
        title: "Client name required",
        description: "Enter a name before saving.",
        variant: "destructive",
      });
      return;
    }

    updateCustomer.mutate({
      id,
      data: {
        name,
        company: optionalText(form.company),
        email: optionalText(form.email),
        phone: optionalText(form.phone),
        address: optionalText(form.address),
        suburb: optionalText(form.suburb),
        state: optionalText(form.state),
        postcode: optionalText(form.postcode),
        notes: optionalText(form.notes),
      },
    });
  };

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (!customer) return <div>Client not found</div>;

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{customer.name}</h1>
          {customer.company && (
            <div className="flex items-center gap-2 text-muted-foreground mt-2">
              <Building className="h-4 w-4" />
              <span>{customer.company}</span>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setEditOpen(true)}>Edit Client</Button>
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Client</DialogTitle>
          </DialogHeader>
          <form className="space-y-5" onSubmit={handleUpdateClient}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="edit-client-name">Name</Label>
                <Input
                  id="edit-client-name"
                  value={form.name}
                  onChange={(event) => updateForm("name", event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-client-company">Company</Label>
                <Input
                  id="edit-client-company"
                  value={form.company}
                  onChange={(event) => updateForm("company", event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-client-phone">Phone</Label>
                <Input
                  id="edit-client-phone"
                  value={form.phone}
                  onChange={(event) => updateForm("phone", event.target.value)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="edit-client-email">Email</Label>
                <Input
                  id="edit-client-email"
                  type="email"
                  value={form.email}
                  onChange={(event) => updateForm("email", event.target.value)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="edit-client-address">Address</Label>
                <Input
                  id="edit-client-address"
                  value={form.address}
                  onChange={(event) => updateForm("address", event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-client-suburb">Suburb</Label>
                <Input
                  id="edit-client-suburb"
                  value={form.suburb}
                  onChange={(event) => updateForm("suburb", event.target.value)}
                />
              </div>
              <div className="grid grid-cols-[1fr_7rem] gap-3">
                <div className="space-y-2">
                  <Label htmlFor="edit-client-state">State</Label>
                  <Input
                    id="edit-client-state"
                    value={form.state}
                    onChange={(event) => updateForm("state", event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-client-postcode">Postcode</Label>
                  <Input
                    id="edit-client-postcode"
                    value={form.postcode}
                    onChange={(event) => updateForm("postcode", event.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="edit-client-notes">Notes</Label>
                <Textarea
                  id="edit-client-notes"
                  value={form.notes}
                  onChange={(event) => updateForm("notes", event.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateCustomer.isPending}>
                {updateCustomer.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="col-span-1">
          <CardHeader><CardTitle>Contact Info</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {customer.email && (
              <div className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span>{customer.email}</span>
              </div>
            )}
            {customer.phone && (
              <div className="flex items-center gap-3">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span>{customer.phone}</span>
              </div>
            )}
            {customer.address && (
              <div className="flex items-start gap-3">
                <MapPin className="h-4 w-4 text-muted-foreground mt-1" />
                <span>
                  {customer.address}<br />
                  {customer.suburb && <>{customer.suburb} </>}
                  {customer.state && <>{customer.state} </>}
                  {customer.postcode && <>{customer.postcode}</>}
                </span>
              </div>
            )}
            {customer.notes && (
              <div className="mt-6 pt-4 border-t">
                <span className="font-semibold text-sm">Notes</span>
                <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{customer.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="col-span-2 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Briefcase className="h-5 w-5" /> Jobs
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingJobs ? <Skeleton className="h-20" /> : (
                <div className="space-y-3 mt-4">
                  {jobs?.map(job => (
                    <Link key={job.id} href={`/jobs/${job.id}`}>
                      <div className="flex justify-between items-center p-3 border rounded-lg hover:border-primary transition-colors cursor-pointer">
                        <div>
                          <p className="font-medium">{job.title}</p>
                          <p className="text-sm text-muted-foreground">{job.scheduledDate ? new Date(job.scheduledDate).toLocaleDateString() : 'Unscheduled'}</p>
                        </div>
                        <Badge variant={job.status === "completed" ? "secondary" : "default"}>{job.status}</Badge>
                      </div>
                    </Link>
                  ))}
                  {!jobs?.length && <p className="text-sm text-muted-foreground">No jobs found for this client.</p>}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="h-5 w-5" /> Quotes
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingQuotes ? <Skeleton className="h-20" /> : (
                <div className="space-y-3 mt-4">
                  {quotes?.map(quote => (
                    <Link key={quote.id} href={`/quotes/${quote.id}`}>
                      <div className="flex justify-between items-center p-3 border rounded-lg hover:border-primary transition-colors cursor-pointer">
                        <div>
                          <p className="font-medium">{quote.quoteNumber}</p>
                          <p className="text-sm text-muted-foreground">{quote.title || 'Untitled'}</p>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="font-bold">${quote.total.toFixed(2)}</span>
                          <Badge variant="outline">{quote.status}</Badge>
                        </div>
                      </div>
                    </Link>
                  ))}
                  {!quotes?.length && <p className="text-sm text-muted-foreground">No quotes found for this client.</p>}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Receipt className="h-5 w-5" /> Invoices
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingInvoices ? <Skeleton className="h-20" /> : (
                <div className="space-y-3 mt-4">
                  {invoices?.map(invoice => (
                    <Link key={invoice.id} href={`/invoices/${invoice.id}`}>
                      <div className="flex justify-between items-center p-3 border rounded-lg hover:border-primary transition-colors cursor-pointer">
                        <div>
                          <p className="font-medium">{invoice.invoiceNumber}</p>
                          <p className="text-sm text-muted-foreground">{invoice.title || 'Untitled'}</p>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="font-bold">${invoice.total.toFixed(2)}</span>
                          <Badge variant="outline">{invoice.status}</Badge>
                        </div>
                      </div>
                    </Link>
                  ))}
                  {!invoices?.length && <p className="text-sm text-muted-foreground">No invoices found for this client.</p>}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
