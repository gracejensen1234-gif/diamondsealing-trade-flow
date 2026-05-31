import { getListCustomersQueryKey, useCreateCustomer, useListCustomers } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Mail, Phone } from "lucide-react";
import { useState, type FormEvent } from "react";

const emptyCustomerForm = {
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

export default function Customers() {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyCustomerForm);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: customers, isLoading } = useListCustomers({ search: search || undefined });

  const createCustomer = useCreateCustomer({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey({ search: search || undefined }) });
        setForm(emptyCustomerForm);
        setOpen(false);
        toast({ title: "Client added" });
      },
      onError: () => {
        toast({
          title: "Could not add client",
          description: "Check the required fields and try again.",
          variant: "destructive",
        });
      },
    },
  });

  const updateForm = (field: keyof typeof emptyCustomerForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleCreateCustomer = (event: FormEvent<HTMLFormElement>) => {
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

    createCustomer.mutate({
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

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Clients</h1>
          <p className="text-muted-foreground mt-2">Manage your client base.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Add Client
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Add client</DialogTitle>
            </DialogHeader>
            <form className="space-y-5" onSubmit={handleCreateCustomer}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="customer-name">Name</Label>
                  <Input
                    id="customer-name"
                    value={form.name}
                    onChange={(event) => updateForm("name", event.target.value)}
                    placeholder="Client name"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="customer-company">Company</Label>
                  <Input
                    id="customer-company"
                    value={form.company}
                    onChange={(event) => updateForm("company", event.target.value)}
                    placeholder="Company"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="customer-phone">Phone</Label>
                  <Input
                    id="customer-phone"
                    value={form.phone}
                    onChange={(event) => updateForm("phone", event.target.value)}
                    placeholder="Phone"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="customer-email">Email</Label>
                  <Input
                    id="customer-email"
                    type="email"
                    value={form.email}
                    onChange={(event) => updateForm("email", event.target.value)}
                    placeholder="Email"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="customer-address">Address</Label>
                  <Input
                    id="customer-address"
                    value={form.address}
                    onChange={(event) => updateForm("address", event.target.value)}
                    placeholder="Street address"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="customer-suburb">Suburb</Label>
                  <Input
                    id="customer-suburb"
                    value={form.suburb}
                    onChange={(event) => updateForm("suburb", event.target.value)}
                    placeholder="Suburb"
                  />
                </div>
                <div className="grid grid-cols-[1fr_7rem] gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="customer-state">State</Label>
                    <Input
                      id="customer-state"
                      value={form.state}
                      onChange={(event) => updateForm("state", event.target.value)}
                      placeholder="State"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="customer-postcode">Postcode</Label>
                    <Input
                      id="customer-postcode"
                      value={form.postcode}
                      onChange={(event) => updateForm("postcode", event.target.value)}
                      placeholder="0000"
                    />
                  </div>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="customer-notes">Notes</Label>
                  <Textarea
                    id="customer-notes"
                    value={form.notes}
                    onChange={(event) => updateForm("notes", event.target.value)}
                    placeholder="Notes"
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={createCustomer.isPending}>
                  {createCustomer.isPending ? "Saving..." : "Save Client"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-4 max-w-sm">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input 
          placeholder="Search clients..." 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          [1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full" />)
        ) : customers?.map(customer => (
          <Link key={customer.id} href={`/customers/${customer.id}`}>
            <Card className="hover:border-primary transition-colors cursor-pointer h-full">
              <CardContent className="p-6">
                <h3 className="font-semibold text-lg">{customer.name}</h3>
                {customer.company && <p className="text-sm text-muted-foreground">{customer.company}</p>}
                
                <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                  {customer.phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="h-3 w-3" /> {customer.phone}
                    </div>
                  )}
                  {customer.email && (
                    <div className="flex items-center gap-2">
                      <Mail className="h-3 w-3" /> {customer.email}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        {!isLoading && customers?.length === 0 && (
           <div className="col-span-full text-center py-12 text-muted-foreground border rounded-lg border-dashed">
             No clients found.
           </div>
        )}
      </div>
    </div>
  );
}
