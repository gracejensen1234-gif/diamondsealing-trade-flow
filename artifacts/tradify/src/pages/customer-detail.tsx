import { useGetCustomer, getGetCustomerQueryKey, useListJobs, useListQuotes, useListInvoices } from "@workspace/api-client-react";
import { useRoute, Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Mail, Phone, MapPin, Building, Briefcase, FileText, Receipt } from "lucide-react";

export default function CustomerDetail() {
  const [, params] = useRoute("/customers/:id");
  const id = Number(params?.id);
  const { data: customer, isLoading } = useGetCustomer(id, { query: { enabled: !!id, queryKey: getGetCustomerQueryKey(id) } });

  const { data: jobs, isLoading: isLoadingJobs } = useListJobs({ customerId: id });
  const { data: quotes, isLoading: isLoadingQuotes } = useListQuotes({ customerId: id });
  const { data: invoices, isLoading: isLoadingInvoices } = useListInvoices({ customerId: id });

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (!customer) return <div>Customer not found</div>;

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
          <Button variant="outline">Edit Customer</Button>
        </div>
      </div>

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
                  {!jobs?.length && <p className="text-sm text-muted-foreground">No jobs found for this customer.</p>}
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
                  {!quotes?.length && <p className="text-sm text-muted-foreground">No quotes found for this customer.</p>}
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
                  {!invoices?.length && <p className="text-sm text-muted-foreground">No invoices found for this customer.</p>}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
