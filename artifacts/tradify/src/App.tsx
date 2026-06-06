import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout";
import { AuthProvider, useAuth } from "@/lib/auth";
import Login from "@/pages/login";

import Dashboard from "@/pages/dashboard";
import Jobs from "@/pages/jobs";
import JobDetail from "@/pages/job-detail";
import Customers from "@/pages/customers";
import CustomerDetail from "@/pages/customer-detail";
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
import NotificationCentre from "@/pages/notifications";
import StaffInvites from "@/pages/staff-invites";

const queryClient = new QueryClient();

function AdminRoutes() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/jobs" component={Jobs} />
        <Route path="/jobs/:id" component={JobDetail} />
        <Route path="/customers" component={Customers} />
        <Route path="/customers/:id" component={CustomerDetail} />
        <Route path="/invoices" component={Invoices} />
        <Route path="/invoices/:id" component={InvoiceDetail} />
        <Route path="/schedule" component={Schedule} />

        {/* Operations */}
        <Route path="/field" component={FieldView} />
        <Route path="/field/home" component={FieldView} />
        <Route path="/field/schedule" component={FieldView} />
        <Route path="/field/time-off" component={FieldView} />
        <Route path="/field/stock" component={FieldView} />
        <Route path="/field/pay" component={FieldView} />
        <Route path="/field/docs" component={FieldView} />
        <Route path="/field/jobs/:id" component={FieldJobDetail} />
        <Route path="/dispatch" component={Dispatch} />
        <Route path="/admin/reports" component={AdminReports} />
        <Route path="/admin/live" component={AdminLive} />
        <Route path="/admin/timesheets" component={AdminTimesheets} />
        <Route path="/weekly-invoices" component={WeeklyInvoices} />
        <Route path="/weekly-invoices/:id" component={WeeklyInvoiceDetail} />
        <Route path="/settings/xero" component={XeroSettings} />
        <Route path="/settings/staff-invites" component={StaffInvites} />

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
        <Route path="/stock" component={Inventory} />
        <Route path="/suppliers" component={Suppliers} />

        {/* Notifications */}
        <Route path="/notifications" component={NotificationCentre} />

        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function WorkerRoutes() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={FieldView} />
        <Route path="/field" component={FieldView} />
        <Route path="/field/home" component={FieldView} />
        <Route path="/field/schedule" component={FieldView} />
        <Route path="/field/time-off" component={FieldView} />
        <Route path="/field/stock" component={FieldView} />
        <Route path="/field/pay" component={FieldView} />
        <Route path="/field/docs" component={FieldView} />
        <Route path="/field/jobs/:id" component={FieldJobDetail} />
        <Route path="/worker-profiles" component={WorkerProfiles} />
        <Route path="/weekly-invoices" component={WeeklyInvoices} />
        <Route path="/weekly-invoices/:id" component={WeeklyInvoiceDetail} />
        <Route path="/notifications" component={NotificationCentre} />
        <Route component={FieldView} />
      </Switch>
    </AppLayout>
  );
}

function AuthenticatedRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-sidebar text-sidebar-foreground">
        <div className="mx-4 flex max-w-sm flex-col items-center gap-3 text-center text-sm text-white/70">
          <div className="h-10 w-10 overflow-hidden rounded-md border border-white/15 bg-black">
            <img
              src="/diamond-sealing-logo.jpeg"
              alt="Company logo"
              className="h-full w-full object-cover"
            />
          </div>
          <div>
            <p className="font-medium text-white">Starting SealFlow...</p>
            <p className="mt-1 text-xs text-white/55">
              If this is the first open in a while, it can take a moment to wake
              up.
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (!user) return <Login />;
  return user.role === "worker" ? <WorkerRoutes /> : <AdminRoutes />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AuthenticatedRoutes />
          </WouterRouter>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
