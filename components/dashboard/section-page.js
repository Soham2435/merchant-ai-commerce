import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export function SectionPage({ eyebrow, title, description, emptyTitle, emptyDescription, label }) {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <EmptyState title={emptyTitle} description={emptyDescription} label={label} />
    </div>
  );
}
