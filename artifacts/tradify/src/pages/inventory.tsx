import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Package,
  AlertTriangle,
  Plus,
  ArrowDown,
  ArrowUp,
  Pencil,
  Camera,
  Sparkles,
  ScanBarcode,
  Trash2,
} from "lucide-react";

type BarcodeDetectorResult = {
  rawValue: string;
  format?: string;
};

type BarcodeDetectorInstance = {
  detect: (
    imageSource: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  ) => Promise<BarcodeDetectorResult[]>;
};

type BarcodeDetectorConstructor = {
  new (options?: { formats?: string[] }): BarcodeDetectorInstance;
  getSupportedFormats?: () => Promise<string[]>;
};

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor;
  }
}

const emptyProductForm = { name: "", unit: "tube", colour: "", barcode: "" };
const emptyIntakeForm = {
  subcontractorId: "",
  notes: "",
  imageDataList: [] as string[],
  fileName: "",
};
const emptyAdjustmentForm = {
  subcontractorId: "",
  stockItemId: "",
  currentQuantity: "",
  notes: "",
};
const emptyBarcodeForm = {
  subcontractorId: "",
  stockItemId: "",
  barcode: "",
  quantity: "1",
  notes: "",
};

const movementLabels: Record<string, string> = {
  issued: "Worker pickup",
  returned: "Returned",
  used_on_job: "Used on job",
  adjustment: "Adjustment",
  restock: "Worker pickup",
};

type IntakeSuggestion = {
  stockItemId: number | null;
  productName: string;
  colour: string | null;
  barcode?: string | null;
  unit: string;
  quantity: number | string;
  confidence?: number;
  evidence?: string;
  needsReview?: boolean;
};

function stockItemLabel(item: any) {
  return `${item.name}${item.colour ? ` - ${item.colour}` : ""} (${item.unit})${item.barcode ? ` · ${item.barcode}` : ""}`;
}

function normalizeBarcode(value: unknown) {
  return String(value ?? "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .trim();
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.readAsDataURL(file);
  });
}

async function readStockIntakeImage(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please upload a stock or receipt photo image.");
  }

  const dataUrl = await readFileAsDataUrl(file);
  return new Promise<string>((resolve) => {
    const image = new Image();
    image.onload = () => {
      const maxSide = 1600;
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return resolve(dataUrl);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}

export default function Inventory() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const barcodeVideoRef = useRef<HTMLVideoElement | null>(null);
  const barcodeStreamRef = useRef<MediaStream | null>(null);
  const [txOpen, setTxOpen] = useState(false);
  const [productOpen, setProductOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const [barcodeCameraActive, setBarcodeCameraActive] = useState(false);
  const [intakeFileLoading, setIntakeFileLoading] = useState(false);
  const [barcodeFileLoading, setBarcodeFileLoading] = useState(false);
  const [txForm, setTxForm] = useState({
    subcontractorId: "",
    stockItemId: "",
    quantity: "",
    transactionType: "issued",
    notes: "",
  });
  const [productForm, setProductForm] = useState({ ...emptyProductForm });
  const [adjustForm, setAdjustForm] = useState({ ...emptyAdjustmentForm });
  const [intakeForm, setIntakeForm] = useState({ ...emptyIntakeForm });
  const [barcodeForm, setBarcodeForm] = useState({ ...emptyBarcodeForm });
  const [intakeSuggestions, setIntakeSuggestions] = useState<
    IntakeSuggestion[]
  >([]);
  const [filterSub, setFilterSub] = useState("all");

  useEffect(() => {
    if (!barcodeOpen) stopBarcodeScanner();
  }, [barcodeOpen]);

  useEffect(() => {
    if (!barcodeCameraActive || !window.BarcodeDetector) return;
    let cancelled = false;
    const detector = new window.BarcodeDetector({
      formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39"],
    });

    async function scanFrame() {
      const video = barcodeVideoRef.current;
      if (!cancelled && video && video.readyState >= 2) {
        try {
          const results = await detector.detect(video);
          const scanned = results[0]?.rawValue;
          if (scanned) {
            handleScannedBarcode(scanned);
            stopBarcodeScanner();
            toast({ title: "Barcode scanned" });
            return;
          }
        } catch {
          stopBarcodeScanner();
          toast({
            title: "Barcode scanner stopped",
            description: "Try taking a barcode photo or enter it manually.",
            variant: "destructive",
          });
          return;
        }
      }
      if (!cancelled) window.requestAnimationFrame(scanFrame);
    }

    const frameId = window.requestAnimationFrame(scanFrame);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
    };
  }, [barcodeCameraActive]);

  const { data: items = [] } = useQuery({
    queryKey: ["sub-inventory"],
    queryFn: () => fetch("/api/sub-inventory").then((r) => r.json()),
  });
  const { data: transactions = [] } = useQuery({
    queryKey: ["sub-inventory-transactions"],
    queryFn: () => fetch("/api/inventory-transactions").then((r) => r.json()),
  });
  const { data: restockRequests = [] } = useQuery({
    queryKey: ["restock-requests"],
    queryFn: () => fetch("/api/restock-requests").then((r) => r.json()),
  });
  const { data: subs = [] } = useQuery({
    queryKey: ["subcontractors"],
    queryFn: () => fetch("/api/subcontractors").then((r) => r.json()),
  });
  const { data: stockItems = [] } = useQuery({
    queryKey: ["stock-items"],
    queryFn: () => fetch("/api/stock-items").then((r) => r.json()),
  });

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
      if (!response.ok)
        throw new Error(
          (await response.json().catch(() => null))?.error ??
            "Could not record inventory transaction",
        );
      return response.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sub-inventory"] });
      qc.invalidateQueries({ queryKey: ["sub-inventory-transactions"] });
      setTxForm({
        subcontractorId: "",
        stockItemId: "",
        quantity: "",
        transactionType: "issued",
        notes: "",
      });
      setTxOpen(false);
      toast({ title: "Worker stock updated" });
    },
    onError: (error) => {
      toast({
        title: "Could not update inventory",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    },
  });

  const createProductMutation = useMutation({
    mutationFn: async (data: typeof productForm) => {
      const response = await fetch("/api/stock-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          unit: data.unit,
          colour: data.colour || undefined,
          barcode: data.barcode || undefined,
          currentStock: 0,
        }),
      });
      if (!response.ok)
        throw new Error(
          (await response.json().catch(() => null))?.error ??
            "Could not add product type",
        );
      return response.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock-items"] });
      setProductForm({ ...emptyProductForm });
      setProductOpen(false);
      toast({ title: "Product type added" });
    },
    onError: (error) => {
      toast({
        title: "Could not add product type",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    },
  });

  const analyseStockIntakeMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/inventory-stock-intake/analyse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataList: intakeForm.imageDataList,
          notes: intakeForm.notes || undefined,
        }),
      });
      if (!response.ok)
        throw new Error(
          (await response.json().catch(() => null))?.error ??
            "Could not read stock photo",
        );
      return response.json() as Promise<{ suggestions: IntakeSuggestion[] }>;
    },
    onSuccess: (data) => {
      setIntakeSuggestions(data.suggestions ?? []);
      toast({
        title:
          (data.suggestions ?? []).length > 0
            ? "Stock lines detected"
            : "No stock lines found",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not read stock photo",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    },
  });

  const applyStockIntakeMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/inventory-stock-intake/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subcontractorId: Number(intakeForm.subcontractorId),
          sourceNote: intakeForm.notes || intakeForm.fileName || undefined,
          lines: intakeSuggestions.map((line) => ({
            ...line,
            quantity: Number(line.quantity),
            barcode: line.barcode || undefined,
          })),
        }),
      });
      if (!response.ok)
        throw new Error(
          (await response.json().catch(() => null))?.error ??
            "Could not add stock",
        );
      return response.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sub-inventory"] });
      qc.invalidateQueries({ queryKey: ["sub-inventory-transactions"] });
      qc.invalidateQueries({ queryKey: ["stock-items"] });
      setIntakeForm({ ...emptyIntakeForm });
      setIntakeSuggestions([]);
      setIntakeOpen(false);
      toast({ title: "Stock added to employee/subcontractor" });
    },
    onError: (error) => {
      toast({
        title: "Could not add stock",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    },
  });

  const adjustStockMutation = useMutation({
    mutationFn: async (data: typeof adjustForm) => {
      const response = await fetch(
        `/api/sub-inventory/${data.subcontractorId}/${data.stockItemId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currentQuantity: Number(data.currentQuantity),
            referenceNote: data.notes || undefined,
          }),
        },
      );
      if (!response.ok)
        throw new Error(
          (await response.json().catch(() => null))?.error ??
            "Could not set worker stock quantity",
        );
      return response.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sub-inventory"] });
      qc.invalidateQueries({ queryKey: ["sub-inventory-transactions"] });
      setAdjustForm({ ...emptyAdjustmentForm });
      setAdjustOpen(false);
      toast({ title: "Worker stock quantity set" });
    },
    onError: (error) => {
      toast({
        title: "Could not set quantity",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    },
  });

  const barcodeStockMutation = useMutation({
    mutationFn: async (data: typeof barcodeForm) => {
      const barcode = normalizeBarcode(data.barcode);
      const stockItemId = Number(data.stockItemId);
      const selectedItem = (stockItems as any[]).find(
        (item: any) => item.id === stockItemId,
      );
      if (!barcode) throw new Error("Scan or enter a barcode first");
      if (!selectedItem) throw new Error("Select the product this barcode is for");

      if (normalizeBarcode(selectedItem.barcode) !== barcode) {
        const linkResponse = await fetch(`/api/stock-items/${stockItemId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ barcode }),
        });
        if (!linkResponse.ok) {
          throw new Error(
            (await linkResponse.json().catch(() => null))?.error ??
              "Could not link barcode to product",
          );
        }
      }

      const response = await fetch("/api/inventory-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subcontractorId: Number(data.subcontractorId),
          stockItemId,
          quantity: Number(data.quantity),
          transactionType: "issued",
          referenceNote:
            data.notes ||
            `Barcode stock count ${barcode}${selectedItem.name ? ` - ${selectedItem.name}` : ""}`,
          recordedBy: "admin-barcode-scan",
        }),
      });
      if (!response.ok)
        throw new Error(
          (await response.json().catch(() => null))?.error ??
            "Could not record barcode stock",
        );
      return response.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sub-inventory"] });
      qc.invalidateQueries({ queryKey: ["sub-inventory-transactions"] });
      qc.invalidateQueries({ queryKey: ["stock-items"] });
      setBarcodeForm({ ...emptyBarcodeForm });
      setBarcodeOpen(false);
      toast({ title: "Barcode stock recorded" });
    },
    onError: (error) => {
      toast({
        title: "Could not record barcode stock",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    },
  });

  const approveRestockMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      fetch(`/api/restock-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["restock-requests"] });
      toast({ title: "Restock request updated" });
    },
  });

  const activeSubs = (subs as any[]).filter((s: any) => s.active);
  const lowStock = (items as any[]).filter(
    (i: any) => Number(i.currentQuantity) <= 0,
  );
  const filteredItems =
    filterSub === "all"
      ? (items as any[])
      : (items as any[]).filter(
          (i: any) => String(i.subcontractorId) === filterSub,
        );
  const selectedAdjustmentItem = (items as any[]).find(
    (item: any) =>
      String(item.subcontractorId) === adjustForm.subcontractorId &&
      String(item.stockItemId) === adjustForm.stockItemId,
  );
  const selectedAdjustmentProduct = (stockItems as any[]).find(
    (item: any) => String(item.id) === adjustForm.stockItemId,
  );
  const scannedBarcode = normalizeBarcode(barcodeForm.barcode);
  const barcodeMatchedProduct = scannedBarcode
    ? (stockItems as any[]).find(
        (item: any) => normalizeBarcode(item.barcode) === scannedBarcode,
      )
    : null;
  const barcodeSelectedProduct = (stockItems as any[]).find(
    (item: any) => String(item.id) === barcodeForm.stockItemId,
  );
  const barcodeDetectorAvailable =
    typeof window !== "undefined" && Boolean(window.BarcodeDetector);
  const barcodeCanApply =
    Boolean(barcodeForm.subcontractorId) &&
    Boolean(barcodeForm.stockItemId) &&
    Boolean(scannedBarcode) &&
    Number(barcodeForm.quantity) > 0;
  const intakeCanApply =
    Boolean(intakeForm.subcontractorId) &&
    intakeSuggestions.length > 0 &&
    intakeSuggestions.every(
      (line) =>
        line.productName.trim() &&
        Number(line.quantity) > 0 &&
        line.unit.trim(),
    );

  async function handleStockIntakeFile(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.currentTarget.value = "";
    if (files.length === 0) return;
    setIntakeFileLoading(true);
    try {
      const imageDataList = await Promise.all(
        files.slice(0, 8).map(readStockIntakeImage),
      );
      setIntakeForm((form) => ({
        ...form,
        imageDataList: [...form.imageDataList, ...imageDataList].slice(0, 8),
        fileName:
          files.length === 1
            ? files[0].name
            : `${files.length} stock photos selected`,
      }));
      setIntakeSuggestions([]);
    } catch (error) {
      toast({
        title: "Could not load photo",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setIntakeFileLoading(false);
    }
  }

  function handleScannedBarcode(rawValue: string) {
    const barcode = normalizeBarcode(rawValue);
    if (!barcode) return;
    const matched = (stockItems as any[]).find(
      (item: any) => normalizeBarcode(item.barcode) === barcode,
    );
    setBarcodeForm((form) => ({
      ...form,
      barcode,
      stockItemId: matched ? String(matched.id) : form.stockItemId,
    }));
  }

  function stopBarcodeScanner() {
    barcodeStreamRef.current?.getTracks().forEach((track) => track.stop());
    barcodeStreamRef.current = null;
    if (barcodeVideoRef.current) barcodeVideoRef.current.srcObject = null;
    setBarcodeCameraActive(false);
  }

  async function startBarcodeScanner() {
    if (!window.BarcodeDetector) {
      toast({
        title: "Barcode scanning unavailable",
        description: "Take a barcode photo or enter the barcode manually.",
        variant: "destructive",
      });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      toast({
        title: "Camera unavailable",
        description: "Use barcode photo upload or manual entry.",
        variant: "destructive",
      });
      return;
    }
    try {
      stopBarcodeScanner();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      barcodeStreamRef.current = stream;
      if (barcodeVideoRef.current) {
        barcodeVideoRef.current.srcObject = stream;
        await barcodeVideoRef.current.play();
      }
      setBarcodeCameraActive(true);
    } catch (error) {
      toast({
        title: "Could not start camera",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    }
  }

  async function handleBarcodePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!window.BarcodeDetector) {
      toast({
        title: "Barcode photo scanning unavailable",
        description: "Enter the barcode manually on this device.",
        variant: "destructive",
      });
      return;
    }
    setBarcodeFileLoading(true);
    try {
      const imageData = await readStockIntakeImage(file);
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Could not read barcode photo"));
        image.src = imageData;
      });
      const detector = new window.BarcodeDetector({
        formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39"],
      });
      const results = await detector.detect(image);
      const scanned = results[0]?.rawValue;
      if (!scanned) throw new Error("No barcode detected in that photo");
      handleScannedBarcode(scanned);
      toast({ title: "Barcode read from photo" });
    } catch (error) {
      toast({
        title: "Could not read barcode photo",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setBarcodeFileLoading(false);
    }
  }

  function updateIntakeSuggestion(
    index: number,
    updates: Partial<IntakeSuggestion>,
  ) {
    setIntakeSuggestions((lines) =>
      lines.map((line, lineIndex) =>
        lineIndex === index ? { ...line, ...updates } : line,
      ),
    );
  }

  function selectIntakeStockItem(index: number, value: string) {
    if (value === "new") {
      updateIntakeSuggestion(index, { stockItemId: null });
      return;
    }
    const item = (stockItems as any[]).find(
      (stockItem: any) => String(stockItem.id) === value,
    );
    if (!item) return;
    updateIntakeSuggestion(index, {
      stockItemId: item.id,
      productName: item.name,
      colour: item.colour ?? null,
      barcode: item.barcode ?? null,
      unit: item.unit,
      needsReview: false,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Worker Stock</h1>
          <p className="text-muted-foreground mt-1">
            Stock is recorded against the employee/subcontractor who picked it
            up from a supplier.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Dialog open={productOpen} onOpenChange={setProductOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Plus className="w-4 h-4 mr-2" />
                Add Product Type
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Add Product Type</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div>
                  <Label>Product name</Label>
                  <Input
                    className="mt-1"
                    value={productForm.name}
                    onChange={(e) =>
                      setProductForm((p) => ({ ...p, name: e.target.value }))
                    }
                    placeholder="e.g. Sikasil"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Unit</Label>
                    <Select
                      value={productForm.unit}
                      onValueChange={(v) =>
                        setProductForm((p) => ({ ...p, unit: v }))
                      }
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="z-[100] max-h-72">
                        <SelectItem value="tube">Tube</SelectItem>
                        <SelectItem value="sausage">Sausage</SelectItem>
                        <SelectItem value="box">Box</SelectItem>
                        <SelectItem value="roll">Roll</SelectItem>
                        <SelectItem value="litre">Litre</SelectItem>
                        <SelectItem value="each">Each</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Colour</Label>
                    <Input
                      className="mt-1"
                      value={productForm.colour}
                      onChange={(e) =>
                        setProductForm((p) => ({
                          ...p,
                          colour: e.target.value,
                        }))
                      }
                      placeholder="e.g. White"
                    />
                  </div>
                </div>
                <div>
                  <Label>Barcode</Label>
                  <Input
                    className="mt-1"
                    value={productForm.barcode}
                    onChange={(e) =>
                      setProductForm((p) => ({
                        ...p,
                        barcode: normalizeBarcode(e.target.value),
                      }))
                    }
                    placeholder="Optional barcode number"
                  />
                </div>
                <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  This creates a product type only. Stock quantity is recorded
                  when a worker picks it up.
                </p>
                <div className="flex gap-2 pt-2">
                  <Button
                    className="flex-1"
                    onClick={() => createProductMutation.mutate(productForm)}
                    disabled={
                      !productForm.name.trim() ||
                      createProductMutation.isPending
                    }
                  >
                    {createProductMutation.isPending
                      ? "Adding..."
                      : "Add Product"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setProductOpen(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Pencil className="w-4 h-4 mr-2" />
                Set Quantity
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Set Worker Stock Quantity</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div>
                  <Label>Employee/Subcontractor</Label>
                  <Select
                    value={adjustForm.subcontractorId}
                    onValueChange={(v) =>
                      setAdjustForm((p) => ({ ...p, subcontractorId: v }))
                    }
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select employee/subcontractor..." />
                    </SelectTrigger>
                    <SelectContent className="z-[100] max-h-72">
                      {activeSubs.map((s: any) => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Product</Label>
                  <Select
                    value={adjustForm.stockItemId}
                    onValueChange={(v) =>
                      setAdjustForm((p) => ({ ...p, stockItemId: v }))
                    }
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select product..." />
                    </SelectTrigger>
                    <SelectContent className="z-[100] max-h-72">
                      {(stockItems as any[]).map((item: any) => (
                        <SelectItem key={item.id} value={String(item.id)}>
                          {item.name}
                          {item.colour ? ` - ${item.colour}` : ""} ({item.unit})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {adjustForm.subcontractorId && adjustForm.stockItemId ? (
                  <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                    Current recorded:{" "}
                    <span className="font-semibold">
                      {selectedAdjustmentItem?.currentQuantity ?? 0}{" "}
                      {selectedAdjustmentItem?.unit ??
                        selectedAdjustmentProduct?.unit ??
                        "unit"}
                    </span>
                  </div>
                ) : null}
                <div>
                  <Label>Correct quantity now</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    className="mt-1"
                    value={adjustForm.currentQuantity}
                    onChange={(e) =>
                      setAdjustForm((p) => ({
                        ...p,
                        currentQuantity: e.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <Label>Reason / note</Label>
                  <Input
                    className="mt-1"
                    value={adjustForm.notes}
                    onChange={(e) =>
                      setAdjustForm((p) => ({ ...p, notes: e.target.value }))
                    }
                    placeholder="e.g. stocktake correction"
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <Button
                    className="flex-1"
                    onClick={() => adjustStockMutation.mutate(adjustForm)}
                    disabled={
                      !adjustForm.subcontractorId ||
                      !adjustForm.stockItemId ||
                      adjustForm.currentQuantity === "" ||
                      Number(adjustForm.currentQuantity) < 0 ||
                      adjustStockMutation.isPending
                    }
                  >
                    {adjustStockMutation.isPending
                      ? "Saving..."
                      : "Set Quantity"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setAdjustOpen(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={barcodeOpen} onOpenChange={setBarcodeOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <ScanBarcode className="w-4 h-4 mr-2" />
                Scan Barcode
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Barcode Stock Count</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div>
                  <Label>Employee/Subcontractor</Label>
                  <Select
                    value={barcodeForm.subcontractorId}
                    onValueChange={(v) =>
                      setBarcodeForm((p) => ({ ...p, subcontractorId: v }))
                    }
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select employee/subcontractor..." />
                    </SelectTrigger>
                    <SelectContent className="z-[100] max-h-72">
                      {activeSubs.map((s: any) => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="rounded-md border bg-muted/20 p-3">
                  <video
                    ref={barcodeVideoRef}
                    className="aspect-video w-full rounded-md bg-black object-cover"
                    muted
                    playsInline
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant={barcodeCameraActive ? "secondary" : "default"}
                      onClick={
                        barcodeCameraActive
                          ? stopBarcodeScanner
                          : startBarcodeScanner
                      }
                    >
                      <ScanBarcode className="w-4 h-4 mr-2" />
                      {barcodeCameraActive ? "Stop scanner" : "Start scanner"}
                    </Button>
                    <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-muted">
                      <Camera className="h-4 w-4" />
                      {barcodeFileLoading ? "Reading..." : "Barcode photo"}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={handleBarcodePhoto}
                        disabled={barcodeFileLoading}
                      />
                    </label>
                  </div>
                  {!barcodeDetectorAvailable ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      This browser does not support automatic barcode detection.
                    </p>
                  ) : null}
                </div>

                <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
                  <div>
                    <Label>Barcode</Label>
                    <Input
                      className="mt-1"
                      value={barcodeForm.barcode}
                      onChange={(e) => handleScannedBarcode(e.target.value)}
                      placeholder="Scan or enter barcode"
                    />
                  </div>
                  <div>
                    <Label>Quantity</Label>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      className="mt-1"
                      value={barcodeForm.quantity}
                      onChange={(e) =>
                        setBarcodeForm((p) => ({
                          ...p,
                          quantity: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>

                {barcodeMatchedProduct ? (
                  <div className="rounded-md border bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-950/20 dark:text-green-300">
                    Matched product: {stockItemLabel(barcodeMatchedProduct)}
                  </div>
                ) : scannedBarcode ? (
                  <div className="rounded-md border bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                    Barcode not linked yet. Select the matching product below.
                  </div>
                ) : null}

                <div>
                  <Label>Product</Label>
                  <Select
                    value={barcodeForm.stockItemId}
                    onValueChange={(v) =>
                      setBarcodeForm((p) => ({ ...p, stockItemId: v }))
                    }
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select product..." />
                    </SelectTrigger>
                    <SelectContent className="z-[100] max-h-72">
                      {(stockItems as any[]).map((item: any) => (
                        <SelectItem key={item.id} value={String(item.id)}>
                          {stockItemLabel(item)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {barcodeSelectedProduct &&
                  scannedBarcode &&
                  normalizeBarcode(barcodeSelectedProduct.barcode) !==
                    scannedBarcode ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Saving will link this barcode to the selected product.
                    </p>
                  ) : null}
                </div>

                <div>
                  <Label>Notes</Label>
                  <Input
                    className="mt-1"
                    value={barcodeForm.notes}
                    onChange={(e) =>
                      setBarcodeForm((p) => ({ ...p, notes: e.target.value }))
                    }
                    placeholder="Supplier pickup, stocktake count..."
                  />
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    className="flex-1"
                    onClick={() => barcodeStockMutation.mutate(barcodeForm)}
                    disabled={
                      !barcodeCanApply || barcodeStockMutation.isPending
                    }
                  >
                    {barcodeStockMutation.isPending
                      ? "Recording..."
                      : "Add Stock from Barcode"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setBarcodeOpen(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={intakeOpen} onOpenChange={setIntakeOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Camera className="w-4 h-4 mr-2" />
                Photo Stock Intake
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Photo Stock Intake</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div>
                  <Label>Employee/Subcontractor</Label>
                  <Select
                    value={intakeForm.subcontractorId}
                    onValueChange={(v) =>
                      setIntakeForm((p) => ({ ...p, subcontractorId: v }))
                    }
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select employee/subcontractor..." />
                    </SelectTrigger>
                    <SelectContent className="z-[100] max-h-72">
                      {activeSubs.map((s: any) => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border-2 border-dashed border-muted-foreground/30 bg-background px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted">
                    <Camera className="h-4 w-4" />
                    {intakeFileLoading
                      ? "Loading photo..."
                      : intakeForm.fileName || "Take photos / upload receipt"}
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      multiple
                      className="hidden"
                      onChange={handleStockIntakeFile}
                    />
                  </label>
                  <Button
                    type="button"
                    onClick={() => analyseStockIntakeMutation.mutate()}
                    disabled={
                      intakeForm.imageDataList.length === 0 ||
                      intakeFileLoading ||
                      analyseStockIntakeMutation.isPending
                    }
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    {analyseStockIntakeMutation.isPending
                      ? "Reading..."
                      : "Read Stock"}
                  </Button>
                </div>

                {intakeForm.imageDataList.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-3">
                    {intakeForm.imageDataList.map((imageData, index) => (
                      <div key={`${imageData.slice(0, 24)}-${index}`} className="relative">
                        <img
                          src={imageData}
                          alt={`Stock intake preview ${index + 1}`}
                          className="h-32 w-full rounded-md border object-contain"
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="absolute right-2 top-2 h-7 px-2 text-xs"
                          onClick={() => {
                            setIntakeForm((form) => ({
                              ...form,
                              imageDataList: form.imageDataList.filter(
                                (_image, imageIndex) => imageIndex !== index,
                              ),
                              fileName:
                                form.imageDataList.length <= 1
                                  ? ""
                                  : `${form.imageDataList.length - 1} stock photos selected`,
                            }));
                            setIntakeSuggestions([]);
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div>
                  <Label>Receipt / pickup note</Label>
                  <Input
                    className="mt-1"
                    value={intakeForm.notes}
                    onChange={(e) =>
                      setIntakeForm((p) => ({ ...p, notes: e.target.value }))
                    }
                    placeholder="Supplier, receipt number, pickup note..."
                  />
                </div>

                {intakeSuggestions.length > 0 ? (
                  <div className="space-y-3">
                    {intakeSuggestions.map((line, index) => (
                      <div
                        key={`${line.productName}-${index}`}
                        className="space-y-3 rounded-md border bg-muted/20 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold">
                              Stock line {index + 1}
                            </p>
                            {line.evidence ? (
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {line.evidence}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-2">
                            {line.needsReview ? (
                              <Badge variant="outline" className="text-xs">
                                review
                              </Badge>
                            ) : null}
                            {line.confidence !== undefined ? (
                              <Badge variant="secondary" className="text-xs">
                                {Math.round(Number(line.confidence) * 100)}%
                              </Badge>
                            ) : null}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() =>
                                setIntakeSuggestions((lines) =>
                                  lines.filter(
                                    (_line, lineIndex) => lineIndex !== index,
                                  ),
                                )
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>

                        <div>
                          <Label className="text-xs">Existing product</Label>
                          <Select
                            value={
                              line.stockItemId
                                ? String(line.stockItemId)
                                : "new"
                            }
                            onValueChange={(value) =>
                              selectIntakeStockItem(index, value)
                            }
                          >
                            <SelectTrigger className="mt-1">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="z-[100] max-h-72">
                              <SelectItem value="new">
                                New product / unmatched
                              </SelectItem>
                              {(stockItems as any[]).map((item: any) => (
                                <SelectItem
                                  key={item.id}
                                  value={String(item.id)}
                                >
                                  {stockItemLabel(item)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-[1fr_8rem_8rem]">
                          <div>
                            <Label className="text-xs">Product name</Label>
                            <Input
                              className="mt-1"
                              value={line.productName}
                              onChange={(e) =>
                                updateIntakeSuggestion(index, {
                                  productName: e.target.value,
                                  stockItemId: null,
                                })
                              }
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Colour</Label>
                            <Input
                              className="mt-1"
                              value={line.colour ?? ""}
                              onChange={(e) =>
                                updateIntakeSuggestion(index, {
                                  colour: e.target.value,
                                  stockItemId: null,
                                })
                              }
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Quantity</Label>
                            <Input
                              type="number"
                              min="0.01"
                              step="0.01"
                              className="mt-1"
                              value={line.quantity}
                              onChange={(e) =>
                                updateIntakeSuggestion(index, {
                                  quantity: e.target.value,
                                })
                              }
                            />
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
                          <div>
                            <Label className="text-xs">Barcode</Label>
                            <Input
                              className="mt-1"
                              value={line.barcode ?? ""}
                              onChange={(e) =>
                                updateIntakeSuggestion(index, {
                                  barcode: normalizeBarcode(e.target.value),
                                })
                              }
                              placeholder="Optional barcode"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Unit</Label>
                            <Select
                              value={line.unit}
                              onValueChange={(value) =>
                                updateIntakeSuggestion(index, {
                                  unit: value,
                                  stockItemId: null,
                                })
                              }
                            >
                              <SelectTrigger className="mt-1">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="z-[100] max-h-72">
                                <SelectItem value="tube">Tube</SelectItem>
                                <SelectItem value="sausage">Sausage</SelectItem>
                                <SelectItem value="box">Box</SelectItem>
                                <SelectItem value="roll">Roll</SelectItem>
                                <SelectItem value="litre">Litre</SelectItem>
                                <SelectItem value="each">Each</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    ))}

                    <Button
                      className="w-full"
                      onClick={() => applyStockIntakeMutation.mutate()}
                      disabled={
                        !intakeCanApply || applyStockIntakeMutation.isPending
                      }
                    >
                      {applyStockIntakeMutation.isPending
                        ? "Adding stock..."
                        : "Add Stock to Selected Employee/Subcontractor"}
                    </Button>
                  </div>
                ) : null}
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={txOpen} onOpenChange={setTxOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Record Pickup
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Record Worker Stock</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div>
                  <Label>Employee/Subcontractor</Label>
                  <Select
                    value={txForm.subcontractorId}
                    onValueChange={(v) =>
                      setTxForm((p) => ({ ...p, subcontractorId: v }))
                    }
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select employee/subcontractor..." />
                    </SelectTrigger>
                    <SelectContent className="z-[100] max-h-72">
                      {activeSubs.map((s: any) => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Product</Label>
                    <Select
                      value={txForm.stockItemId}
                      onValueChange={(v) =>
                        setTxForm((p) => ({ ...p, stockItemId: v }))
                      }
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select product..." />
                      </SelectTrigger>
                      <SelectContent className="z-[100] max-h-72">
                        {(stockItems as any[]).map((item: any) => (
                          <SelectItem key={item.id} value={String(item.id)}>
                            {item.name}
                            {item.colour ? ` - ${item.colour}` : ""} (
                            {item.unit})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Quantity</Label>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      className="mt-1"
                      value={txForm.quantity}
                      onChange={(e) =>
                        setTxForm((p) => ({ ...p, quantity: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <div>
                  <Label>Movement</Label>
                  <Select
                    value={txForm.transactionType}
                    onValueChange={(v) =>
                      setTxForm((p) => ({ ...p, transactionType: v }))
                    }
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[100] max-h-72">
                      <SelectItem value="issued">
                        Worker picked up from supplier
                      </SelectItem>
                      <SelectItem value="returned">
                        Returned or transferred back
                      </SelectItem>
                      <SelectItem value="used_on_job">Used on job</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Notes</Label>
                  <Input
                    className="mt-1"
                    value={txForm.notes}
                    onChange={(e) =>
                      setTxForm((p) => ({ ...p, notes: e.target.value }))
                    }
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <Button
                    className="flex-1"
                    onClick={() => txMutation.mutate(txForm)}
                    disabled={
                      !txForm.subcontractorId ||
                      !txForm.stockItemId ||
                      Number(txForm.quantity) <= 0
                    }
                  >
                    Record
                  </Button>
                  <Button variant="outline" onClick={() => setTxOpen(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Low stock alert */}
      {lowStock.length > 0 && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 dark:bg-red-950/20 dark:border-red-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-700 dark:text-red-400">
              Worker stock alert — {lowStock.length} items
            </p>
            <p className="text-xs text-red-600 dark:text-red-500">
              {lowStock
                .map(
                  (i: any) =>
                    `${i.subcontractorName}: ${i.stockItemName} (${i.currentQuantity} ${i.unit ?? "unit"} left)`,
                )
                .join(" · ")}
            </p>
          </div>
        </div>
      )}

      <Tabs defaultValue="stock">
        <TabsList>
          <TabsTrigger value="stock">Worker Stock</TabsTrigger>
          <TabsTrigger value="transactions">Pickups & Usage</TabsTrigger>
          <TabsTrigger value="restock">
            Stock Requests (
            {
              (restockRequests as any[]).filter((r: any) =>
                ["pending", "approved"].includes(r.status),
              ).length
            }
            )
          </TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="mt-4">
          <div className="flex items-center gap-3 mb-4">
            <Select value={filterSub} onValueChange={setFilterSub}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[100] max-h-72">
                <SelectItem value="all">
                  All Employees/Subcontractors
                </SelectItem>
                {activeSubs.map((s: any) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-3">
            {filteredItems.map((item: any) => (
              <Card
                key={item.id}
                className={
                  Number(item.currentQuantity) <= 0
                    ? "border-red-200 dark:border-red-800"
                    : ""
                }
              >
                <CardContent className="pt-4">
                  <div className="flex items-center gap-4">
                    <Package className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1">
                      <p className="font-medium text-sm">
                        {item.stockItemName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.subcontractorName} ·{" "}
                        {item.colour ?? "No colour recorded"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p
                        className={`text-2xl font-bold ${Number(item.currentQuantity) <= 0 ? "text-red-600" : ""}`}
                      >
                        {item.currentQuantity}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.unit ?? "unit"}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 flex-shrink-0"
                      title="Set quantity"
                      onClick={() => {
                        setAdjustForm({
                          subcontractorId: String(item.subcontractorId),
                          stockItemId: String(item.stockItemId),
                          currentQuantity: String(item.currentQuantity),
                          notes: "",
                        });
                        setAdjustOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {Number(item.currentQuantity) <= 0 && (
                      <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
            {filteredItems.length === 0 && (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground">
                  No worker stock records yet. Record a pickup when stock is
                  collected from a supplier.
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="transactions" className="mt-4 space-y-2">
          {(transactions as any[]).slice(0, 50).map((tx: any) => {
            const quantity = Number(tx.quantity);
            const incoming =
              tx.transactionType === "adjustment"
                ? quantity >= 0
                : tx.transactionType === "issued" ||
                  tx.transactionType === "restock";
            const signedQuantity =
              tx.transactionType === "adjustment"
                ? quantity
                : incoming
                  ? quantity
                  : -Math.abs(quantity);
            return (
              <div
                key={tx.id}
                className="flex items-center gap-3 p-3 rounded-lg border"
              >
                {incoming ? (
                  <ArrowDown className="w-4 h-4 text-green-600" />
                ) : (
                  <ArrowUp className="w-4 h-4 text-amber-500" />
                )}
                <div className="flex-1 text-sm">
                  <span className="font-medium">{tx.subcontractorName}</span> —{" "}
                  {tx.stockItemName}
                  {tx.referenceNote && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {tx.referenceNote}
                    </span>
                  )}
                </div>
                <Badge variant="outline" className="text-xs">
                  {movementLabels[tx.transactionType] ??
                    String(tx.transactionType).replaceAll("_", " ")}
                </Badge>
                <span className="font-semibold text-sm w-10 text-right">
                  {signedQuantity > 0 ? "+" : ""}
                  {signedQuantity}
                </span>
                <span className="text-xs text-muted-foreground w-24 text-right">
                  {new Date(tx.createdAt).toLocaleDateString("en-AU")}
                </span>
              </div>
            );
          })}
          {(transactions as any[]).length === 0 && (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                No transactions recorded yet.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="restock" className="mt-4 space-y-3">
          {(restockRequests as any[]).map((r: any) => (
            <Card key={r.id}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <p className="font-medium text-sm">
                      {r.subcontractorName} — {r.stockItemName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Requested qty: {r.quantityRequested}
                      {r.subNotes ? ` · ${r.subNotes}` : ""}
                    </p>
                  </div>
                  {r.status !== "pending" ? (
                    <Badge className="text-xs capitalize">{r.status}</Badge>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() =>
                          approveRestockMutation.mutate({
                            id: r.id,
                            status: "approved",
                          })
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          approveRestockMutation.mutate({
                            id: r.id,
                            status: "rejected",
                          })
                        }
                      >
                        Decline
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {(restockRequests as any[]).length === 0 && (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                No restock requests.
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
