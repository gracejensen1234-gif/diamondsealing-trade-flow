import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout";

import Dashboard from "@/pages/dashboard";
import Jobs from "@/pages/jobs";
import JobDetail from "@/pages/job-detail";
import Customers from "@/pages/customers";
import CustomerDetail from "@/pages/customer-detail";
import Quotes from "@/pages/quotes";
import QuoteDetail from "@/pages/quote-detail";
import Invoices from "@/pages/invoices";
import InvoiceDetail from "@/pages/invoice-detail";
import Schedule from "@/pages/schedule";

const queryClient = new QueryClient();

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/jobs" component={Jobs} />
        <Route path="/jobs/:id" component={JobDetail} />
        <Route path="/customers" component={Customers} />
        <Route path="/customers/:id" component={CustomerDetail} />
        <Route path="/quotes" component={Quotes} />
        <Route path="/quotes/:id" component={QuoteDetail} />
        <Route path="/invoices" component={Invoices} />
        <Route path="/invoices/:id" component={InvoiceDetail} />
        <Route path="/schedule" component={Schedule} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
