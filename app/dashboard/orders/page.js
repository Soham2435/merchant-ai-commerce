import { SectionPage } from "@/components/dashboard/section-page";

export default function OrdersPage() {
  return (
    <SectionPage
      eyebrow="Operations"
      title="Orders"
      description="Track order flow and keep fulfillment moving."
      emptyTitle="Orders will appear here"
      emptyDescription="When an order source is connected, you will be able to review status and fulfillment activity here."
      label="Order workspace"
    />
  );
}
