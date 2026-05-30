import { Link, useLocation } from "wouter";
import { 
  Hammer, 
  Users, 
  Briefcase, 
  FileText, 
  Receipt, 
  Calendar, 
  Home,
  Smartphone,
  ClipboardList,
  Radio,
  Clock,
  FileSpreadsheet,
  Package,
  Settings
} from "lucide-react";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navGroups = [
    {
      title: "Admin",
      items: [
        { name: "Dashboard", href: "/", icon: Home },
        { name: "Jobs", href: "/jobs", icon: Hammer },
        { name: "Customers", href: "/customers", icon: Users },
        { name: "Quotes", href: "/quotes", icon: FileText },
        { name: "Invoices", href: "/invoices", icon: Receipt },
        { name: "Schedule", href: "/schedule", icon: Calendar },
      ]
    },
    {
      title: "Operations",
      items: [
        { name: "Dispatch", href: "/dispatch", icon: ClipboardList },
        { name: "Reports", href: "/admin/reports", icon: FileText },
        { name: "Live View", href: "/admin/live", icon: Radio },
        { name: "Timesheets", href: "/admin/timesheets", icon: Clock },
        { name: "Weekly Invoices", href: "/weekly-invoices", icon: FileSpreadsheet },
      ]
    },
    {
      title: "Field",
      items: [
        { name: "Field View", href: "/field", icon: Smartphone },
      ]
    },
    {
      title: "Settings",
      items: [
        { name: "Stock", href: "/stock", icon: Package },
        { name: "Xero Settings", href: "/settings/xero", icon: Settings },
      ]
    }
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <nav className="w-64 border-r border-border bg-sidebar text-sidebar-foreground flex-shrink-0 flex flex-col">
        <div className="p-6 flex items-center gap-3 border-b border-sidebar-border">
          <div className="w-8 h-8 rounded bg-sidebar-primary flex items-center justify-center text-sidebar-primary-foreground font-bold">
            DS
          </div>
          <span className="text-xl font-bold tracking-tight">Diamond Sealing</span>
        </div>
        <div className="flex-1 py-4 px-3 flex flex-col gap-6 overflow-y-auto">
          {navGroups.map((group) => (
            <div key={group.title}>
              <h3 className="px-3 mb-2 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
                {group.title}
              </h3>
              <div className="flex flex-col gap-1">
                {group.items.map((item) => {
                  const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
                        isActive 
                          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" 
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                      }`}
                    >
                      <item.icon className="w-5 h-5" />
                      {item.name}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
