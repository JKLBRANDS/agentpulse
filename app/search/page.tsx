"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

const TOP_STATES = ["FL", "IA", "TX", "CA", "NY", "OH", "PA", "IL", "GA", "NC"];
const TIERS = ["A", "B", "C", "D"];
const AGENT_TYPES = ["all", "independent", "captive", "unknown"];
const EXP_RANGES = [
  { label: "All", min: 0, max: 999 },
  { label: "0-5", min: 0, max: 5 },
  { label: "5-10", min: 5, max: 10 },
  { label: "10-20", min: 10, max: 20 },
  { label: "20+", min: 20, max: 999 },
];
const SORT_OPTIONS = [
  { value: "composite_score", label: "Composite Score" },
  { value: "name", label: "Name" },
  { value: "state", label: "State" },
];
const PER_PAGE = 50;

interface Agent {
  id: string;
  npn: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  mailing_city: string;
  mailing_state: string;
  agent_type: string;
  has_life_license: boolean;
  has_health_license: boolean;
  has_pc_license: boolean;
  linkedin_search_url: string;
  years_experience: number;
  agent_scores: Array<{
    composite_score: number;
    quality_score: number;
    receptivity_score: number;
    tier: string;
  }>;
}

const TIER_BADGE: Record<string, string> = {
  A: "bg-green-900/50 text-green-400 border-green-700",
  B: "bg-blue-900/50 text-blue-400 border-blue-700",
  C: "bg-yellow-900/50 text-yellow-400 border-yellow-700",
  D: "bg-red-900/50 text-red-400 border-red-700",
};

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [licenses, setLicenses] = useState({ life: false, health: false, pc: false });
  const [selectedTiers, setSelectedTiers] = useState<string[]>([]);
  const [agentType, setAgentType] = useState("all");
  const [expRange, setExpRange] = useState(EXP_RANGES[0]);
  const [sortBy, setSortBy] = useState("composite_score");
  const [page, setPage] = useState(0);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("agents")
      .select("*, agent_scores(*)", { count: "exact" });

    if (query.trim()) {
      q = q.or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%,mailing_city.ilike.%${query}%`);
    }
    if (selectedStates.length > 0) {
      q = q.in("mailing_state", selectedStates);
    }
    if (licenses.life) q = q.eq("has_life_license", true);
    if (licenses.health) q = q.eq("has_health_license", true);
    if (licenses.pc) q = q.eq("has_pc_license", true);
    if (agentType !== "all") q = q.eq("agent_type", agentType);
    if (expRange.label !== "All") {
      q = q.gte("years_experience", expRange.min);
      if (expRange.max < 999) q = q.lte("years_experience", expRange.max);
    }

    // Sort
    if (sortBy === "name") {
      q = q.order("last_name", { ascending: true }).order("first_name", { ascending: true });
    } else if (sortBy === "state") {
      q = q.order("mailing_state", { ascending: true });
    } else {
      // Sort by composite_score - we'll do client-side since it's in a joined table
      q = q.order("last_name", { ascending: true });
    }

    q = q.range(page * PER_PAGE, (page + 1) * PER_PAGE - 1);

    const { data, count } = await q;
    let results = (data || []) as Agent[];

    // Filter by tier client-side (since it's in agent_scores)
    if (selectedTiers.length > 0) {
      results = results.filter((a) =>
        a.agent_scores?.some((s) => selectedTiers.includes(s.tier))
      );
    }

    // Sort by composite score client-side
    if (sortBy === "composite_score") {
      results.sort((a, b) => {
        const scoreA = a.agent_scores?.[0]?.composite_score ?? 0;
        const scoreB = b.agent_scores?.[0]?.composite_score ?? 0;
        return scoreB - scoreA;
      });
    }

    setAgents(results);
    setTotalCount(count ?? 0);
    setLoading(false);
  }, [query, selectedStates, licenses, selectedTiers, agentType, expRange, sortBy, page]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchAgents();
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [fetchAgents]);

  const totalPages = Math.ceil(totalCount / PER_PAGE);

  function toggleState(st: string) {
    setSelectedStates((prev) =>
      prev.includes(st) ? prev.filter((s) => s !== st) : [...prev, st]
    );
    setPage(0);
  }

  function toggleTier(t: string) {
    setSelectedTiers((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
    setPage(0);
  }

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-1">Agent Search</h1>
      <p className="text-gray-400 mb-6">Find and filter insurance agents</p>

      <div className="flex gap-6">
        {/* Filters Sidebar */}
        <div className="w-64 flex-shrink-0 space-y-6">
          {/* Text Search */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Search</label>
            <input
              type="text"
              placeholder="Name, email, city..."
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(0); }}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* State Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">State</label>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {TOP_STATES.map((st) => (
                <label key={st} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-white">
                  <input
                    type="checkbox"
                    checked={selectedStates.includes(st)}
                    onChange={() => toggleState(st)}
                    className="rounded border-gray-600 bg-gray-800 text-blue-600"
                  />
                  {st}
                </label>
              ))}
            </div>
          </div>

          {/* License Type */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">License Type</label>
            <div className="space-y-1">
              {([["life", "Life"], ["health", "Health"], ["pc", "P&C"]] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-white">
                  <input
                    type="checkbox"
                    checked={licenses[key]}
                    onChange={() => { setLicenses((p) => ({ ...p, [key]: !p[key] })); setPage(0); }}
                    className="rounded border-gray-600 bg-gray-800 text-blue-600"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {/* Tier Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Tier</label>
            <div className="flex gap-2">
              {TIERS.map((t) => (
                <button
                  key={t}
                  onClick={() => toggleTier(t)}
                  className={`px-3 py-1 rounded-lg text-sm font-medium border transition-colors ${
                    selectedTiers.includes(t)
                      ? TIER_BADGE[t]
                      : "border-gray-700 text-gray-400 hover:text-white"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Agent Type */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Agent Type</label>
            <div className="space-y-1">
              {AGENT_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-white">
                  <input
                    type="radio"
                    name="agentType"
                    checked={agentType === t}
                    onChange={() => { setAgentType(t); setPage(0); }}
                    className="border-gray-600 bg-gray-800 text-blue-600"
                  />
                  {t === "all" ? "All" : t.charAt(0).toUpperCase() + t.slice(1)}
                </label>
              ))}
            </div>
          </div>

          {/* Experience Range */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Years Experience</label>
            <div className="space-y-1">
              {EXP_RANGES.map((r) => (
                <label key={r.label} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-white">
                  <input
                    type="radio"
                    name="expRange"
                    checked={expRange.label === r.label}
                    onChange={() => { setExpRange(r); setPage(0); }}
                    className="border-gray-600 bg-gray-800 text-blue-600"
                  />
                  {r.label}
                </label>
              ))}
            </div>
          </div>

          {/* Sort */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Sort By</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-400">
              {loading ? "Searching..." : `${totalCount.toLocaleString()} agents found`}
            </p>
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Prev
              </button>
              <span>Page {page + 1} of {Math.max(1, totalPages)}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left text-gray-400">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">Tier</th>
                  <th className="px-4 py-3 font-medium">Licenses</th>
                  <th className="px-4 py-3 font-medium">LinkedIn</th>
                </tr>
              </thead>
              <tbody>
                {agents.length === 0 && !loading && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                      No agents found matching your criteria.
                    </td>
                  </tr>
                )}
                {agents.map((a) => {
                  const score = a.agent_scores?.[0];
                  return (
                    <tr key={a.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/agent/${a.npn}`} className="text-blue-400 hover:underline font-medium">
                          {a.first_name} {a.last_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-300">{a.email || "—"}</td>
                      <td className="px-4 py-3 text-gray-300">{a.phone || "—"}</td>
                      <td className="px-4 py-3 text-gray-300">
                        {[a.mailing_city, a.mailing_state].filter(Boolean).join(", ") || "—"}
                      </td>
                      <td className="px-4 py-3">
                        {score?.tier ? (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${TIER_BADGE[score.tier] || ""}`}>
                            {score.tier}
                          </span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {a.has_life_license && <LicenseBadge label="L" color="text-green-400 bg-green-900/50" />}
                          {a.has_health_license && <LicenseBadge label="H" color="text-blue-400 bg-blue-900/50" />}
                          {a.has_pc_license && <LicenseBadge label="PC" color="text-purple-400 bg-purple-900/50" />}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {a.linkedin_search_url ? (
                          <a
                            href={a.linkedin_search_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300"
                          >
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                            </svg>
                          </a>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function LicenseBadge({ label, color }: { label: string; color: string }) {
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${color}`}>
      {label}
    </span>
  );
}
