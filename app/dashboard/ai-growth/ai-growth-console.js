"use client";
import { useState } from 'react';

export default function AiGrowthConsole({ merchantId }) {
  const [status, setStatus] = useState('idle'); // idle, loading, error, proposal, approving, approved
  const [error, setError] = useState(null);
  const [opportunity, setOpportunity] = useState(null);
  const [rule, setRule] = useState(null);

  const fetchOpportunity = async () => {
    setStatus('loading');
    setError(null);
    try {
      const res = await fetch('/api/merchant/growth/opportunity', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        const msgMap = {
          insufficient_catalog: 'Not enough active products to generate an opportunity.',
          ai_rate_limited: 'AI service is temporarily unavailable. Please try again later.',
          invalid_ai_output: 'AI returned malformed data.',
          internal_error: 'An unexpected error occurred.',
        };
        setError(msgMap[data.code] || data.message || 'Error fetching opportunity');
        setStatus('error');
        return;
      }
      setOpportunity(data.opportunity);
      setStatus('proposal');
    } catch (e) {
      setError('Network error while fetching opportunity.');
      setStatus('error');
    }
  };

  const approveRule = async () => {
    if (!opportunity) return;
    setStatus('approving');
    setError(null);
    try {
      const res = await fetch('/api/merchant/growth/approve', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trigger_product_id: opportunity.trigger_product_id,
          recommended_product_id: opportunity.recommended_product_id,
          reason: opportunity.reason,
          rule_type: opportunity.rule_type,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msgMap = {
          rule_already_active: 'This growth rule is already active.',
          unauthorized_role: 'You do not have permission to approve growth rules.',
          invalid_product: 'Product validation failed.',
          internal_error: 'An unexpected error occurred.',
          audit_failure: 'Rule persisted but audit logging failed.',
        };
        setError(msgMap[data.code] || data.message || 'Error approving rule');
        setStatus('error');
        return;
      }
      setRule(data.rule);
      setStatus('approved');
    } catch (e) {
      setError('Network error while approving rule.');
      setStatus('error');
    }
  };

  const renderContent = () => {
    switch (status) {
      case 'idle':
        return (
          <button onClick={fetchOpportunity} className="px-4 py-2 bg-blue-600 text-white rounded">
            Find growth opportunity
          </button>
        );
      case 'loading':
        return <p>Analyzing your active catalog…</p>;
      case 'proposal':
        return (
          <div className="space-y-4">
            <h3 className="font-semibold">Cross‑sell opportunity</h3>
            <p><strong>Trigger product:</strong> {opportunity.trigger_product_id}</p>
            <p><strong>Recommended product:</strong> {opportunity.recommended_product_id}</p>
            <p><strong>Reason:</strong> {opportunity.reason}</p>
            <p><strong>Rule type:</strong> {opportunity.rule_type}</p>
            <button onClick={approveRule} className="px-4 py-2 bg-green-600 text-white rounded mr-2">
              Approve growth rule
            </button>
            <button onClick={fetchOpportunity} className="px-4 py-2 bg-gray-300 rounded">
              Find another opportunity
            </button>
          </div>
        );
      case 'approving':
        return <p>Approving rule…</p>;
      case 'approved':
        return (
          <div className="space-y-2">
            <h3 className="font-semibold">Growth rule active</h3>
            <p><strong>Trigger product:</strong> {rule.trigger_product_id}</p>
            <p><strong>Recommended product:</strong> {rule.recommended_product_id}</p>
            <p><strong>Rule type:</strong> {rule.rule_type}</p>
            <p><strong>Status:</strong> active</p>
          </div>
        );
      case 'error':
        return (
          <div className="text-red-600">
            <p>{error}</p>
            <button onClick={fetchOpportunity} className="px-4 py-2 bg-blue-600 text-white rounded mt-2">
              Try again
            </button>
          </div>
        );
      default:
        return null;
    }
  };

  return <div className="p-4 border rounded bg-[var(--surface)]">{renderContent()}</div>;
}
