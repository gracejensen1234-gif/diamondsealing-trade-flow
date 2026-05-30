import { useListQuotes } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Plus, FileText } from "lucide-react";

export default function Quotes() {
  const { data: quotes, isLoading } = useListQuotes();

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Quotes</h1>
          <p className="text-muted-foreground mt-2">Manage estimates and proposals.</p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> New Quote
        </Button>
      </div>

      <div className="grid gap-4">
        {isLoading ? (
          [1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)
        ) : quotes?.map(quote => (
          <Link key={quote.id} href={`/quotes/${quote.id}`}>
            <Card className="hover:border-primary transition-colors cursor-pointer">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-primary/10 text-primary rounded-full">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{quote.quoteNumber} - {quote.customerName}</h3>
                    <p className="text-sm text-muted-foreground">{quote.title || 'Untitled Quote'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-8">
                  <div className="text-right">
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
