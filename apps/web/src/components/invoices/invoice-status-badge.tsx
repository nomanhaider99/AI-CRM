import { AlertCircle, CheckCircle2, FilePen, Send } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { InvoiceDisplayStatus } from "@/lib/invoices";
import { displayStatus, INVOICE_STATUS_LABELS } from "@/lib/invoices";
import type { Invoice } from "@/lib/types";

const STYLE: Record<InvoiceDisplayStatus, { tone: "neutral" | "primary" | "success" | "danger"; icon: LucideIcon }> = {
  draft: { tone: "neutral", icon: FilePen },
  sent: { tone: "primary", icon: Send },
  paid: { tone: "success", icon: CheckCircle2 },
  overdue: { tone: "danger", icon: AlertCircle },
};

// Icon and label carry the meaning, so status is never color-only (and survives a grayscale print).
export function InvoiceStatusBadge({ invoice, className }: { invoice: Pick<Invoice, "status" | "dueDate">; className?: string }) {
  const status = displayStatus(invoice);
  const { tone, icon: Icon } = STYLE[status];
  return (
    <Badge tone={tone} className={className}>
      <Icon className="size-3.5" aria-hidden="true" />
      {INVOICE_STATUS_LABELS[status]}
    </Badge>
  );
}
