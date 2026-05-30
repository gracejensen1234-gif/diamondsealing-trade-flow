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

// Operations
import FieldView from "@/pages/field";
import FieldJobDetail from "@/pages/field-job-detail";
import Dispatch from "@/pages/dispatch";
import AdminReports from "@/pages/admin-reports";
import AdminLive from "@/pages/admin-live";
import AdminTimesheets from "@/pages/admin-timesheets";
import WeeklyInvoices from "@/pages/weekly-invoices";
import WeeklyInvoiceDetail from "@/pages/weekly-invoice-detail";
import Stock from "@/pages/stock";
import XeroSettings from "@/pages/xero-settings";

// New Feature Pages
import Analytics from "@/pages/analytics";
import Leaderboard from "@/pages/leaderboard";
import Bonuses from "@/pages/bonuses";
import Dockets from "@/pages/dockets";
import Inventory from "@/pages/inventory";
import AuditFlags from "@/pages/audit-flags";
import Awards from "@/pages/awards";
import WorkerProfiles from "@/pages/worker-profiles";
import BuilderProfiles from "@/pages/builder-profiles";
import Allocation from "@/pages/allocation";
import WeeklyPlanner from "@/pages/weekly-planner";
import Suppliers from "@/pages/suppliers";
import Profitability from "@/pages/profitability";

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

        {/* Operations */}
        <Route path="/field" component={FieldView} />
        <Route path="/field/jobs/:id" component={FieldJobDetail} />
        <Route path="/dispatch" component={Dispatch} />
        <Route path="/admin/reports" component={AdminReports} />
        <Route path="/admin/live" component={AdminLive} />
        <Route path="/admin/timesheets" component={AdminTimesheets} />
        <Route path="/weekly-invoices" component={WeeklyInvoices} />
        <Route path="/weekly-invoices/:id" component={WeeklyInvoiceDetail} />
        <Route path="/stock" component={Stock} />
        <Route path="/settings/xero" component={XeroSettings} />

        {/* Analytics & Performance */}
        <Route path="/analytics" component={Analytics} />
        <Route path="/leaderboard" component={Leaderboard} />
        <Route path="/profitability" component={Profitability} />

        {/* Workforce */}
        <Route path="/worker-profiles" component={WorkerProfiles} />
        <Route path="/builder-profiles" component={BuilderProfiles} />
        <Route path="/allocation" component={Allocation} />
        <Route path="/weekly-planner" component={WeeklyPlanner} />

        {/* Finance */}
        <Route path="/bonuses" component={Bonuses} />
        <Route path="/dockets" component={Dockets} />

        {/* Quality & Compliance */}
        <Route path="/audit" component={AuditFlags} />
        <Route path="/awards" component={Awards} />

        {/* Inventory & Suppliers */}
        <Route path="/inventory" component={Inventory} />
        <Route path="/suppliers" component={Suppliers} />

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
