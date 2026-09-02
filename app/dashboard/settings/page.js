import { SectionPage } from "@/components/dashboard/section-page";

export default function SettingsPage() {
  return (
    <SectionPage
      eyebrow="Workspace"
      title="Settings"
      description="Configure the workspace as the product grows."
      emptyTitle="Workspace settings are coming soon"
      emptyDescription="This area will hold preferences and integrations without changing your commerce data model."
      label="Settings workspace"
    />
  );
}
