import { Link, useLocation } from "wouter";
import {
  Hammer, Users, FileText, Receipt, Calendar, Home,
  Smartphone, ClipboardList, Radio, Clock, FileSpreadsheet, Package,
  Settings, BarChart2, Trophy, Star, ShieldCheck, Truck,
  Award, Brain, CalendarRange, TrendingUp, HardHat, Building2,
  ScrollText, Bell,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  // Read subcontractor from localStorage to show unread badge
  const subId = (() => {
    try {
      const v = localStorage.getItem("ds_selected_subcontractor_id");
      return v ? parseInt(v) : undefined;
    } catch {
      return undefined;
    }
  })();

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["unread-count", subId],
    queryFn: () => {
      if (!subId) return Promise.resolve({ count: 0 });
      return fetch(`/api/notifications/unread-count?subcontractorId=${subId}`).then((r) => r.json());
    },
    enabled: !!subId,
    refetchInterval: 30000,
  });

  const unreadCount = unreadData?.count ?? 0;

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
      ],
    },
    {
      title: "Operations",
      items: [
        { name: "Dispatch", href: "/dispatch", icon: ClipboardList },
        { name: "Reports", href: "/admin/reports", icon: FileText },
        { name: "Live View", href: "/admin/live", icon: Radio },
        { name: "Timesheets", href: "/admin/timesheets", icon: Clock },
        { name: "Weekly Invoices", href: "/weekly-invoices", icon: FileSpreadsheet },
      ],
    },
    {
      title: "Workforce",
      items: [
        { name: "Smart Allocation", href: "/allocation", icon: Brain },
        { name: "Weekly Planner", href: "/weekly-planner", icon: CalendarRange },
        { name: "Worker Profiles", href: "/worker-profiles", icon: HardHat },
        { name: "Builder Profiles", href: "/builder-profiles", icon: Building2 },
      ],
    },
    {
      title: "Analytics",
      items: [
        { name: "Productivity", href: "/analytics", icon: BarChart2 },
        { name: "Leaderboard", href: "/leaderboard", icon: Trophy },
        { name: "Profitability", href: "/profitability", icon: TrendingUp },
      ],
    },
    {
      title: "Quality & Rewards",
      items: [
        { name: "AI Audit", href: "/audit", icon: ShieldCheck },
        { name: "Awards", href: "/awards", icon: Award },
        { name: "Bonuses", href: "/bonuses", icon: Star },
        { name: "Dockets", href: "/dockets", icon: ScrollText },
      ],
    },
    {
      title: "Inventory",
      items: [
        { name: "Sub Inventory", href: "/inventory", icon: Package },
        { name: "Suppliers", href: "/suppliers", icon: Truck },
        { name: "Stock", href: "/stock", icon: Package },
      ],
    },
    {
      title: "Field",
      items: [
        { name: "Field View", href: "/field", icon: Smartphone },
        { name: "Notifications", href: "/notifications", icon: Bell, badge: unreadCount > 0 ? unreadCount : undefined },
      ],
    },
    {
      title: "Settings",
      items: [{ name: "Xero Settings", href: "/settings/xero", icon: Settings }],
    },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <nav className="w-60 border-r border-border bg-sidebar text-sidebar-foreground flex-shrink-0 flex flex-col">
        <div className="p-4 flex items-center gap-3 border-b border-sidebar-border">
          <div className="w-8 h-8 rounded bg-sidebar-primary flex items-center justify-center text-sidebar-primary-foreground font-bold text-sm">
            DS
          </div>
          <span className="text-lg font-bold tracking-tight">Diamond Sealing</span>
        </div>
        <div className="flex-1 py-3 px-2 flex flex-col gap-4 overflow-y-auto">
          {navGroups.map((group) => (
            <div key={group.title}>
              <h3 className="px-3 mb-1 text-[10px] font-semibold text-sidebar-foreground/40 uppercase tracking-wider">
                {group.title}
              </h3>
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const isActive =
                    location === item.href ||
                    (item.href !== "/" && location.startsWith(item.href));
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      className={`flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                      }`}
                    >
                      <item.icon className="w-4 h-4 flex-shrink-0" />
                      <span className="flex-1">{item.name}</span>
                      {"badge" in item && item.badge ? (
                        <span className="min-w-[1.2rem] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
                          {(item.badge as number) > 99 ? "99+" : item.badge}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-6">{children}</div>
      </main>
    </div>
  );
}
