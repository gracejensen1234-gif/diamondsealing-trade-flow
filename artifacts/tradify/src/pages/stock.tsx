import { useState } from "react";
import { useListStockItems } from "@workspace/api-client-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Edit2, Trash2, AlertTriangle } from "lucide-react";

export default function Stock() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: stockItems, isLoading } = useListStockItems();
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("tube");
  const [colour, setColour] = useState("");
  const [currentStock, setCurrentStock] = useState("");

  const createItem = useMutation({
    mutationFn: (payload: { name: string; unit: string; colour?: string; currentStock: number }) =>
      fetch("/api/stock-items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).then(r => r.json()),
    onSuccess: () => { toast({ title: "Stock item added" }); queryClient.invalidateQueries(); closeDialog(); },
  });

  const updateItem = useMutation({
    mutationFn: ({ id, ...data }: { id: number; name: string; unit: string; colour?: string; currentStock: number }) =>
      fetch(`/api/stock-items/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => { toast({ title: "Stock item updated" }); queryClient.invalidateQueries(); closeDialog(); },
  });

  const deleteItem = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/stock-items/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast({ title: "Stock item deleted" }); queryClient.invalidateQueries(); },
  });

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingId(null);
    setName("");
    setUnit("tube");
    setColour("");
    setCurrentStock("");
  };

  const openEdit = (item: any) => {
    setEditingId(item.id);
    setName(item.name);
    setUnit(item.unit);
    setColour(item.colour || "");
    setCurrentStock(item.currentStock?.toString() || "0");
    setDialogOpen(true);
  };

  const handleSave = () => {
    const payload = {
      name,
      unit,
      colour: colour || undefined,
      currentStock: parseInt(currentStock) || 0
    };

    if (editingId) {
      updateItem.mutate({ id: editingId, ...payload });
    } else {
      createItem.mutate(payload);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Stock Management</h1>
          <p className="text-muted-foreground mt-2">Track silicone, solvents, and materials.</p>
        </div>
        
        <Dialog open={dialogOpen} onOpenChange={(open) => { if(!open) closeDialog(); else setDialogOpen(true); }}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> Add Stock Item</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? 'Edit Stock Item' : 'Add Stock Item'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Name / Product</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. SikaSeal Kitchen" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Unit</Label>
                  <Select value={unit} onValueChange={setUnit}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tube">Tube</SelectItem>
                      <SelectItem value="litre">Litre</SelectItem>
                      <SelectItem value="kg">Kg</SelectItem>
                      <SelectItem value="roll">Roll</SelectItem>
                      <SelectItem value="each">Each</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Colour (optional)</Label>
                  <Input value={colour} onChange={e => setColour(e.target.value)} placeholder="e.g. Alabaster" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Current Stock Quantity</Label>
                <Input type="number" value={currentStock} onChange={e => setCurrentStock(e.target.value)} min="0" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button onClick={handleSave} disabled={!name || createItem.isPending || updateItem.isPending}>
                Save Item
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product Name</TableHead>
                <TableHead>Colour</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Current Stock</TableHead>
                <TableHead className="w-[100px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5}><div className="space-y-2 p-4"><Skeleton className="h-8 w-full"/><Skeleton className="h-8 w-full"/></div></TableCell></TableRow>
              ) : stockItems?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No stock items added yet.</TableCell>
                </TableRow>
              ) : (
                stockItems?.map(item => {
                  const isLow = (item.currentStock || 0) < 10;
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell>{item.colour || '-'}</TableCell>
                      <TableCell className="text-muted-foreground capitalize">{item.unit}</TableCell>
                      <TableCell>
                        <div className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-md text-sm font-semibold ${isLow ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' : ''}`}>
                          {item.currentStock || 0}
                          {isLow && <AlertTriangle className="h-4 w-4" />}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(item)}>
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => { if(confirm('Delete stock item?')) deleteItem.mutate(item.id) }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}