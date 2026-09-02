import { SectionPage } from "@/components/dashboard/section-page";

export default function CustomersPage() {
  return (
    <SectionPage
      eyebrow="Relationships"
      title="Customers"
      description="Understand the people behind your commerce activity."
      emptyTitle="Customer profiles will appear here"
      emptyDescription="Connect a customer source to explore customer activity and retention signals."
      label="Customer workspace"
    />
  );
}
