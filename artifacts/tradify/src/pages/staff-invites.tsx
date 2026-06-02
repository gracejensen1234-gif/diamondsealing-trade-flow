import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Copy, ShieldCheck, UserPlus, XCircle } from "lucide-react";

type StaffInvite = {
  id: number;
  email: string;
  name: string | null;
  inviteCode: string;
  inviteUrl: string | null;
  role: "admin";
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
};

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? "Request failed");
  return data;
}

function statusBadge(status: StaffInvite["status"]) {
  if (status === "pending") return "default";
  if (status === "accepted") return "secondary";
  if (status === "revoked") return "outline";
  return "destructive";
}

function formatDate(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function StaffInvites() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("14");
  const [lastInvite, setLastInvite] = useState<StaffInvite | null>(null);

  const { data: invites = [], isLoading } = useQuery<StaffInvite[]>({
    queryKey: ["staff-invites"],
    queryFn: () => requestJson("/api/staff-invites"),
  });

  const pendingCount = useMemo(() => invites.filter((invite) => invite.status === "pending").length, [invites]);

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copied` });
    } catch {
      toast({ title: "Copy failed", description: "Select the text and copy it manually.", variant: "destructive" });
    }
  }

  const createInvite = useMutation({
    mutationFn: () => requestJson("/api/staff-invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, expiresInDays: Number(expiresInDays) }),
    }),
    onSuccess: (invite: StaffInvite) => {
      setLastInvite(invite);
      setName("");
      setEmail("");
      queryClient.invalidateQueries({ queryKey: ["staff-invites"] });
      toast({ title: "Staff admin invite created" });
    },
    onError: (error) => toast({
      title: "Could not create invite",
      description: error instanceof Error ? error.message : "Try again.",
      variant: "destructive",
    }),
  });

  const revokeInvite = useMutation({
    mutationFn: (id: number) => requestJson(`/api/staff-invites/${id}/revoke`, { method: "PATCH" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-invites"] });
      toast({ title: "Invite revoked" });
    },
    onError: (error) => toast({
      title: "Could not revoke invite",
      description: error instanceof Error ? error.message : "Try again.",
      variant: "destructive",
    }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Staff Admin Invites</h1>
          <p className="text-muted-foreground mt-1">Invite office staff to the same company account without creating a new company.</p>
        </div>
        <Badge variant="secondary">{pendingCount} pending</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="h-5 w-5" />
            Create Invite
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1fr_140px]">
            <div className="space-y-2">
              <Label>Staff name</Label>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Nathan" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="staff@example.com" />
            </div>
            <div className="space-y-2">
              <Label>Expires</Label>
              <Input type="number" min={1} max={90} value={expiresInDays} onChange={(event) => setExpiresInDays(event.target.value)} />
            </div>
          </div>
          <Button className="w-full sm:w-auto" onClick={() => createInvite.mutate()} disabled={createInvite.isPending}>
            <ShieldCheck className="mr-2 h-4 w-4" />
            {createInvite.isPending ? "Creating..." : "Create Staff Admin Invite"}
          </Button>
        </CardContent>
      </Card>

      {lastInvite?.inviteUrl ? (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle className="text-base">Latest Invite</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-sm font-medium">{lastInvite.name || lastInvite.email}</p>
              <p className="text-xs text-muted-foreground">{lastInvite.email}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <Input readOnly value={lastInvite.inviteUrl} />
              <Button variant="outline" onClick={() => copyText(lastInvite.inviteUrl!, "Invite link")}>
                <Copy className="mr-2 h-4 w-4" />
                Copy Link
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <Input readOnly value={lastInvite.inviteCode} />
              <Button variant="outline" onClick={() => copyText(lastInvite.inviteCode, "Invite code")}>
                <Copy className="mr-2 h-4 w-4" />
                Copy Code
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Invites</h2>
        {isLoading ? (
          <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading invites...</CardContent></Card>
        ) : invites.length === 0 ? (
          <Card><CardContent className="p-6 text-sm text-muted-foreground">No staff invites yet.</CardContent></Card>
        ) : (
          invites.map((invite) => (
            <Card key={invite.id}>
              <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{invite.name || invite.email}</p>
                    <Badge variant={statusBadge(invite.status) as any} className="capitalize">{invite.status}</Badge>
                    <Badge variant="outline">Admin access</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{invite.email}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Created {formatDate(invite.createdAt)}
                    {invite.status === "pending" ? ` • Expires ${formatDate(invite.expiresAt)}` : ""}
                    {invite.acceptedAt ? ` • Accepted ${formatDate(invite.acceptedAt)}` : ""}
                  </p>
                </div>
                {invite.status === "pending" ? (
                  <div className="flex flex-wrap gap-2">
                    {invite.inviteUrl ? (
                      <Button variant="outline" size="sm" onClick={() => copyText(invite.inviteUrl!, "Invite link")}>
                        <Copy className="mr-2 h-4 w-4" />
                        Link
                      </Button>
                    ) : null}
                    <Button variant="outline" size="sm" onClick={() => copyText(invite.inviteCode, "Invite code")}>
                      <Copy className="mr-2 h-4 w-4" />
                      Code
                    </Button>
                    <Button variant="outline" size="sm" className="text-destructive" onClick={() => revokeInvite.mutate(invite.id)}>
                      <XCircle className="mr-2 h-4 w-4" />
                      Revoke
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
