import { SectionPage } from "@/components/dashboard/section-page";

export default function ProductsPage() {
  return (
    <SectionPage
      eyebrow="Catalog"
      title="Products"
      description="Keep your catalog organized and ready for your customers."
      emptyTitle="Your product catalog will live here"
      emptyDescription="Connect a product source to manage items, inventory, and product performance from one place."
      label="Product workspace"
    />
  );
}
