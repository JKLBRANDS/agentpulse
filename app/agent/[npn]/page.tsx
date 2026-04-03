"use client";

import { useEffect, useState, use } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

interface Agent {
  id: string;
  npn: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  mailing_address: string;
  mailing_city: string;
  mailing_state: string;
  mailing_zip: string;
  first_licensed_date: string;
  years_experience: number;
  is_active: boolean;
  agent_type: string;
  primary_carrier: string;
  data_sources: Record<string, unknown> | null;
  has_life_license: boolean;
  has_health_license: boolean;
  has_pc_license: boolean;
  life_carrier_type: string;
  is_fl_resident: boolean;
  cms_marketplace_registered: boolean;
  linkedin_search_url: string;
  agent_scores: Array<{
    quality_score: number;
    receptivity_score: number;
    composite_score: number;
    tier: string;
    score_version: number;
    scored_at: string;
  }>;
}

const TIER_BADGE: Record<string, string> = {
  A: "bg-green-900/50 text-green-400 border-green-700",
  B: "bg-blue-900/50 text-blue-400 border-blue-700",
  C: "bg-yellow-900/50 text-yellow-400 border-yellow-700",
  D: "bg-red-900/50 text-red-400 border-red-700",
};

export default function AgentDetailPage({
  params,
}: {
  params: Promise<{ npn: string }>;
}) {
  const { npn } = use(params);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data, error } = await supabase
        .from("agents")
        .select("*, agent_scores(*)")
        .eq("npn", npn)
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        setNotFound(true);
      } else {
        setAgent(data as Agent);
      }
      setLoading(false);
    }
    load();
  }, [npn]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-400">Loading agent profile...</p>
      </div>
    );
  }

  if (notFound || !agent) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-gray-400 text-lg">Agent not found (NPN: {npn})</p>
        <Link href="/search" className="text-blue-400 hover:underline">Back to Search</Link>
      </div>
    );
  }

  const score = agent.agent_scores?.[0];

  return (
    <div className="max-w-4xl mx-auto">
      {/* Back link */}
      <Link href="/search" className="text-sm text-gray-400 hover:text-white mb-4 inline-block">
        &larr; Back to Search
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold">
              {agent.first_name} {agent.last_name}
            </h1>
            {score?.tier && (
              <span className={`px-3 py-1 rounded-full text-sm font-semibold border ${TIER_BADGE[score.tier] || ""}`}>
                Tier {score.tier}
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 text-gray-400 text-sm">
            <span>NPN: {agent.npn}</span>
            <span className="capitalize">{agent.agent_type || "Unknown"} Agent</span>
            {agent.is_active && (
              <span className="text-green-400">Active</span>
            )}
          </div>
        </div>
        {agent.linkedin_search_url && (
          <a
            href={agent.linkedin_search_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
            </svg>
            Search LinkedIn
          </a>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Contact Info */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">Contact Information</h2>
          <dl className="space-y-3">
            <InfoRow label="Email" value={agent.email} />
            <InfoRow label="Phone" value={agent.phone} />
            <InfoRow
              label="Address"
              value={[agent.mailing_address, agent.mailing_city, agent.mailing_state, agent.mailing_zip].filter(Boolean).join(", ")}
            />
            <InfoRow label="FL Resident" value={agent.is_fl_resident ? "Yes" : "No"} />
            <InfoRow label="Primary Carrier" value={agent.primary_carrier} />
            <InfoRow label="Life Carrier Type" value={agent.life_carrier_type} />
            <InfoRow label="CMS Marketplace" value={agent.cms_marketplace_registered ? "Registered" : "Not registered"} />
          </dl>
        </div>

        {/* Scoring Breakdown */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">Scoring Breakdown</h2>
          {score ? (
            <div className="space-y-5">
              <ScoreBar label="Quality Score" value={score.quality_score} max={100} color="bg-green-500" />
              <ScoreBar label="Receptivity Score" value={score.receptivity_score} max={100} color="bg-blue-500" />
              <ScoreBar label="Composite Score" value={score.composite_score} max={100} color="bg-purple-500" />
              <div className="pt-2 border-t border-gray-800 text-sm text-gray-400">
                <p>Version: {score.score_version}</p>
                <p>Scored: {score.scored_at ? new Date(score.scored_at).toLocaleDateString() : "N/A"}</p>
              </div>
            </div>
          ) : (
            <p className="text-gray-500">No scoring data available.</p>
          )}
        </div>

        {/* Licenses */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">License Information</h2>
          <div className="space-y-3">
            <LicenseRow label="Life Insurance" active={agent.has_life_license} />
            <LicenseRow label="Health Insurance" active={agent.has_health_license} />
            <LicenseRow label="Property & Casualty" active={agent.has_pc_license} />
          </div>
          <div className="mt-4 pt-4 border-t border-gray-800 space-y-2 text-sm text-gray-400">
            <p>First Licensed: {agent.first_licensed_date || "Unknown"}</p>
            <p>Years Experience: {agent.years_experience ?? "Unknown"}</p>
          </div>
        </div>

        {/* Data Sources */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">Data Sources</h2>
          {agent.data_sources && Object.keys(agent.data_sources).length > 0 ? (
            <div className="space-y-2">
              {Object.entries(agent.data_sources).map(([key, value]) => (
                <div key={key} className="flex items-start gap-2 text-sm">
                  <span className="text-gray-400 min-w-[120px]">{key}:</span>
                  <span className="text-gray-200 break-all">
                    {typeof value === "object" ? JSON.stringify(value) : String(value ?? "—")}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No data source information available.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <dt className="text-gray-400 min-w-[120px]">{label}</dt>
      <dd className="text-gray-200">{value || "—"}</dd>
    </div>
  );
}

function ScoreBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-gray-300">{label}</span>
        <span className="text-white font-semibold">{value}</span>
      </div>
      <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
        <div className={`${color} h-full rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function LicenseRow({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-300">{label}</span>
      {active ? (
        <span className="flex items-center gap-1 text-green-400">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Licensed
        </span>
      ) : (
        <span className="text-gray-600">Not licensed</span>
      )}
    </div>
  );
}
