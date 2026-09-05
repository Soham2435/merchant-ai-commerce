import { createClient } from '@/lib/supabase/server';
import { SectionPage } from '@/components/dashboard/section-page';
import AiGrowthConsole from './ai-growth-console';

export default async function AIGrowthPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <SectionPage
        eyebrow="AI Growth"
        title="AI Growth"
        description="Turn your catalog into revenue opportunities."
        emptyTitle="Sign in required"
        emptyDescription="Sign in to view AI Growth tools."
        label="Authentication"
      />
    );
  }

  // Resolve merchant membership (same pattern as other dashboard pages)
  const { data: memberships } = await supabase
    .from('merchant_members')
    .select('merchant_id')
    .eq('user_id', user.id);

  const merchantId = memberships?.length === 1 ? memberships[0].merchant_id : null;

  if (!merchantId) {
    return (
      <SectionPage
        eyebrow="AI Growth"
        title="AI Growth"
        description="Turn your catalog into revenue opportunities."
        emptyTitle="No merchant workspace"
        emptyDescription="Join or create a merchant workspace to use AI Growth."
        label="Workspace"
      />
    );
  }

  return (
    <SectionPage
      eyebrow="AI Growth"
      title="AI Growth"
      description="Turn your catalog into revenue opportunities."
    >
      <AiGrowthConsole merchantId={merchantId} />
    </SectionPage>
  );
}
