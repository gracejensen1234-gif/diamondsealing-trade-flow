import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/speech-textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Truck,
  Plus,
  Package,
  MapPin,
  Navigation,
  Pencil,
} from "lucide-react";

const ORDER_STATUS_CFG: Record<
  string,
  {
    label: string;
    variant: "default" | "secondary" | "outline" | "destructive";
  }
> = {
  draft: { label: "Draft", variant: "outline" },
  submitted: { label: "Submitted", variant: "secondary" },
  confirmed: { label: "Confirmed", variant: "secondary" },
  shipped: { label: "Shipped", variant: "default" },
  delivered: { label: "Delivered", variant: "default" },
  cancelled: { label: "Cancelled", variant: "destructive" },
};

const emptySupplier = {
  name: "",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  address: "",
  suburb: "",
  website: "",
  leadTimeDays: "",
  notes: "",
};
const emptyOrder = {
  supplierId: "",
  orderDate: new Date().toISOString().split("T")[0],
  expectedDelivery: "",
  items: "",
  totalAmount: "",
  notes: "",
};

function supplierAddressLine(supplier: any) {
  return [supplier.address, supplier.suburb].filter(Boolean).join(", ");
}

function mapsSearchUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function supplierFormFromSupplier(supplier: any) {
  return {
    name: supplier?.name ?? "",
    contactName: supplier?.contactName ?? "",
    contactPhone: supplier?.contactPhone ?? "",
    contactEmail: supplier?.contactEmail ?? "",
    address: supplier?.address ?? "",
    suburb: supplier?.suburb ?? "",
    website: supplier?.website ?? "",
    leadTimeDays:
      supplier?.leadTimeDays !== null && supplier?.leadTimeDays !== undefined
        ? String(supplier.leadTimeDays)
        : "",
    notes: supplier?.notes ?? "",
  };
}

function supplierPayloadFromForm(form: typeof emptySupplier) {
  return {
    ...form,
    name: form.name.trim(),
    contactName: form.contactName.trim() || null,
    contactPhone: form.contactPhone.trim() || null,
    contactEmail: form.contactEmail.trim() || null,
    address: form.address.trim() || null,
    suburb: form.suburb.trim() || null,
    website: form.website.trim() || null,
    leadTimeDays: form.leadTimeDays ? Number(form.leadTimeDays) : null,
    notes: form.notes.trim() || null,
  };
}

export default function Suppliers() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<any | null>(null);
  const [sf, setSf] = useState({ ...emptySupplier });
  const [of, setOf] = useState({ ...emptyOrder });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => fetch("/api/supplier-profiles").then((r) => r.json()),
  });
  const { data: orders = [] } = useQuery({
    queryKey: ["supplier-orders"],
    queryFn: () => fetch("/api/supplier-orders").then((r) => r.json()),
  });

  function openSupplierDialog(supplier?: any) {
    setEditingSupplier(supplier ?? null);
    setSf(supplier ? supplierFormFromSupplier(supplier) : { ...emptySupplier });
    setSupplierOpen(true);
  }

  function closeSupplierDialog() {
    setSupplierOpen(false);
    setEditingSupplier(null);
    setSf({ ...emptySupplier });
  }

  const saveSupplierMutation = useMutation({
    mutationFn: async (data: typeof emptySupplier) => {
      const payload = supplierPayloadFromForm(data);
      const response = await fetch(
        editingSupplier
          ? `/api/supplier-profiles/${editingSupplier.id}`
          : "/api/supplier-profiles",
        {
          method: editingSupplier ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        throw new Error(
          (await response.json().catch(() => null))?.error ??
            "Could not save supplier",
        );
      }
      return response.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      qc.invalidateQueries({ queryKey: ["supplier-orders"] });
      closeSupplierDialog();
      toast({
        title: editingSupplier ? "Supplier updated" : "Supplier added",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not save supplier",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    },
  });

  const createOrderMutation = useMutation({
    mutationFn: (data: any) =>
      fetch("/api/supplier-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supplier-orders"] });
      setOrderOpen(false);
      setOf({ ...emptyOrder });
      toast({ title: "Order created" });
    },
  });

  const patchOrderMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      fetch(`/api/supplier-orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supplier-orders"] });
      toast({ title: "Order updated" });
    },
  });

  const STATUS_FLOW: Record<string, string> = {
    draft: "submitted",
    submitted: "confirmed",
    confirmed: "shipped",
    shipped: "delivered",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Suppliers</h1>
          <p className="text-muted-foreground mt-1">
            Silicone suppliers, ordering, and delivery tracking
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog open={orderOpen} onOpenChange={setOrderOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Package className="w-4 h-4 mr-2" />
                New Order
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Create Supplier Order</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div>
                  <Label>Supplier</Label>
                  <Select
                    value={of.supplierId}
                    onValueChange={(v) =>
                      setOf((p) => ({ ...p, supplierId: v }))
                    }
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select supplier…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(suppliers as any[]).map((s: any) => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Order Date</Label>
                    <Input
                      type="date"
                      className="mt-1"
                      value={of.orderDate}
                      onChange={(e) =>
                        setOf((p) => ({ ...p, orderDate: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <Label>Expected Delivery</Label>
                    <Input
                      type="date"
                      className="mt-1"
                      value={of.expectedDelivery}
                      onChange={(e) =>
                        setOf((p) => ({
                          ...p,
                          expectedDelivery: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
                <div>
                  <Label>Items (describe order)</Label>
                  <Textarea
                    className="mt-1 text-sm"
                    rows={3}
                    value={of.items}
                    onChange={(e) =>
                      setOf((p) => ({ ...p, items: e.target.value }))
                    }
                    placeholder="e.g. 48x White 600ml, 24x Sandstone 600ml…"
                  />
                </div>
                <div>
                  <Label>Total Amount ($)</Label>
                  <Input
                    type="number"
                    className="mt-1"
                    value={of.totalAmount}
                    onChange={(e) =>
                      setOf((p) => ({ ...p, totalAmount: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <Label>Notes</Label>
                  <Input
                    className="mt-1"
                    value={of.notes}
                    onChange={(e) =>
                      setOf((p) => ({ ...p, notes: e.target.value }))
                    }
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <Button
                    className="flex-1"
                    onClick={() =>
                      createOrderMutation.mutate({
                        ...of,
                        supplierId: Number(of.supplierId),
                        totalAmount: of.totalAmount
                          ? Number(of.totalAmount)
                          : undefined,
                      })
                    }
                    disabled={!of.supplierId || !of.items}
                  >
                    Create Order
                  </Button>
                  <Button variant="outline" onClick={() => setOrderOpen(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Button onClick={() => openSupplierDialog()}>
            <Plus className="w-4 h-4 mr-2" />
            Add Supplier
          </Button>
          <Dialog
            open={supplierOpen}
            onOpenChange={(open) => {
              if (open) setSupplierOpen(true);
              else closeSupplierDialog();
            }}
          >
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {editingSupplier ? "Edit Supplier" : "New Supplier"}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div>
                  <Label>Company Name</Label>
                  <Input
                    className="mt-1"
                    value={sf.name}
                    onChange={(e) =>
                      setSf((p) => ({ ...p, name: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <Label>Street Address</Label>
                  <Input
                    className="mt-1"
                    value={sf.address}
                    onChange={(e) =>
                      setSf((p) => ({ ...p, address: e.target.value }))
                    }
                    placeholder="Pickup address or supplier warehouse…"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Contact Name</Label>
                    <Input
                      className="mt-1"
                      value={sf.contactName}
                      onChange={(e) =>
                        setSf((p) => ({ ...p, contactName: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <Label>Phone</Label>
                    <Input
                      className="mt-1"
                      value={sf.contactPhone}
                      onChange={(e) =>
                        setSf((p) => ({ ...p, contactPhone: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <Label>Suburb</Label>
                    <Input
                      className="mt-1"
                      value={sf.suburb}
                      onChange={(e) =>
                        setSf((p) => ({ ...p, suburb: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <Label>Email</Label>
                    <Input
                      className="mt-1"
                      value={sf.contactEmail}
                      onChange={(e) =>
                        setSf((p) => ({ ...p, contactEmail: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <Label>Lead Time (days)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      className="mt-1"
                      value={sf.leadTimeDays}
                      onChange={(e) =>
                        setSf((p) => ({ ...p, leadTimeDays: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <div>
                  <Label>Website</Label>
                  <Input
                    className="mt-1"
                    value={sf.website}
                    onChange={(e) =>
                      setSf((p) => ({ ...p, website: e.target.value }))
                    }
                    placeholder="https://supplier.com.au"
                  />
                </div>
                <div>
                  <Label>Notes</Label>
                  <Textarea
                    className="mt-1 text-sm"
                    rows={2}
                    value={sf.notes}
                    onChange={(e) =>
                      setSf((p) => ({ ...p, notes: e.target.value }))
                    }
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <Button
                    className="flex-1"
                    onClick={() => saveSupplierMutation.mutate(sf)}
                    disabled={
                      !sf.name.trim() ||
                      saveSupplierMutation.isPending ||
                      (sf.leadTimeDays !== "" &&
                        (!Number.isFinite(Number(sf.leadTimeDays)) ||
                          Number(sf.leadTimeDays) < 0))
                    }
                  >
                    {saveSupplierMutation.isPending
                      ? "Saving..."
                      : editingSupplier
                        ? "Save Supplier"
                        : "Add Supplier"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={closeSupplierDialog}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">
            Orders ({(orders as any[]).length})
          </TabsTrigger>
          <TabsTrigger value="suppliers">
            Suppliers ({(suppliers as any[]).length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="space-y-3 mt-4">
          {(orders as any[]).map((order: any) => {
            const cfg =
              ORDER_STATUS_CFG[order.status] ?? ORDER_STATUS_CFG.draft;
            const next = STATUS_FLOW[order.status];
            return (
              <Card key={order.id}>
                <CardContent className="pt-4">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold text-sm">
                          {order.supplierName}
                        </p>
                        <Badge variant={cfg.variant} className="text-xs">
                          {cfg.label}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Ordered:{" "}
                        {new Date(order.orderDate).toLocaleDateString("en-AU")}
                        {order.expectedDelivery
                          ? ` · ETA: ${new Date(order.expectedDelivery).toLocaleDateString("en-AU")}`
                          : ""}
                        {order.deliveredAt
                          ? ` · Delivered: ${new Date(order.deliveredAt).toLocaleDateString("en-AU")}`
                          : ""}
                      </p>
                      {order.items && (
                        <p className="text-sm mt-1">{order.items}</p>
                      )}
                      {supplierAddressLine({
                        address: order.supplierAddress,
                        suburb: order.supplierSuburb,
                      }) && (
                        <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1.5">
                          <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                          <span>
                            {supplierAddressLine({
                              address: order.supplierAddress,
                              suburb: order.supplierSuburb,
                            })}
                          </span>
                        </p>
                      )}
                      {order.notes && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {order.notes}
                        </p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      {order.totalAmount && (
                        <p className="font-bold">
                          ${Number(order.totalAmount).toLocaleString()}
                        </p>
                      )}
                      {next && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2"
                          onClick={() =>
                            patchOrderMutation.mutate({
                              id: order.id,
                              data: {
                                status: next,
                                ...(next === "delivered"
                                  ? { deliveredAt: new Date().toISOString() }
                                  : {}),
                              },
                            })
                          }
                        >
                          → {ORDER_STATUS_CFG[next]?.label}
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {(orders as any[]).length === 0 && (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                No orders yet. Create one to track your supply.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent
          value="suppliers"
          className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          {(suppliers as any[]).map((s: any) => {
            const address = supplierAddressLine(s);
            return (
              <Card
                key={s.id}
                className="cursor-pointer transition-colors hover:bg-muted/30"
                onClick={() => openSupplierDialog(s)}
              >
                <CardContent className="pt-4">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Truck className="w-5 h-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold">{s.name}</p>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 shrink-0 text-muted-foreground"
                          onClick={(event) => {
                            event.stopPropagation();
                            openSupplierDialog(s);
                          }}
                          title="Edit supplier"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </div>
                      {address && (
                        <div className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
                          <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                          <span>{address}</span>
                        </div>
                      )}
                      {s.contactName && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {s.contactName}
                          {s.contactPhone ? ` · ${s.contactPhone}` : ""}
                        </p>
                      )}
                      {s.contactEmail && (
                        <p className="text-xs text-muted-foreground">
                          {s.contactEmail}
                        </p>
                      )}
                      {s.website && (
                        <p className="truncate text-xs text-muted-foreground">
                          {s.website}
                        </p>
                      )}
                      {s.leadTimeDays && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Lead time: {s.leadTimeDays} days
                        </p>
                      )}
                      {s.notes && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {s.notes}
                        </p>
                      )}
                      {address && (
                        <Button
                          asChild
                          size="sm"
                          variant="outline"
                          className="mt-3 h-8"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <a
                            href={mapsSearchUrl(address)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Navigation className="w-3.5 h-3.5 mr-1.5" />
                            Open Maps
                          </a>
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {(suppliers as any[]).length === 0 && (
            <Card className="col-span-2">
              <CardContent className="py-10 text-center text-muted-foreground">
                No suppliers added yet.
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
