import { useListCustomers } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Plus, Search, Mail, Phone } from "lucide-react";
import { useState } from "react";

export default function Customers() {
  const [search, setSearch] = useState("");
  const { data: customers, isLoading } = useListCustomers({ search: search || undefined });

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
          <p className="text-muted-foreground mt-2">Manage your client base.</p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> Add Customer
        </Button>
      </div>

      <div className="flex items-center gap-4 max-w-sm">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input 
          placeholder="Search customers..." 
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
             No customers found.
           </div>
        )}
      </div>
    </div>
  );
}
