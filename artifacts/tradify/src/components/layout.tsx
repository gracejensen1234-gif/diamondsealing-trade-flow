import { Link, useLocation } from "wouter";
import { Hammer, Users, Briefcase, FileText, Receipt, Calendar, Home } from "lucide-react";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navigation = [
    { name: "Dashboard", href: "/", icon: Home },
    { name: "Jobs", href: "/jobs", icon: Hammer },
    { name: "Customers", href: "/customers", icon: Users },
    { name: "Quotes", href: "/quotes", icon: FileText },
    { name: "Invoices", href: "/invoices", icon: Receipt },
    { name: "Schedule", href: "/schedule", icon: Calendar },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <nav className="w-64 border-r border-border bg-sidebar text-sidebar-foreground flex-shrink-0 flex flex-col">
        <div className="p-6 flex items-center gap-3 border-b border-sidebar-border">
          <div className="w-8 h-8 rounded bg-sidebar-primary flex items-center justify-center text-sidebar-primary-foreground font-bold">
            TF
          </div>
          <span className="text-xl font-bold tracking-tight">TradeFlow</span>
        </div>
        <div className="flex-1 py-6 px-3 flex flex-col gap-1 overflow-y-auto">
          {navigation.map((item) => {
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
      </nav>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
