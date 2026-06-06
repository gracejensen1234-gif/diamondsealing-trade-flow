import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ChangeEvent,
} from "react";
import { Link, useLocation } from "wouter";
import {
  useListSubcontractors,
  useGetTodaySession,
  useClockOn,
  useClockOff,
  useStartBreak,
  useEndBreak,
  useListDispatch,
  useMarkArrived,
  useMarkDeparted,
  useUpdateJobAssignment,
  getGetTodaySessionQueryKey,
  getListDispatchQueryKey,
  type WorkSession,
} from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/speech-textarea";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { PhoneSetupCard } from "@/components/phone-setup-card";
import {
  currentPushPermission,
  type PushPermissionState,
} from "@/lib/push-notifications";
import {
  CREDENTIAL_TYPES,
  type WorkerCredential,
  compressCredentialImage,
  credentialLabel,
  emptyCredentialDraft,
} from "@/lib/worker-credentials";
import {
  type LeaveRequest,
  dateFromInputValue,
  dateInputValue,
  formatDayOffDate,
  leaveStatusBadgeVariant,
  leaveStatusLabel,
  todayDateInputValue,
} from "@/lib/leave-requests";
import {
  MapPin,
  Clock,
  RotateCcw,
  AlertTriangle,
  Play,
  Square,
  Pause,
  Bell,
  BellOff,
  X,
  ChevronLeft,
  ChevronRight,
  Navigation,
  CheckCircle2,
  XCircle,
  CalendarDays,
  FileCheck2,
  ImageIcon,
  Send,
  Trash2,
  Upload,
  Package,
  ArrowDown,
  ArrowUp,
  DollarSign,
  Receipt,
  Home as HomeIcon,
  ListChecks,
} from "lucide-react";

const timeWindowLabels: Record<string, string> = {
  full_day: "Full day",
  morning: "Morning",
  afternoon: "Afternoon",
  custom: "Custom time",
};

type FieldSection =
  | "home"
  | "schedule"
  | "time_off"
  | "inventory"
  | "earnings"
  | "documents";

const fieldSections: Array<{
  id: FieldSection;
  label: string;
  icon: typeof HomeIcon;
  workerOnly?: boolean;
}> = [
  { id: "home", label: "Home", icon: HomeIcon },
  { id: "schedule", label: "Jobs", icon: CalendarDays },
  { id: "time_off", label: "Time Off", icon: Send, workerOnly: true },
  { id: "inventory", label: "Stock", icon: Package },
  { id: "earnings", label: "Pay", icon: Receipt, workerOnly: true },
  { id: "documents", label: "Docs", icon: FileCheck2, workerOnly: true },
];

const fieldSectionPaths: Record<FieldSection, string> = {
  home: "/field/home",
  schedule: "/field/schedule",
  time_off: "/field/time-off",
  inventory: "/field/stock",
  earnings: "/field/pay",
  documents: "/field/docs",
};

const fieldPathSections: Record<string, FieldSection> = {
  "/": "home",
  "/field": "home",
  "/field/home": "home",
  "/field/schedule": "schedule",
  "/field/time-off": "time_off",
  "/field/stock": "inventory",
  "/field/pay": "earnings",
  "/field/docs": "documents",
};

function fieldSectionFromLocation(location: string): FieldSection {
  return fieldPathSections[location.split("?")[0]] ?? "home";
}

// ─── Location verification ────────────────────────────────────────────────────

type LocationPrompt = {
  eventLabel: string;
  jobAddress?: string;
  required?: boolean;
  onAllow: () => void;
  onSkip?: () => void;
};

type LocationVerificationResult = {
  id?: number;
  status: string;
  distanceMetres?: number | null;
  withinBounds?: boolean | null;
};

type FieldInventoryItem = {
  id: number;
  stockItemId: number;
  stockItemName: string;
  colour?: string | null;
  unit?: string | null;
  currentQuantity: number;
  updatedAt?: string;
};

type FieldInventoryTransaction = {
  id: number;
  stockItemId: number;
  stockItemName: string;
  colour?: string | null;
  unit?: string | null;
  transactionType:
    | "issued"
    | "used_on_job"
    | "returned"
    | "adjustment"
    | "restock";
  quantity: number;
  jobAssignmentId?: number | null;
  referenceNote?: string | null;
  createdAt: string;
};

type FieldRestockRequest = {
  id: number;
  stockItemName: string;
  colour?: string | null;
  unit?: string | null;
  quantityRequested: number;
  quantityFulfilled?: number | null;
  status: "pending" | "approved" | "fulfilled" | "rejected";
  subNotes?: string | null;
  adminNotes?: string | null;
  urgency: "low" | "normal" | "high";
  createdAt: string;
  updatedAt: string;
};

type FieldEarningsSummary = {
  subcontractorId: number;
  subcontractorName: string;
  weekStartDate: string;
  weekEndDate: string;
  totalWorkMinutes: number;
  totalHours: number;
  ratePerMetre: number;
  hourlyRate: number;
  gstRegistered: boolean;
  completedInvoiceHours: number;
  uninvoicedInvoiceHours: number;
  completedMetres: number;
  earnedSubtotal: number;
  earnedTax: number;
  earnedGross: number;
  toInvoiceSubtotal: number;
  toInvoiceTax: number;
  toInvoiceGross: number;
  uninvoicedMetres: number;
  lineItemCount: number;
  uninvoicedLineItemCount: number;
  draftInvoiceId?: number | null;
  submittedInvoiceId?: number | null;
  xeroInvoiceId?: string | null;
  submittedAt?: string | null;
};

type SubmitCurrentInvoiceResponse = {
  invoice?: {
    id: number;
    status: string;
    xeroInvoiceId?: string | null;
  } | null;
  summary?: FieldEarningsSummary | null;
  csvDownloadUrl?: string;
  xeroSubmissionFailed?: boolean;
  message?: string;
};

type FieldWorkSession = {
  status?: string | null;
  clockedOnAt?: string | Date | null;
  clockedOffAt?: string | Date | null;
  breakStartAt?: string | Date | null;
  totalBreakMinutes?: number | null;
};

async function getBrowserLocation(): Promise<GeolocationCoordinates | null> {
  if (!navigator.geolocation) return null;
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      () => resolve(null),
      { timeout: 10000, enableHighAccuracy: true },
    ),
  );
}

async function postLocationVerification(payload: Record<string, unknown>) {
  try {
    const res = await fetch("/api/location-verifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) return (await res.json()) as LocationVerificationResult;
  } catch {}
  return null;
}

function formatQty(quantity: number, unit?: string | null) {
  const display = Number.isInteger(quantity)
    ? quantity.toString()
    : quantity.toFixed(1);
  return `${display} ${unit ?? "units"}`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(Number.isFinite(value) ? value : 0);
}

function workedMinutesSoFar(
  session: FieldWorkSession | null | undefined,
  now: Date,
) {
  if (!session?.clockedOnAt) return 0;
  const clockedOnAt = new Date(session.clockedOnAt).getTime();
  const clockedOffAt = session.clockedOffAt
    ? new Date(session.clockedOffAt).getTime()
    : now.getTime();
  if (!Number.isFinite(clockedOnAt) || !Number.isFinite(clockedOffAt)) return 0;

  let breakMinutes = session.totalBreakMinutes ?? 0;
  if (session.status === "on_break" && session.breakStartAt) {
    const breakStartedAt = new Date(session.breakStartAt).getTime();
    if (Number.isFinite(breakStartedAt)) {
      breakMinutes += Math.max(
        0,
        Math.round((now.getTime() - breakStartedAt) / 60000),
      );
    }
  }

  return Math.max(
    0,
    Math.round((clockedOffAt - clockedOnAt) / 60000) - breakMinutes,
  );
}

function formatWorkedTime(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes.toString().padStart(2, "0")}m`;
}

function textMatchesStock(item: FieldInventoryItem, requirement: string) {
  const required = requirement.toLowerCase().trim();
  if (!required) return false;
  const colour = (item.colour ?? "").toLowerCase().trim();
  const haystack = `${item.stockItemName} ${item.colour ?? ""}`.toLowerCase();
  return (
    haystack.includes(required) || Boolean(colour && required.includes(colour))
  );
}

function formatCalendarChip(value: string) {
  const date = dateFromInputValue(value);
  return {
    weekday: date.toLocaleDateString("en-AU", { weekday: "short" }),
    day: date.toLocaleDateString("en-AU", { day: "numeric" }),
  };
}

function inventoryTransactionLabel(
  type: FieldInventoryTransaction["transactionType"],
) {
  const labels: Record<FieldInventoryTransaction["transactionType"], string> = {
    issued: "Issued",
    used_on_job: "Used",
    returned: "Returned",
    adjustment: "Adjusted",
    restock: "Restocked",
  };
  return labels[type];
}

function mapsDirectionsUrl(address?: string | null) {
  if (!address) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function FieldView() {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [location, setLocation] = useLocation();
  const isWorker = user?.role === "worker";

  const [subId, setSubId] = useState<number | undefined>(() => {
    if (user?.role === "worker") return user.subcontractorId ?? undefined;
    const saved = localStorage.getItem("ds_selected_subcontractor_id");
    return saved ? parseInt(saved) : undefined;
  });

  const [dismissedBanner, setDismissedBanner] = useState<number[]>([]);
  const [locationPrompt, setLocationPrompt] = useState<LocationPrompt | null>(
    null,
  );
  const [currentTime, setCurrentTime] = useState(() => new Date());

  // Push notification state
  const [pushStatus, setPushStatus] = useState<PushPermissionState>("unknown");
  const [credentialDraft, setCredentialDraft] = useState(emptyCredentialDraft);
  const [leaveForm, setLeaveForm] = useState({
    dayOffDate: todayDateInputValue(),
    reason: "",
  });
  const [selectedDispatchDate, setSelectedDispatchDate] = useState(() =>
    todayDateInputValue(),
  );
  const [activeSection, setActiveSection] = useState<FieldSection>(() =>
    fieldSectionFromLocation(location),
  );
  const today = todayDateInputValue();
  const selectedDispatchParams = {
    subcontractorId: subId,
    date: selectedDispatchDate,
  };
  const todayDispatchParams = { subcontractorId: subId, date: today };
  const isViewingToday = selectedDispatchDate === today;
  const selectedDispatchDateLabel = isViewingToday
    ? "Today"
    : formatDayOffDate(selectedDispatchDate);
  const visibleSections = fieldSections.filter(
    (section) => isWorker || !section.workerOnly,
  );

  useEffect(() => {
    setActiveSection(fieldSectionFromLocation(location));
  }, [location]);

  useEffect(() => {
    if (isWorker) {
      setSubId(user?.subcontractorId ?? undefined);
    }
  }, [isWorker, user?.subcontractorId]);

  useEffect(() => {
    if (isWorker) return;
    if (subId) {
      localStorage.setItem("ds_selected_subcontractor_id", subId.toString());
    } else {
      localStorage.removeItem("ds_selected_subcontractor_id");
    }
  }, [isWorker, subId]);

  // Check push status for Field View status messaging. The app-wide prompt handles enabling.
  useEffect(() => {
    setPushStatus(currentPushPermission());
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(
      () => setCurrentTime(new Date()),
      30000,
    );
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (selectedDispatchDate < today) setSelectedDispatchDate(today);
  }, [selectedDispatchDate, today]);

  // ─── Location verification helper ────────────────────────────────────────
  const requestLocationVerification = useCallback(
    (
      eventType: string,
      eventLabel: string,
      opts: {
        jobAssignmentId?: number;
        jobAddress?: string;
        workSessionId?: number;
        required?: boolean;
      },
    ) =>
      new Promise<LocationVerificationResult | null>((resolve) => {
        setLocationPrompt({
          eventLabel,
          jobAddress: opts.jobAddress,
          required: opts.required,
          onSkip: opts.required
            ? undefined
            : async () => {
                setLocationPrompt(null);
                await postLocationVerification({
                  subcontractorId: subId,
                  eventType,
                  jobAssignmentId: opts.jobAssignmentId ?? null,
                  workSessionId: opts.workSessionId ?? null,
                  status: "skipped",
                  workerConsented: false,
                });
                resolve(null);
              },
          onAllow: async () => {
            setLocationPrompt(null);
            const coords = await getBrowserLocation();
            if (!coords) {
              await postLocationVerification({
                subcontractorId: subId,
                eventType,
                jobAssignmentId: opts.jobAssignmentId ?? null,
                workSessionId: opts.workSessionId ?? null,
                status: "location_error",
                workerConsented: true,
              });
              toast({
                title: "Location required",
                description: opts.required
                  ? "Turn on location access before clocking on for the day."
                  : "Could not get your location. Event recorded.",
                variant: "destructive",
              });
              resolve(null);
              return;
            }
            const result = await postLocationVerification({
              subcontractorId: subId,
              eventType,
              jobAssignmentId: opts.jobAssignmentId ?? null,
              workSessionId: opts.workSessionId ?? null,
              reportedLat: coords.latitude,
              reportedLng: coords.longitude,
              reportedAccuracyMetres: coords.accuracy,
              workerConsented: true,
            });
            if (result?.status === "verified") {
              toast({
                title: "✓ Location confirmed",
                description: `You are at the job address (${result.distanceMetres ?? 0}m away).`,
              });
            } else if (result?.status === "outside_range") {
              toast({
                title: "⚠ Location check — far from job",
                description: `You appear to be ${result.distanceMetres ?? "?"}m from the job address. Admin has been flagged.`,
                variant: "destructive",
              });
            }
            if (!result) {
              toast({
                title: "Location check failed",
                description: "Try again before clocking on.",
                variant: "destructive",
              });
            }
            resolve(result);
          },
        });
      }),
    [subId, toast],
  );

  const { data: subs, isLoading: loadingSubs } = useListSubcontractors();

  const { data: session, isLoading: loadingSession } = useGetTodaySession(
    { subcontractorId: subId! },
    {
      query: {
        enabled: !!subId,
        queryKey: getGetTodaySessionQueryKey({ subcontractorId: subId! }),
      },
    },
  );

  const {
    data: dispatchList,
    isLoading: loadingDispatch,
    refetch: refetchDispatch,
  } = useListDispatch(selectedDispatchParams, {
    query: {
      enabled: !!subId,
      queryKey: getListDispatchQueryKey(selectedDispatchParams),
    },
  });

  const { data: todayDispatchList, isLoading: loadingTodayDispatch } =
    useListDispatch(todayDispatchParams, {
      query: {
        enabled: !!subId,
        queryKey: getListDispatchQueryKey(todayDispatchParams),
      },
    });

  const { data: inventoryItems = [], isLoading: loadingInventory } = useQuery<
    FieldInventoryItem[]
  >({
    queryKey: ["field-inventory", subId],
    queryFn: async () => {
      if (!subId) return [];
      const response = await fetch(`/api/sub-inventory/${subId}`);
      if (!response.ok) throw new Error("Could not load inventory");
      return response.json();
    },
    enabled: Boolean(subId),
  });

  const {
    data: inventoryTransactions = [],
    isLoading: loadingInventoryTransactions,
  } = useQuery<FieldInventoryTransaction[]>({
    queryKey: ["field-inventory-transactions", subId],
    queryFn: async () => {
      if (!subId) return [];
      const response = await fetch(
        `/api/inventory-transactions?subcontractorId=${subId}`,
      );
      if (!response.ok) throw new Error("Could not load inventory movements");
      return response.json();
    },
    enabled: Boolean(subId),
  });

  const { data: restockRequests = [], isLoading: loadingRestockRequests } =
    useQuery<FieldRestockRequest[]>({
      queryKey: ["field-restock-requests", subId],
      queryFn: async () => {
        if (!subId) return [];
        const response = await fetch(
          `/api/restock-requests?subcontractorId=${subId}`,
        );
        if (!response.ok) throw new Error("Could not load restock requests");
        return response.json();
      },
      enabled: Boolean(subId),
    });

  const { data: earningsSummary, isLoading: loadingEarningsSummary } =
    useQuery<FieldEarningsSummary>({
      queryKey: ["field-earnings-summary", subId],
      queryFn: async () => {
        if (!subId)
          throw new Error("Employee/subcontractor profile is not linked");
        const response = await fetch(
          `/api/weekly-invoices/earnings-summary?subcontractorId=${subId}`,
        );
        if (!response.ok)
          throw new Error(
            (await response.json().catch(() => null))?.error ??
              "Could not load earnings",
          );
        return response.json();
      },
      enabled: Boolean(subId),
      refetchInterval: 30000,
    });

  const submitCurrentInvoiceMutation =
    useMutation<SubmitCurrentInvoiceResponse>({
      mutationFn: async () => {
        if (!subId)
          throw new Error("Employee/subcontractor profile is not linked");
        const response = await fetch("/api/weekly-invoices/submit-current", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subcontractorId: subId }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(
            data?.message ?? data?.error ?? "Could not send invoice to Xero",
          );
        }
        return data;
      },
      onSuccess: (data) => {
        queryClient.invalidateQueries({
          queryKey: ["field-earnings-summary", subId],
        });
        queryClient.invalidateQueries();
        toast({
          title: data.xeroSubmissionFailed
            ? "Invoice prepared"
            : "Invoice sent to Xero",
          description: data.xeroSubmissionFailed
            ? "Xero is not connected yet, but your current invoice is ready to review."
            : data.invoice?.xeroInvoiceId
              ? "A draft bill has been created in Xero."
              : "Your weekly invoice has been submitted.",
        });
      },
      onError: (error) => {
        toast({
          title: "Could not send invoice",
          description:
            error instanceof Error
              ? error.message
              : "Check the Xero connection and try again.",
          variant: "destructive",
        });
      },
    });

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["unread-count", subId],
    queryFn: () => {
      if (!subId) return Promise.resolve({ count: 0 });
      return fetch(
        `/api/notifications/unread-count?subcontractorId=${subId}`,
      ).then((r) => r.json());
    },
    enabled: !!subId,
    refetchInterval: 20000,
  });

  const { data: pushServerStatus } = useQuery<{
    enabled: boolean;
    subscriptionCount: number;
  }>({
    queryKey: ["push-subscription-status", subId],
    queryFn: async () => {
      if (!subId) return { enabled: false, subscriptionCount: 0 };
      const response = await fetch(
        `/api/push-subscriptions/status?subcontractorId=${subId}`,
      );
      if (!response.ok) return { enabled: false, subscriptionCount: 0 };
      return response.json();
    },
    enabled: !!subId,
    refetchInterval: 60000,
  });

  const { data: credentials = [] } = useQuery<WorkerCredential[]>({
    queryKey: ["worker-credentials", subId],
    queryFn: async () => {
      if (!subId) return [];
      const response = await fetch(
        `/api/worker-credentials?subcontractorId=${subId}`,
      );
      if (!response.ok) throw new Error("Could not load licence documents");
      return response.json();
    },
    enabled: Boolean(subId && isWorker),
  });

  const { data: leaveRequests = [] } = useQuery<LeaveRequest[]>({
    queryKey: ["leave-requests", subId],
    queryFn: async () => {
      if (!subId) return [];
      const response = await fetch(
        `/api/leave-requests?subcontractorId=${subId}`,
      );
      if (!response.ok) throw new Error("Could not load day off requests");
      return response.json();
    },
    enabled: Boolean(subId && isWorker),
  });

  const uploadCredentialMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!subId)
        throw new Error("Employee/subcontractor profile is not linked");
      const imageData = await compressCredentialImage(file);
      const response = await fetch("/api/worker-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subcontractorId: subId,
          documentType: credentialDraft.documentType,
          label: credentialLabel(credentialDraft.documentType),
          imageData,
          fileName: file.name,
          expiryDate: credentialDraft.expiryDate || undefined,
          notes: credentialDraft.notes || undefined,
        }),
      });
      if (!response.ok)
        throw new Error(
          (await response.json().catch(() => null))?.error ??
            "Could not upload licence document",
        );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["worker-credentials", subId],
      });
      setCredentialDraft((draft) => ({ ...draft, expiryDate: "", notes: "" }));
      toast({ title: "Licence document uploaded" });
    },
    onError: (error) => {
      toast({
        title: "Could not upload licence document",
        description:
          error instanceof Error
            ? error.message
            : "Choose a clear image and try again.",
        variant: "destructive",
      });
    },
  });

  const deleteCredentialMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/worker-credentials/${id}`, {
        method: "DELETE",
      });
      if (!response.ok)
        throw new Error(
          (await response.json().catch(() => null))?.error ??
            "Could not delete licence document",
        );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["worker-credentials", subId],
      });
      toast({ title: "Licence document deleted" });
    },
    onError: (error) => {
      toast({
        title: "Could not delete licence document",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    },
  });

  const requestLeaveMutation = useMutation({
    mutationFn: async () => {
      if (!subId)
        throw new Error("Employee/subcontractor profile is not linked");
      const response = await fetch("/api/leave-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subcontractorId: subId,
          dayOffDate: leaveForm.dayOffDate,
          reason: leaveForm.reason || undefined,
        }),
      });
      if (!response.ok)
        throw new Error(
          (await response.json().catch(() => null))?.error ??
            "Could not send day off request",
        );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests", subId] });
      setLeaveForm({ dayOffDate: todayDateInputValue(), reason: "" });
      toast({ title: "Day off request sent" });
    },
    onError: (error) => {
      toast({
        title: "Could not send day off request",
        description:
          error instanceof Error
            ? error.message
            : "Check the date and try again.",
        variant: "destructive",
      });
    },
  });

  const cancelLeaveMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/leave-requests/${id}`, {
        method: "DELETE",
      });
      if (!response.ok)
        throw new Error(
          (await response.json().catch(() => null))?.error ??
            "Could not cancel day off request",
        );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests", subId] });
      toast({ title: "Day off request cancelled" });
    },
    onError: (error) => {
      toast({
        title: "Could not cancel request",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    },
  });

  const { data: urgentNotifications } = useQuery<any[]>({
    queryKey: ["urgent-notifications", subId],
    queryFn: () => {
      if (!subId) return Promise.resolve([]);
      return fetch(
        `/api/notifications?subcontractorId=${subId}&unreadOnly=true`,
      ).then((r) => r.json());
    },
    enabled: !!subId,
    refetchInterval: 20000,
    select: (data) =>
      data.filter(
        (n) =>
          (n.priority === "urgent" || n.priority === "high") &&
          !dismissedBanner.includes(n.id),
      ),
  });

  const markRead = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/notifications/${id}/read`, { method: "PATCH" }).then((r) =>
        r.json(),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unread-count", subId] });
      queryClient.invalidateQueries({
        queryKey: ["urgent-notifications", subId],
      });
    },
  });

  const clockOn = useClockOn({
    mutation: {
      onSuccess: (newSession) => {
        toast({ title: "Clocked on — have a great day!" });
        if (subId) {
          queryClient.setQueryData<WorkSession>(
            getGetTodaySessionQueryKey({ subcontractorId: subId }),
            newSession,
          );
          queryClient.invalidateQueries({
            queryKey: getGetTodaySessionQueryKey({ subcontractorId: subId }),
          });
          queryClient.invalidateQueries({
            queryKey: getListDispatchQueryKey(todayDispatchParams),
          });
        }
      },
      onError: (error) => {
        toast({
          title: "Could not clock on",
          description:
            error instanceof Error
              ? error.message
              : "Location must be enabled before clocking on.",
          variant: "destructive",
        });
      },
    },
  });

  const clockOff = useClockOff({
    mutation: {
      onSuccess: () => {
        toast({ title: "Good work — clocked off" });
        if (subId)
          queryClient.invalidateQueries({
            queryKey: getGetTodaySessionQueryKey({ subcontractorId: subId }),
          });
      },
    },
  });

  const startBreak = useStartBreak({
    mutation: {
      onSuccess: () => {
        toast({ title: "Break started" });
        if (subId)
          queryClient.invalidateQueries({
            queryKey: getGetTodaySessionQueryKey({ subcontractorId: subId }),
          });
      },
    },
  });

  const endBreak = useEndBreak({
    mutation: {
      onSuccess: () => {
        toast({ title: "Welcome back!" });
        if (subId)
          queryClient.invalidateQueries({
            queryKey: getGetTodaySessionQueryKey({ subcontractorId: subId }),
          });
      },
    },
  });

  const markArrived = useMarkArrived({
    mutation: {
      onSuccess: () => {
        toast({ title: "Checked in to job" });
        if (subId)
          queryClient.invalidateQueries({
            queryKey: getListDispatchQueryKey(todayDispatchParams),
          });
      },
      onError: (error) => {
        toast({
          title: "Could not check in",
          description:
            error instanceof Error
              ? error.message
              : "Try again once you are at the job.",
          variant: "destructive",
        });
      },
    },
  });

  const markDeparted = useMarkDeparted({
    mutation: {
      onSuccess: () => {
        toast({ title: "Checked out of job" });
        if (subId)
          queryClient.invalidateQueries({
            queryKey: getListDispatchQueryKey(todayDispatchParams),
          });
      },
    },
  });

  const startWork = useUpdateJobAssignment({
    mutation: {
      onSuccess: () => {
        toast({ title: "Work started" });
        if (subId)
          queryClient.invalidateQueries({
            queryKey: getListDispatchQueryKey(todayDispatchParams),
          });
      },
    },
  });

  function moveDispatchDate(days: number) {
    const next = dateFromInputValue(selectedDispatchDate);
    next.setDate(next.getDate() + days);
    const nextValue = dateInputValue(next);
    setSelectedDispatchDate(nextValue < today ? today : nextValue);
  }

  // ─── Action handlers with location verification ───────────────────────────
  const handleClockOn = useCallback(async () => {
    if (!subId) return;
    const firstJob = [...(todayDispatchList ?? [])]
      .filter((assignment) => assignment.status !== "completed")
      .sort((a, b) => a.scheduledOrder - b.scheduledOrder)[0];
    const locationJob = firstJob?.jobAddress
      ? firstJob
      : todayDispatchList?.find(
          (assignment) =>
            assignment.status !== "completed" && Boolean(assignment.jobAddress),
        );
    const verification = await requestLocationVerification(
      "clock_on",
      "clock-on",
      {
        jobAssignmentId: locationJob?.id,
        jobAddress: locationJob?.jobAddress ?? undefined,
        required: true,
      },
    );
    if (!verification?.id) return;
    if (
      verification.status === "skipped" ||
      verification.status === "location_error"
    ) {
      toast({
        title: "Location required",
        description: "You must allow location access before clocking on.",
        variant: "destructive",
      });
      return;
    }
    try {
      await clockOn.mutateAsync({
        data: {
          subcontractorId: subId,
          locationVerificationId: verification.id,
        },
      });
      if (firstJob?.status === "pending") {
        await markArrived.mutateAsync({ id: firstJob.id });
      }
    } catch {
      // Mutation handlers show the user-facing error.
    }
  }, [
    subId,
    todayDispatchList,
    requestLocationVerification,
    clockOn,
    markArrived,
    toast,
  ]);

  const handleClockOff = useCallback(async () => {
    if (!subId) return;
    const unfinishedJobs =
      todayDispatchList?.filter(
        (assignment) => assignment.status !== "completed",
      ) ?? [];
    if (unfinishedJobs.length > 0) {
      toast({
        title: "Check out of today's jobs first",
        description:
          "Each assigned job must be checked out before clocking off for the day.",
        variant: "destructive",
      });
      return;
    }
    const locationJob = [...(todayDispatchList ?? [])]
      .filter(
        (assignment) =>
          assignment.status === "completed" && Boolean(assignment.jobAddress),
      )
      .sort((a, b) => b.scheduledOrder - a.scheduledOrder)[0];
    const verification = await requestLocationVerification(
      "clock_off",
      "clock-off",
      {
        jobAssignmentId: locationJob?.id,
        jobAddress: locationJob?.jobAddress ?? undefined,
        workSessionId: session?.id,
        required: true,
      },
    );
    if (
      !verification?.id ||
      verification.status === "skipped" ||
      verification.status === "location_error"
    ) {
      toast({
        title: "Location required",
        description: "Allow location access before clocking off for the day.",
        variant: "destructive",
      });
      return;
    }
    clockOff.mutate({ data: { subcontractorId: subId } });
  }, [
    subId,
    todayDispatchList,
    session?.id,
    requestLocationVerification,
    clockOff,
    toast,
  ]);

  const handleMarkArrived = useCallback(
    async (assignmentId: number, jobAddress?: string) => {
      if (!isViewingToday) return;
      if (session?.status !== "active" && session?.status !== "on_break") {
        toast({
          title: "Clock on for the day first",
          description: "Start the workday before checking in to a job.",
          variant: "destructive",
        });
        return;
      }
      const verification = await requestLocationVerification(
        "job_arrived",
        "job check-in",
        {
          jobAssignmentId: assignmentId,
          jobAddress,
          workSessionId: session?.id,
          required: true,
        },
      );
      if (
        !verification?.id ||
        verification.status === "skipped" ||
        verification.status === "location_error"
      ) {
        toast({
          title: "Location required",
          description: "Allow location access before checking in to this job.",
          variant: "destructive",
        });
        return;
      }
      markArrived.mutate({ id: assignmentId });
    },
    [
      isViewingToday,
      requestLocationVerification,
      session?.id,
      session?.status,
      markArrived,
      toast,
    ],
  );

  const handleMarkDeparted = useCallback(
    async (assignmentId: number, jobAddress?: string) => {
      if (!isViewingToday) return;
      if (session?.status !== "active" && session?.status !== "on_break") {
        toast({
          title: "Clock on for the day first",
          description: "Start the workday before checking out of a job.",
          variant: "destructive",
        });
        return;
      }
      await requestLocationVerification("job_departed", "job check-out", {
        jobAssignmentId: assignmentId,
        jobAddress,
        workSessionId: session?.id,
      });
      markDeparted.mutate({ id: assignmentId });
    },
    [
      isViewingToday,
      requestLocationVerification,
      session?.id,
      session?.status,
      markDeparted,
      toast,
    ],
  );

  const isClockedOn =
    session?.status === "active" || session?.status === "on_break";
  const isOnBreak = session?.status === "on_break";
  const workedMinutesToday = useMemo(
    () => workedMinutesSoFar(session, currentTime),
    [session, currentTime],
  );
  const workedTimeTodayLabel = formatWorkedTime(workedMinutesToday);
  const unreadCount = unreadData?.count ?? 0;
  const pushEnabled = Boolean(pushServerStatus?.enabled);
  const todayJobs = useMemo(
    () =>
      [...(todayDispatchList ?? [])].sort(
        (a, b) => a.scheduledOrder - b.scheduledOrder,
      ),
    [todayDispatchList],
  );
  const unfinishedTodayJobs = useMemo(
    () => todayJobs.filter((assignment) => assignment.status !== "completed"),
    [todayJobs],
  );
  const firstTodayJob = todayJobs.find(
    (assignment) => assignment.status !== "completed",
  );
  const activeTodayJob = todayJobs.find(
    (assignment) =>
      assignment.status === "arrived" || assignment.status === "in_progress",
  );
  const nextPendingTodayJob = todayJobs.find(
    (assignment) => assignment.status === "pending",
  );
  const nextFlowJob = activeTodayJob ?? nextPendingTodayJob ?? null;
  const canClockOffForDay = isClockedOn && unfinishedTodayJobs.length === 0;
  const isCurrentJobLast = Boolean(
    activeTodayJob && unfinishedTodayJobs.length === 1,
  );
  const inventoryCalendarDates = useMemo(() => {
    const sixDaysOut = dateFromInputValue(today);
    sixDaysOut.setDate(sixDaysOut.getDate() + 6);
    const calendarStart =
      selectedDispatchDate > dateInputValue(sixDaysOut)
        ? selectedDispatchDate
        : today;
    return Array.from({ length: 7 }, (_, index) => {
      const date = dateFromInputValue(calendarStart);
      date.setDate(date.getDate() + index);
      return dateInputValue(date);
    });
  }, [selectedDispatchDate, today]);
  const selectedRequiredStock = useMemo(() => {
    const values = (dispatchList ?? []).flatMap(
      (assignment) => assignment.requiredColours ?? [],
    );
    return Array.from(
      new Set(values.map((value) => value.trim()).filter(Boolean)),
    );
  }, [dispatchList]);
  const requiredStockStatus = useMemo(() => {
    return selectedRequiredStock.map((requirement) => {
      const matches = inventoryItems.filter(
        (item) =>
          item.currentQuantity > 0 && textMatchesStock(item, requirement),
      );
      const total = matches.reduce(
        (sum, item) => sum + Number(item.currentQuantity),
        0,
      );
      return { requirement, matches, total, unit: matches[0]?.unit ?? "units" };
    });
  }, [inventoryItems, selectedRequiredStock]);
  const currentInventoryItems = useMemo(() => {
    return [...inventoryItems]
      .filter((item) => Number(item.currentQuantity) !== 0)
      .sort((a, b) => a.stockItemName.localeCompare(b.stockItemName));
  }, [inventoryItems]);
  const selectedDayTransactions = useMemo(() => {
    return inventoryTransactions
      .filter(
        (transaction) =>
          dateInputValue(new Date(transaction.createdAt)) ===
          selectedDispatchDate,
      )
      .slice(0, 8);
  }, [inventoryTransactions, selectedDispatchDate]);
  const openRestockRequests = useMemo(() => {
    return restockRequests
      .filter(
        (request) =>
          request.status === "pending" || request.status === "approved",
      )
      .slice(0, 5);
  }, [restockRequests]);
  const earningsWeekLabel = earningsSummary
    ? `${formatDayOffDate(earningsSummary.weekStartDate)} to ${formatDayOffDate(earningsSummary.weekEndDate)}`
    : "This week";
  const canSubmitCurrentInvoice = Boolean(
    earningsSummary &&
    earningsSummary.toInvoiceGross > 0 &&
    earningsSummary.uninvoicedLineItemCount > 0 &&
    (earningsSummary.ratePerMetre > 0 || earningsSummary.hourlyRate > 0),
  );
  const currentInvoiceId =
    earningsSummary?.draftInvoiceId ??
    earningsSummary?.submittedInvoiceId ??
    null;
  const activeSectionLabel =
    fieldSections.find((section) => section.id === activeSection)?.label ??
    "Home";

  const openMapsForJob = useCallback(
    (jobAddress?: string | null) => {
      const directionsUrl = mapsDirectionsUrl(jobAddress);
      if (!directionsUrl) {
        toast({
          title: "No job address",
          description:
            "Admin needs to add an address before directions can open.",
          variant: "destructive",
        });
        return;
      }
      window.open(directionsUrl, "_blank", "noopener,noreferrer");
    },
    [toast],
  );

  const handleSectionChange = useCallback(
    (value: string) => {
      const nextSection = value as FieldSection;
      setActiveSection(nextSection);
      const nextPath = fieldSectionPaths[nextSection] ?? fieldSectionPaths.home;
      if (location.split("?")[0] !== nextPath) setLocation(nextPath);
    },
    [location, setLocation],
  );

  function handleCredentialUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    uploadCredentialMutation.mutate(file);
  }

  return (
    <div className="max-w-md mx-auto space-y-4 pb-20">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">
          {activeSectionLabel}
        </h1>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => refetchDispatch()}>
            <RotateCcw className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            onClick={() => setLocation("/notifications")}
            title="Notifications"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 min-w-[1rem] h-4 px-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Button>
        </div>
      </div>

      <Tabs value={activeSection} onValueChange={handleSectionChange}>
        <TabsList className="grid h-auto w-full grid-cols-3 gap-1 rounded-md bg-muted/60 p-1 sm:grid-cols-6">
          {visibleSections.map((section) => {
            const Icon = section.icon;
            return (
              <TabsTrigger
                key={section.id}
                value={section.id}
                className="h-16 flex-col gap-1 whitespace-normal px-1 text-xs font-semibold leading-tight"
              >
                <Icon className="h-4 w-4" />
                <span>{section.label}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {!isWorker && activeSection !== "home" ? (
        <Card>
          <CardContent className="space-y-2 p-4">
            <Label>Employee/subcontractor</Label>
            {loadingSubs ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <Select
                value={subId?.toString() || ""}
                onValueChange={(v) => setSubId(parseInt(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select subcontractor..." />
                </SelectTrigger>
                <SelectContent>
                  {subs?.map((s) => (
                    <SelectItem key={s.id} value={s.id.toString()}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Location consent prompt */}
      {locationPrompt && (
        <Card className="border-orange-300 bg-orange-50 dark:bg-orange-950/40 dark:border-orange-700 shadow-md">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Navigation className="h-5 w-5 text-orange-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-semibold text-sm text-orange-950 dark:text-orange-100">
                  Location check — {locationPrompt.eventLabel}
                </p>
                <p className="text-xs text-orange-800 dark:text-orange-300 mt-1">
                  Confirm location for this step.
                  {locationPrompt.jobAddress && (
                    <span className="block mt-0.5 font-medium">
                      {locationPrompt.jobAddress}
                    </span>
                  )}
                  {locationPrompt.required && (
                    <span className="block mt-1 font-medium">Required.</span>
                  )}
                </p>
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={locationPrompt.onAllow}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Allow
                  </Button>
                  {locationPrompt.onSkip && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs gap-1.5"
                      onClick={locationPrompt.onSkip}
                    >
                      <XCircle className="h-3.5 w-3.5" /> Skip
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Push denied reminder */}
      {activeSection === "home" &&
        pushStatus === "denied" &&
        subId &&
        !pushEnabled && (
          <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2">
            <BellOff className="h-3.5 w-3.5 flex-shrink-0" />
            <span>Notifications blocked. See Docs.</span>
          </div>
        )}

      {/* Urgent / high-priority notification banners */}
      {activeSection === "home" &&
        urgentNotifications &&
        urgentNotifications.length > 0 && (
          <div className="space-y-2">
            {urgentNotifications.slice(0, 3).map((n) => (
              <Card
                key={n.id}
                className={`border-l-4 ${n.priority === "urgent" ? "border-l-red-500 bg-red-50 dark:bg-red-950/30" : "border-l-orange-400 bg-orange-50 dark:bg-orange-950/30"}`}
              >
                <CardContent className="p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle
                      className={`h-4 w-4 mt-0.5 flex-shrink-0 ${n.priority === "urgent" ? "text-red-500" : "text-orange-500"}`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{n.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {n.body}
                      </p>
                      {n.actionUrl && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2 h-6 text-xs px-2"
                          onClick={() => {
                            markRead.mutate(n.id);
                            setLocation(n.actionUrl);
                          }}
                        >
                          Take Action{" "}
                          <ChevronRight className="h-3 w-3 ml-0.5" />
                        </Button>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 flex-shrink-0"
                      onClick={() => {
                        setDismissedBanner((prev) => [...prev, n.id]);
                        markRead.mutate(n.id);
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

      {/* Identity + clock card */}
      {activeSection === "home" && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="space-y-2">
              <Label>{isWorker ? "Signed in as" : "Who are you?"}</Label>
              {isWorker ? (
                <div className="rounded-md border bg-muted px-3 py-2 text-sm font-medium">
                  {user?.name ?? "Employee/Subcontractor"}
                </div>
              ) : loadingSubs ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <Select
                  value={subId?.toString() || ""}
                  onValueChange={(v) => setSubId(parseInt(v))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select subcontractor..." />
                  </SelectTrigger>
                  <SelectContent>
                    {subs?.map((s) => (
                      <SelectItem key={s.id} value={s.id.toString()}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {subId && (
              <div className="space-y-4 pt-4 border-t">
                {!isClockedOn ? (
                  <div className="space-y-3">
                    {firstTodayJob ? (
                      <div className="rounded-md border bg-muted/30 px-3 py-3 text-sm">
                        <p className="text-xs font-semibold uppercase text-muted-foreground">
                          First job
                        </p>
                        <p className="mt-1 font-semibold">
                          {firstTodayJob.jobTitle}
                        </p>
                        {firstTodayJob.workArea ? (
                          <p className="text-xs text-muted-foreground">
                            {firstTodayJob.workArea}
                          </p>
                        ) : null}
                        {firstTodayJob.jobAddress ? (
                          <div className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
                            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>{firstTodayJob.jobAddress}</span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <Button
                      className="w-full h-16 text-lg"
                      size="lg"
                      onClick={handleClockOn}
                      disabled={
                        clockOn.isPending ||
                        markArrived.isPending ||
                        loadingTodayDispatch ||
                        !!locationPrompt
                      }
                    >
                      <Play className="mr-2 h-6 w-6" />{" "}
                      {firstTodayJob ? "START DAY" : "CLOCK ON"}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div
                      className={
                        canClockOffForDay
                          ? "grid grid-cols-2 gap-3"
                          : "grid grid-cols-1 gap-3"
                      }
                    >
                      {isOnBreak ? (
                        <Button
                          variant="outline"
                          className="h-14"
                          onClick={() =>
                            endBreak.mutate({
                              data: { subcontractorId: subId },
                            })
                          }
                          disabled={endBreak.isPending}
                        >
                          <Play className="mr-2 h-5 w-5" /> END BREAK
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          className="h-14"
                          onClick={() =>
                            startBreak.mutate({
                              data: { subcontractorId: subId },
                            })
                          }
                          disabled={startBreak.isPending}
                        >
                          <Pause className="mr-2 h-5 w-5" /> START BREAK
                        </Button>
                      )}
                      {canClockOffForDay ? (
                        <Button
                          variant="destructive"
                          className="h-14"
                          onClick={handleClockOff}
                          disabled={
                            clockOff.isPending ||
                            loadingTodayDispatch ||
                            !!locationPrompt
                          }
                        >
                          <Square className="mr-2 h-5 w-5" /> CLOCK OFF FOR DAY
                        </Button>
                      ) : null}
                    </div>
                    {!canClockOffForDay && unfinishedTodayJobs.length > 0 ? (
                      <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                        Finish jobs before clock off.
                      </div>
                    ) : null}
                  </div>
                )}

                {session && (
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-md border bg-muted/40 px-3 py-2">
                      <p className="text-xs text-muted-foreground">Status</p>
                      <p className="mt-1 font-semibold uppercase">
                        {session.status.replace("_", " ")}
                      </p>
                    </div>
                    <div className="rounded-md border bg-muted/40 px-3 py-2">
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        Hours
                      </p>
                      <p className="mt-1 text-base font-semibold">
                        {workedTimeTodayLabel}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeSection === "home" && subId ? (
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="h-4 w-4 text-primary" />
              Today
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4 pt-2">
            {loadingTodayDispatch ? (
              <div className="space-y-3">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : todayJobs.length === 0 ? (
              <div className="rounded-md border border-dashed bg-muted/30 px-3 py-4 text-center text-sm text-muted-foreground">
                No jobs assigned for today.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-md border bg-muted/30 px-2 py-2">
                    <p className="text-lg font-semibold">
                      {todayJobs.length - unfinishedTodayJobs.length}/
                      {todayJobs.length}
                    </p>
                    <p className="text-[11px] text-muted-foreground">done</p>
                  </div>
                  <div className="rounded-md border bg-muted/30 px-2 py-2">
                    <p className="truncate text-sm font-semibold">
                      {nextFlowJob
                        ? (timeWindowLabels[
                            nextFlowJob.timeWindow ?? "full_day"
                          ] ?? nextFlowJob.timeWindow)
                        : "Finished"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">step</p>
                  </div>
                  <div className="rounded-md border bg-muted/30 px-2 py-2">
                    <p className="text-lg font-semibold">
                      {workedTimeTodayLabel}
                    </p>
                    <p className="text-[11px] text-muted-foreground">hours</p>
                  </div>
                </div>

                {!isClockedOn ? (
                  <div className="rounded-md border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                    Start at first job.
                  </div>
                ) : activeTodayJob ? (
                  <div className="space-y-3 rounded-md border bg-background px-3 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase text-muted-foreground">
                          {isCurrentJobLast ? "Last job" : "Current job"}
                        </p>
                        <p className="mt-1 font-semibold">
                          {activeTodayJob.jobTitle}
                        </p>
                        {activeTodayJob.workArea ? (
                          <p className="text-xs text-muted-foreground">
                            {activeTodayJob.workArea}
                          </p>
                        ) : null}
                      </div>
                      <Badge variant="default">
                        {activeTodayJob.status.replace("_", " ")}
                      </Badge>
                    </div>
                    {activeTodayJob.jobAddress ? (
                      <div className="flex items-start gap-2 text-sm text-muted-foreground">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{activeTodayJob.jobAddress}</span>
                      </div>
                    ) : null}
                    <div className="grid gap-2 sm:grid-cols-2">
                      {activeTodayJob.status === "arrived" ? (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            startWork.mutate({
                              id: activeTodayJob.id,
                              data: { status: "in_progress" },
                            })
                          }
                          disabled={startWork.isPending}
                        >
                          Start Work
                        </Button>
                      ) : null}
                      <Button
                        asChild
                        className={
                          activeTodayJob.status === "arrived"
                            ? ""
                            : "sm:col-span-2"
                        }
                      >
                        <Link href={`/field/jobs/${activeTodayJob.id}`}>
                          {isCurrentJobLast ? "Finish Last Job" : "Finish Job"}
                        </Link>
                      </Button>
                    </div>
                  </div>
                ) : nextPendingTodayJob ? (
                  <div className="space-y-3 rounded-md border bg-background px-3 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase text-muted-foreground">
                          {unfinishedTodayJobs.length === 1
                            ? "Last job"
                            : "Next job"}
                        </p>
                        <p className="mt-1 font-semibold">
                          {nextPendingTodayJob.jobTitle}
                        </p>
                        {nextPendingTodayJob.workArea ? (
                          <p className="text-xs text-muted-foreground">
                            {nextPendingTodayJob.workArea}
                          </p>
                        ) : null}
                      </div>
                      <Badge variant="outline">waiting</Badge>
                    </div>
                    {nextPendingTodayJob.jobAddress ? (
                      <div className="flex items-start gap-2 text-sm text-muted-foreground">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{nextPendingTodayJob.jobAddress}</span>
                      </div>
                    ) : null}
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          openMapsForJob(nextPendingTodayJob.jobAddress)
                        }
                      >
                        <Navigation className="mr-2 h-4 w-4" />
                        Open Maps
                      </Button>
                      <Button
                        onClick={() =>
                          handleMarkArrived(
                            nextPendingTodayJob.id,
                            nextPendingTodayJob.jobAddress ?? undefined,
                          )
                        }
                        disabled={markArrived.isPending || !!locationPrompt}
                      >
                        Check In
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                    Ready to clock off.
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      {activeSection === "earnings" && subId ? (
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Receipt className="h-4 w-4 text-primary" />
              Pay
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4 pt-2">
            {loadingEarningsSummary ? (
              <div className="space-y-3">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : earningsSummary ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {earningsWeekLabel}
                    </p>
                    <p className="mt-1 text-2xl font-bold tracking-tight">
                      {formatCurrency(earningsSummary.toInvoiceGross)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {earningsSummary.gstRegistered
                        ? "Gross ready to invoice, including GST"
                        : "Gross ready to invoice, no GST"}
                    </p>
                  </div>
                  <Badge
                    variant={
                      earningsSummary.toInvoiceGross > 0
                        ? "default"
                        : "secondary"
                    }
                  >
                    {earningsSummary.uninvoicedLineItemCount} job report
                    {earningsSummary.uninvoicedLineItemCount === 1 ? "" : "s"}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md border bg-muted/30 px-3 py-2">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      Weekly hours
                    </div>
                    <p className="mt-1 text-lg font-semibold">
                      {earningsSummary.totalHours.toFixed(2)}
                    </p>
                  </div>
                  <div className="rounded-md border bg-muted/30 px-3 py-2">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <DollarSign className="h-3.5 w-3.5" />
                      Gross earned
                    </div>
                    <p className="mt-1 text-lg font-semibold">
                      {formatCurrency(earningsSummary.earnedGross)}
                    </p>
                  </div>
                  <div className="rounded-md border bg-muted/30 px-3 py-2">
                    <p className="text-xs text-muted-foreground">
                      Metres this week
                    </p>
                    <p className="mt-1 text-lg font-semibold">
                      {earningsSummary.completedMetres.toFixed(2)}m
                    </p>
                  </div>
                  <div className="rounded-md border bg-muted/30 px-3 py-2">
                    <p className="text-xs text-muted-foreground">
                      Rate per metre
                    </p>
                    <p className="mt-1 text-lg font-semibold">
                      {formatCurrency(earningsSummary.ratePerMetre)}
                    </p>
                  </div>
                  <div className="rounded-md border bg-muted/30 px-3 py-2">
                    <p className="text-xs text-muted-foreground">Hourly rate</p>
                    <p className="mt-1 text-lg font-semibold">
                      {formatCurrency(earningsSummary.hourlyRate)}/hr
                    </p>
                  </div>
                  <div className="rounded-md border bg-muted/30 px-3 py-2">
                    <p className="text-xs text-muted-foreground">GST</p>
                    <p className="mt-1 text-lg font-semibold">
                      {earningsSummary.gstRegistered
                        ? formatCurrency(earningsSummary.toInvoiceTax)
                        : "No GST"}
                    </p>
                  </div>
                </div>

                {earningsSummary.ratePerMetre <= 0 &&
                earningsSummary.hourlyRate <= 0 ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                    {isWorker
                      ? "Your pay rate has not been set yet. Admin must set a metre rate or hourly rate before invoices can be sent."
                      : "Set a metre rate or hourly rate in the employee/subcontractor profile before invoices can be sent."}
                  </div>
                ) : null}

                <Button
                  className="w-full"
                  onClick={() => submitCurrentInvoiceMutation.mutate()}
                  disabled={
                    !canSubmitCurrentInvoice ||
                    submitCurrentInvoiceMutation.isPending
                  }
                >
                  <Send className="mr-2 h-4 w-4" />
                  {submitCurrentInvoiceMutation.isPending
                    ? "Submitting invoice..."
                    : "Submit current invoice"}
                </Button>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button asChild variant="outline">
                    <Link href="/weekly-invoices">
                      <Receipt className="mr-2 h-4 w-4" />
                      {isWorker ? "My invoices" : "Weekly invoices"}
                    </Link>
                  </Button>
                  {currentInvoiceId ? (
                    <Button asChild variant="outline">
                      <Link href={`/weekly-invoices/${currentInvoiceId}`}>
                        <FileCheck2 className="mr-2 h-4 w-4" />
                        Current invoice
                      </Link>
                    </Button>
                  ) : null}
                </div>

                {earningsSummary.submittedAt ? (
                  <p className="text-xs text-muted-foreground">
                    Last sent{" "}
                    {new Date(earningsSummary.submittedAt).toLocaleString(
                      "en-AU",
                      {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      },
                    )}
                    {earningsSummary.xeroInvoiceId
                      ? ` - Xero ${earningsSummary.xeroInvoiceId}`
                      : ""}
                  </p>
                ) : null}
              </>
            ) : (
              <div className="rounded-md border border-dashed bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                Earnings are available once your employee/subcontractor profile
                is linked.
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {activeSection === "earnings" && !subId ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            Select an employee/subcontractor to review pay and invoices.
          </CardContent>
        </Card>
      ) : null}

      {activeSection === "time_off" && isWorker && subId ? (
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4 text-primary" />
              Time Off
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-2">
            <div className="grid gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Day off date</Label>
                <Input
                  type="date"
                  value={leaveForm.dayOffDate}
                  min={todayDateInputValue()}
                  onChange={(event) =>
                    setLeaveForm((form) => ({
                      ...form,
                      dayOffDate: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Reason</Label>
                <Textarea
                  rows={2}
                  value={leaveForm.reason}
                  onChange={(event) =>
                    setLeaveForm((form) => ({
                      ...form,
                      reason: event.target.value,
                    }))
                  }
                  placeholder="Optional note for admin..."
                />
              </div>
              <Button
                className="w-full"
                onClick={() => requestLeaveMutation.mutate()}
                disabled={
                  !leaveForm.dayOffDate || requestLeaveMutation.isPending
                }
              >
                <Send className="mr-2 h-4 w-4" />
                {requestLeaveMutation.isPending
                  ? "Sending..."
                  : "Request day off"}
              </Button>
            </div>

            {leaveRequests.length > 0 ? (
              <div className="space-y-2 border-t pt-3">
                {leaveRequests.slice(0, 5).map((request) => (
                  <div
                    key={request.id}
                    className="rounded-md border bg-background px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">
                          {formatDayOffDate(request.dayOffDate)}
                        </p>
                        {request.reason ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {request.reason}
                          </p>
                        ) : null}
                        {request.adminNote ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Admin: {request.adminNote}
                          </p>
                        ) : null}
                      </div>
                      <Badge variant={leaveStatusBadgeVariant(request.status)}>
                        {leaveStatusLabel(request.status)}
                      </Badge>
                    </div>
                    {request.status === "pending" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="mt-2 h-7 px-2 text-xs text-muted-foreground"
                        onClick={() => cancelLeaveMutation.mutate(request.id)}
                        disabled={cancelLeaveMutation.isPending}
                      >
                        Cancel request
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                No day off requests yet.
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {activeSection === "documents" && isWorker && subId ? (
        <div className="space-y-3">
          {!pushEnabled ? <PhoneSetupCard compact /> : null}
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileCheck2 className="h-4 w-4 text-primary" />
                Docs
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-2">
              {credentials.length > 0 ? (
                <div className="grid gap-2">
                  {credentials.map((credential) => (
                    <div
                      key={credential.id}
                      className="flex gap-3 rounded-md border bg-background p-2"
                    >
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
                        <img
                          src={credential.imageData}
                          alt={credential.label}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">
                          {credential.label}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {credential.expiryDate
                            ? `Expires ${new Date(credential.expiryDate).toLocaleDateString("en-AU")}`
                            : "No expiry date"}
                        </p>
                        {credential.notes ? (
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {credential.notes}
                          </p>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          deleteCredentialMutation.mutate(credential.id)
                        }
                        disabled={deleteCredentialMutation.isPending}
                        title="Delete document"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-dashed bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                  Upload your White Card, scissor lift licence, EWP ticket or
                  other site documents.
                </div>
              )}

              <div className="grid gap-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_10rem]">
                  <div className="space-y-1">
                    <Label className="text-xs">Document type</Label>
                    <Select
                      value={credentialDraft.documentType}
                      onValueChange={(value) =>
                        setCredentialDraft((draft) => ({
                          ...draft,
                          documentType: value,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CREDENTIAL_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Expiry date</Label>
                    <Input
                      type="date"
                      value={credentialDraft.expiryDate}
                      onChange={(event) =>
                        setCredentialDraft((draft) => ({
                          ...draft,
                          expiryDate: event.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Notes</Label>
                  <Input
                    value={credentialDraft.notes}
                    onChange={(event) =>
                      setCredentialDraft((draft) => ({
                        ...draft,
                        notes: event.target.value,
                      }))
                    }
                    placeholder="Card number, licence class, restrictions..."
                  />
                </div>
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border-2 border-dashed border-muted-foreground/30 bg-background px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted">
                  {uploadCredentialMutation.isPending ? (
                    <ImageIcon className="h-4 w-4 animate-pulse" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {uploadCredentialMutation.isPending
                    ? "Uploading..."
                    : `Upload ${credentialLabel(credentialDraft.documentType)}`}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleCredentialUpload}
                    disabled={uploadCredentialMutation.isPending}
                  />
                </label>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Job schedule */}
      {activeSection === "schedule" && subId && (
        <div className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Jobs</h2>
                <p className="text-sm text-muted-foreground">
                  {selectedDispatchDateLabel}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedDispatchDate(today)}
                disabled={isViewingToday}
              >
                Today
              </Button>
            </div>
            <div className="grid grid-cols-[2.5rem_1fr_2.5rem] gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10"
                onClick={() => moveDispatchDate(-1)}
                disabled={isViewingToday}
                title="Previous day"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Input
                type="date"
                value={selectedDispatchDate}
                min={today}
                onChange={(event) =>
                  setSelectedDispatchDate(event.target.value || today)
                }
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10"
                onClick={() => moveDispatchDate(1)}
                title="Next day"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {loadingDispatch ? (
            <div className="space-y-3">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : dispatchList?.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                <BriefcaseIcon className="h-8 w-8 mx-auto mb-2 opacity-20" />
                <p>
                  No jobs assigned for{" "}
                  {isViewingToday ? "today" : selectedDispatchDateLabel}.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {dispatchList?.map((assignment) => (
                <Card
                  key={assignment.id}
                  className={
                    assignment.status === "completed" ? "opacity-70" : ""
                  }
                >
                  <CardHeader className="p-4 pb-2">
                    <div className="flex justify-between items-start gap-2">
                      <CardTitle className="text-base">
                        {assignment.jobTitle}
                      </CardTitle>
                      <Badge
                        variant={
                          assignment.status === "completed"
                            ? "secondary"
                            : assignment.status === "in_progress" ||
                                assignment.status === "arrived"
                              ? "default"
                              : "outline"
                        }
                      >
                        {assignment.status.replace("_", " ")}
                      </Badge>
                    </div>
                    {assignment.workArea && (
                      <p className="mt-1 text-sm font-medium text-foreground">
                        {assignment.workArea}
                      </p>
                    )}
                  </CardHeader>
                  <CardContent className="p-4 pt-0 space-y-2 text-sm">
                    {assignment.jobAddress && (
                      <div className="flex items-start gap-2 text-muted-foreground">
                        <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>{assignment.jobAddress}</span>
                      </div>
                    )}
                    {assignment.builderContactName && (
                      <div className="flex items-start gap-2 text-muted-foreground">
                        <UsersIcon className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>
                          {assignment.builderContactName}{" "}
                          {assignment.builderContactPhone &&
                            `(${assignment.builderContactPhone})`}
                        </span>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline" className="text-xs">
                        {timeWindowLabels[
                          assignment.timeWindow ?? "full_day"
                        ] ?? assignment.timeWindow}
                      </Badge>
                      {(assignment.plannedStartTime ||
                        assignment.plannedEndTime) && (
                        <Badge variant="outline" className="text-xs">
                          {assignment.plannedStartTime || "Start"} -{" "}
                          {assignment.plannedEndTime || "Finish"}
                        </Badge>
                      )}
                      {assignment.estimatedMetres != null && (
                        <Badge variant="secondary" className="text-xs">
                          Target: {assignment.estimatedMetres}m
                        </Badge>
                      )}
                    </div>
                    {assignment.requiredColours &&
                      assignment.requiredColours.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {assignment.requiredColours.map((c) => (
                            <Badge
                              key={c}
                              variant="secondary"
                              className="text-xs bg-muted"
                            >
                              {c}
                            </Badge>
                          ))}
                        </div>
                      )}
                    {assignment.notes && (
                      <p className="rounded-md bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
                        {assignment.notes}
                      </p>
                    )}
                  </CardContent>
                  <CardFooter className="p-4 pt-0 flex gap-2">
                    {isViewingToday ? (
                      <>
                        {assignment.status === "pending" && (
                          <Button
                            className="w-full"
                            onClick={() =>
                              handleMarkArrived(
                                assignment.id,
                                assignment.jobAddress ?? undefined,
                              )
                            }
                            disabled={markArrived.isPending || !!locationPrompt}
                          >
                            Check In to Job
                          </Button>
                        )}
                        {(assignment.status === "arrived" ||
                          assignment.status === "in_progress") && (
                          <div className="flex w-full gap-2">
                            {assignment.status === "arrived" && (
                              <Button
                                variant="secondary"
                                className="flex-1"
                                onClick={() =>
                                  startWork.mutate({
                                    id: assignment.id,
                                    data: { status: "in_progress" },
                                  })
                                }
                                disabled={startWork.isPending}
                              >
                                Start Work
                              </Button>
                            )}
                            {isWorker ? (
                              <Button asChild className="flex-1">
                                <Link href={`/field/jobs/${assignment.id}`}>
                                  Submit Report & Leave Job
                                </Link>
                              </Button>
                            ) : (
                              <Button
                                className="flex-1"
                                onClick={() =>
                                  handleMarkDeparted(
                                    assignment.id,
                                    assignment.jobAddress ?? undefined,
                                  )
                                }
                                disabled={
                                  markDeparted.isPending || !!locationPrompt
                                }
                              >
                                Check Out of Job
                              </Button>
                            )}
                          </div>
                        )}
                        {assignment.status === "completed" &&
                          (assignment.hasJobReport ? (
                            <div className="flex w-full items-center justify-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                              <CheckCircle2 className="h-4 w-4 text-primary" />
                              <span>
                                Report submitted ·{" "}
                                {assignment.jobReportPhotoCount ?? 0} photo
                                {assignment.jobReportPhotoCount === 1
                                  ? ""
                                  : "s"}
                              </span>
                            </div>
                          ) : (
                            <Button
                              asChild
                              variant="outline"
                              className="w-full"
                            >
                              <Link href={`/field/jobs/${assignment.id}`}>
                                Submit Job Report
                              </Link>
                            </Button>
                          ))}
                      </>
                    ) : (
                      <div className="flex w-full items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                        <CalendarDays className="h-4 w-4 shrink-0" />
                        <span>Scheduled for {selectedDispatchDateLabel}</span>
                      </div>
                    )}
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {activeSection === "inventory" && subId && (
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-4 w-4 text-primary" />
              Stock
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4 pt-2">
            <div className="grid grid-cols-7 gap-1">
              {inventoryCalendarDates.map((value) => {
                const chip = formatCalendarChip(value);
                const selected = value === selectedDispatchDate;
                return (
                  <Button
                    key={value}
                    type="button"
                    variant={selected ? "default" : "outline"}
                    className="h-14 flex-col gap-0 px-1 text-xs"
                    onClick={() => setSelectedDispatchDate(value)}
                  >
                    <span>{chip.weekday}</span>
                    <span className="text-base font-semibold leading-5">
                      {chip.day}
                    </span>
                  </Button>
                );
              })}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">
                  Required for {selectedDispatchDateLabel}
                </p>
                <Badge variant="outline">
                  {selectedRequiredStock.length} item
                  {selectedRequiredStock.length === 1 ? "" : "s"}
                </Badge>
              </div>
              {loadingInventory || loadingDispatch ? (
                <Skeleton className="h-20 w-full" />
              ) : requiredStockStatus.length > 0 ? (
                <div className="space-y-2">
                  {requiredStockStatus.map(
                    ({ requirement, matches, total, unit }) => (
                      <div
                        key={requirement}
                        className="rounded-md border bg-background px-3 py-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{requirement}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {matches.length > 0
                                ? `${formatQty(total, unit)} currently recorded`
                                : "No matching stock currently recorded"}
                            </p>
                          </div>
                          <Badge
                            variant={
                              matches.length > 0 ? "secondary" : "destructive"
                            }
                          >
                            {matches.length > 0 ? "In stock" : "Check"}
                          </Badge>
                        </div>
                      </div>
                    ),
                  )}
                </div>
              ) : (
                <div className="rounded-md border border-dashed bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                  No stock requirements listed for this day.
                </div>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold">Current stock held</p>
              {loadingInventory ? (
                <Skeleton className="h-20 w-full" />
              ) : currentInventoryItems.length > 0 ? (
                <div className="space-y-2">
                  {currentInventoryItems.slice(0, 6).map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {item.stockItemName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.colour ?? "No colour recorded"}
                        </p>
                      </div>
                      <Badge
                        variant={
                          item.currentQuantity > 0 ? "secondary" : "destructive"
                        }
                      >
                        {formatQty(item.currentQuantity, item.unit)}
                      </Badge>
                    </div>
                  ))}
                  {currentInventoryItems.length > 6 ? (
                    <p className="text-xs text-muted-foreground">
                      +{currentInventoryItems.length - 6} more item
                      {currentInventoryItems.length - 6 === 1 ? "" : "s"}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-md border border-dashed bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                  No inventory has been recorded for this employee/subcontractor
                  yet.
                </div>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold">Stock movements</p>
              {loadingInventoryTransactions ? (
                <Skeleton className="h-16 w-full" />
              ) : selectedDayTransactions.length > 0 ? (
                <div className="space-y-2">
                  {selectedDayTransactions.map((transaction) => {
                    const isIncoming =
                      transaction.transactionType === "issued" ||
                      transaction.transactionType === "restock";
                    const MovementIcon = isIncoming ? ArrowDown : ArrowUp;
                    return (
                      <div
                        key={transaction.id}
                        className="flex items-center gap-3 rounded-md border bg-background px-3 py-2"
                      >
                        <MovementIcon
                          className={`h-4 w-4 shrink-0 ${isIncoming ? "text-green-600" : "text-amber-600"}`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {transaction.stockItemName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {inventoryTransactionLabel(
                              transaction.transactionType,
                            )}
                            {transaction.referenceNote
                              ? ` - ${transaction.referenceNote}`
                              : ""}
                          </p>
                        </div>
                        <Badge variant="outline">
                          {formatQty(transaction.quantity, transaction.unit)}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-md border border-dashed bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                  No stock movements recorded for this day.
                </div>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold">Restock requests</p>
              {loadingRestockRequests ? (
                <Skeleton className="h-16 w-full" />
              ) : openRestockRequests.length > 0 ? (
                <div className="space-y-2">
                  {openRestockRequests.map((request) => (
                    <div
                      key={request.id}
                      className="rounded-md border bg-background px-3 py-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {request.stockItemName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Requested{" "}
                            {formatQty(request.quantityRequested, request.unit)}
                            {request.adminNotes
                              ? ` - ${request.adminNotes}`
                              : ""}
                          </p>
                        </div>
                        <Badge
                          variant={
                            request.status === "approved"
                              ? "default"
                              : "secondary"
                          }
                        >
                          {request.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-dashed bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                  No open restock requests.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function BriefcaseIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="20" height="14" x="2" y="7" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}
function UsersIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
