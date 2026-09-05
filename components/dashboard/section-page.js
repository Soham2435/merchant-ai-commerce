import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export function SectionPage({ eyebrow, title, description, emptyTitle, emptyDescription, label, children }) {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      {children ? children : <EmptyState title={emptyTitle} description={emptyDescription} label={label} />}
    </div>
  );
}
