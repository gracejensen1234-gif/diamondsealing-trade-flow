import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Package, AlertTriangle, Plus, ArrowDown, ArrowUp } from "lucide-react";

export default function Inventory() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [txOpen, setTxOpen] = useState(false);
  const [txForm, setTxForm] = useState({ subcontractorId: "", stockItemId: "", quantity: "", transactionType: "issued", notes: "" });
  const [filterSub, setFilterSub] = useState("all");

  const { data: items = [] } = useQuery({ queryKey: ["sub-inventory"], queryFn: () => fetch("/api/sub-inventory").then((r) => r.json()) });
  const { data: transactions = [] } = useQuery({ queryKey: ["sub-inventory-transactions"], queryFn: () => fetch("/api/inventory-transactions").then((r) => r.json()) });
  const { data: restockRequests = [] } = useQuery({ queryKey: ["restock-requests"], queryFn: () => fetch("/api/restock-requests").then((r) => r.json()) });
  const { data: subs = [] } = useQuery({ queryKey: ["subcontractors"], queryFn: () => fetch("/api/subcontractors").then((r) => r.json()) });
  const { data: stockItems = [] } = useQuery({ queryKey: ["stock-items"], queryFn: () => fetch("/api/stock-items").then((r) => r.json()) });

  const txMutation = useMutation({
    mutationFn: async (data: typeof txForm) => {
      const response = await fetch("/api/inventory-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subcontractorId: Number(data.subcontractorId),
          stockItemId: Number(data.stockItemId),
          quantity: Number(data.quantity),
          transactionType: data.transactionType,
          referenceNote: data.notes || undefined,
          recordedBy: "admin",
        }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Could not record inventory transaction");
      return response.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sub-inventory"] });
      qc.invalidateQueries({ queryKey: ["sub-inventory-transactions"] });
      setTxForm({ subcontractorId: "", stockItemId: "", quantity: "", transactionType: "issued", notes: "" });
      setTxOpen(false);
      toast({ title: "Inventory updated" });
    },
    onError: (error) => {
      toast({
        title: "Could not update inventory",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    },
  });

  const approveRestockMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => fetch(`/api/restock-requests/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["restock-requests"] }); toast({ title: "Restock request updated" }); },
  });

  const activeSubs = (subs as any[]).filter((s: any) => s.active);
  const lowStock = (items as any[]).filter((i: any) => Number(i.currentQuantity) <= 0);
  const filteredItems = filterSub === "all" ? (items as any[]) : (items as any[]).filter((i: any) => String(i.subcontractorId) === filterSub);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sub Inventory</h1>
          <p className="text-muted-foreground mt-1">Silicone stock held by each subcontractor — issues, returns, restock requests</p>
        </div>
        <Dialog open={txOpen} onOpenChange={setTxOpen}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Record Transaction</Button></DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Inventory Transaction</DialogTitle></DialogHeader>
            <div className="space-y-4 mt-2">
              <div>
                <Label>Employee/Subcontractor</Label>
                <Select value={txForm.subcontractorId} onValueChange={(v) => setTxForm((p) => ({ ...p, subcontractorId: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select employee/subcontractor..." /></SelectTrigger>
                  <SelectContent>{activeSubs.map((s: any) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Product</Label>
                  <Select value={txForm.stockItemId} onValueChange={(v) => setTxForm((p) => ({ ...p, stockItemId: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select product..." /></SelectTrigger>
                    <SelectContent>
                      {(stockItems as any[]).map((item: any) => (
                        <SelectItem key={item.id} value={String(item.id)}>
                          {item.name}{item.colour ? ` - ${item.colour}` : ""} ({item.unit})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Quantity</Label>
                  <Input type="number" min="0.01" step="0.01" className="mt-1" value={txForm.quantity} onChange={(e) => setTxForm((p) => ({ ...p, quantity: e.target.value }))} />
                </div>
              </div>
              <div>
                <Label>Transaction Type</Label>
                <Select value={txForm.transactionType} onValueChange={(v) => setTxForm((p) => ({ ...p, transactionType: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="issued">Issued (out to employee/subcontractor)</SelectItem>
                    <SelectItem value="returned">Returned (back to depot)</SelectItem>
                    <SelectItem value="used_on_job">Used on job</SelectItem>
                    <SelectItem value="adjustment">Adjustment</SelectItem>
                    <SelectItem value="restock">Restock</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Notes</Label>
                <Input className="mt-1" value={txForm.notes} onChange={(e) => setTxForm((p) => ({ ...p, notes: e.target.value }))} />
              </div>
              <div className="flex gap-2 pt-2">
                <Button className="flex-1" onClick={() => txMutation.mutate(txForm)} disabled={!txForm.subcontractorId || !txForm.stockItemId || Number(txForm.quantity) <= 0}>Record</Button>
                <Button variant="outline" onClick={() => setTxOpen(false)}>Cancel</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Low stock alert */}
      {lowStock.length > 0 && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 dark:bg-red-950/20 dark:border-red-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-700 dark:text-red-400">Low stock alert — {lowStock.length} items</p>
            <p className="text-xs text-red-600 dark:text-red-500">{lowStock.map((i: any) => `${i.subcontractorName}: ${i.stockItemName} (${i.currentQuantity} ${i.unit ?? "unit"} left)`).join(" · ")}</p>
          </div>
        </div>
      )}

      <Tabs defaultValue="stock">
        <TabsList>
          <TabsTrigger value="stock">Current Stock</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="restock">Restock Requests ({(restockRequests as any[]).filter((r: any) => ["pending", "approved"].includes(r.status)).length})</TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="mt-4">
          <div className="flex items-center gap-3 mb-4">
            <Select value={filterSub} onValueChange={setFilterSub}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Employees/Subcontractors</SelectItem>
                {activeSubs.map((s: any) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-3">
            {filteredItems.map((item: any) => (
              <Card key={item.id} className={Number(item.currentQuantity) <= 0 ? "border-red-200 dark:border-red-800" : ""}>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-4">
                    <Package className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1">
                      <p className="font-medium text-sm">{item.stockItemName}</p>
                      <p className="text-xs text-muted-foreground">{item.subcontractorName} · {item.colour ?? "No colour recorded"}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-2xl font-bold ${Number(item.currentQuantity) <= 0 ? "text-red-600" : ""}`}>{item.currentQuantity}</p>
                      <p className="text-xs text-muted-foreground">{item.unit ?? "unit"}</p>
                    </div>
                    {Number(item.currentQuantity) <= 0 && <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />}
                  </div>
                </CardContent>
              </Card>
            ))}
            {filteredItems.length === 0 && <Card><CardContent className="py-10 text-center text-muted-foreground">No inventory records yet.</CardContent></Card>}
          </div>
        </TabsContent>

        <TabsContent value="transactions" className="mt-4 space-y-2">
          {(transactions as any[]).slice(0, 50).map((tx: any) => {
            const incoming = tx.transactionType === "issued" || tx.transactionType === "restock";
            const signedQuantity = incoming ? Number(tx.quantity) : -Math.abs(Number(tx.quantity));
            return (
              <div key={tx.id} className="flex items-center gap-3 p-3 rounded-lg border">
                {incoming ? <ArrowDown className="w-4 h-4 text-green-600" /> : <ArrowUp className="w-4 h-4 text-amber-500" />}
                <div className="flex-1 text-sm">
                  <span className="font-medium">{tx.subcontractorName}</span> — {tx.stockItemName}
                  {tx.referenceNote && <span className="text-muted-foreground"> · {tx.referenceNote}</span>}
                </div>
                <Badge variant="outline" className="text-xs capitalize">{String(tx.transactionType).replaceAll("_", " ")}</Badge>
                <span className="font-semibold text-sm w-10 text-right">{signedQuantity > 0 ? "+" : ""}{signedQuantity}</span>
                <span className="text-xs text-muted-foreground w-24 text-right">{new Date(tx.createdAt).toLocaleDateString("en-AU")}</span>
              </div>
            );
          })}
          {(transactions as any[]).length === 0 && <Card><CardContent className="py-10 text-center text-muted-foreground">No transactions recorded yet.</CardContent></Card>}
        </TabsContent>

        <TabsContent value="restock" className="mt-4 space-y-3">
          {(restockRequests as any[]).map((r: any) => (
            <Card key={r.id}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <p className="font-medium text-sm">{r.subcontractorName} — {r.stockItemName}</p>
                    <p className="text-xs text-muted-foreground">Requested qty: {r.quantityRequested}{r.subNotes ? ` · ${r.subNotes}` : ""}</p>
                  </div>
                  {r.status !== "pending" ? <Badge className="text-xs capitalize">{r.status}</Badge> : (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => approveRestockMutation.mutate({ id: r.id, status: "approved" })}>Approve</Button>
                      <Button size="sm" variant="outline" onClick={() => approveRestockMutation.mutate({ id: r.id, status: "rejected" })}>Decline</Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {(restockRequests as any[]).length === 0 && <Card><CardContent className="py-10 text-center text-muted-foreground">No restock requests.</CardContent></Card>}
        </TabsContent>
      </Tabs>
    </div>
  );
}
