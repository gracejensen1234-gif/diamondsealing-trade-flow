import { useEffect, useState } from "react";
import { Building2, Users } from "lucide-react";
import { useLocation } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Customers from "@/pages/customers";
import BuilderProfiles from "@/pages/builder-profiles";

type DirectoryTab = "clients" | "builders";

function tabFromLocation(location: string): DirectoryTab {
  const [path, query = ""] = location.split("?");
  const params = new URLSearchParams(query);

  if (path.startsWith("/builder-profiles") || params.get("tab") === "builders") {
    return "builders";
  }

  return "clients";
}

export default function ClientsBuilders() {
  const [location] = useLocation();
  const [activeTab, setActiveTab] = useState<DirectoryTab>(() => tabFromLocation(location));

  useEffect(() => {
    setActiveTab(tabFromLocation(location));
  }, [location]);

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h1 className="text-3xl font-bold tracking-tight">Clients & Builders</h1>
        <p className="mt-2 text-muted-foreground">
          Manage client records and builder requirements from one place.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as DirectoryTab)}>
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:w-auto">
          <TabsTrigger value="clients" className="gap-2 py-2">
            <Users className="h-4 w-4" />
            Clients
          </TabsTrigger>
          <TabsTrigger value="builders" className="gap-2 py-2">
            <Building2 className="h-4 w-4" />
            Builders
          </TabsTrigger>
        </TabsList>

        <TabsContent value="clients" className="mt-6">
          <Customers embedded />
        </TabsContent>
        <TabsContent value="builders" className="mt-6">
          <BuilderProfiles embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}
