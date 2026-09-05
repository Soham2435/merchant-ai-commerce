import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

function errorResponse(message, status, code) {
  return Response.json({ success: false, ...(code ? { code } : {}), message }, { status });
}

/**
 * POST /api/merchant/growth/approve
 * Body: { trigger_product_id, recommended_product_id, reason, rule_type }
 */
export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return errorResponse('Authentication required.', 401, 'unauthenticated');
  }

  // Parse request body
  let payload;
  try {
    payload = await request.json();
  } catch {
    return errorResponse('Invalid JSON body.', 400, 'invalid_request');
  }
  const { trigger_product_id, recommended_product_id, reason, rule_type } = payload ?? {};
  if (
    typeof trigger_product_id !== 'string' ||
    typeof recommended_product_id !== 'string' ||
    typeof reason !== 'string' ||
    typeof rule_type !== 'string' ||
    rule_type !== 'cross_sell' ||
    trigger_product_id === recommended_product_id ||
    !reason.trim()
  ) {
    return errorResponse('Invalid request payload.', 400, 'invalid_request');
  }

  // Call atomic RPC
  const { data, error } = await supabase.rpc('approve_growth_rule', {
    p_trigger_product_id: trigger_product_id,
    p_recommended_product_id: recommended_product_id,
    p_reason: reason,
    p_rule_type: rule_type,
  });

  if (error) {
    const msg = error.message || '';
    if (msg.includes('authentication required')) {
      return errorResponse('Authentication required.', 401, 'unauthenticated');
    }
    if (msg.includes('owner or admin')) {
      return errorResponse('User is not authorized to approve growth rules.', 403, 'unauthorized_role');
    }
    if (msg.includes('invalid request')) {
      return errorResponse('Invalid request payload.', 400, 'invalid_request');
    }
    if (msg.includes('invalid product')) {
      return errorResponse('Products invalid or not active.', 400, 'invalid_product');
    }
    if (msg.includes('duplicate rule') || error.code === '23505') {
      return errorResponse('This growth rule is already active.', 409, 'rule_already_active');
    }
    return errorResponse('Internal server error.', 500, 'internal_error');
  }

  const rule = data && data[0] ? data[0] : null;
  return Response.json({ success: true, rule });
}
