"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import type { PieLabelRenderProps } from "recharts";

interface TierCount { tier: string; count: number }
interface AgentTypeCount { agent_type: string; count: number }
interface StateCount { state: string; count: number }
interface RecentScore {
  id: string;
  composite_score: number;
  tier: string;
  scored_at: string;
  agent_id: string;
  first_name?: string;
  last_name?: string;
}

const TIER_COLORS: Record<string, string> = {
  A: "#22c55e", B: "#3b82f6", C: "#eab308", D: "#ef4444",
};

const TYPE_COLORS = ["#6366f1", "#f59e0b", "#94a3b8"];

export default function Dashboard() {
  const [totalAgents, setTotalAgents] = useState<number>(0);
  const [tierCounts, setTierCounts] = useState<TierCount[]>([]);
  const [typeCounts, setTypeCounts] = useState<AgentTypeCount[]>([]);
  const [stateCounts, setStateCounts] = useState<StateCount[]>([]);
  const [recentScores, setRecentScores] = useState<RecentScore[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);

      // Total agents
      const { count } = await supabase
        .from("agents")
        .select("*", { count: "exact", head: true });
      setTotalAgents(count ?? 0);

      // Tier distribution from agent_scores
      const { data: scores } = await supabase
        .from("agent_scores")
        .select("tier");
      if (scores) {
        const map: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
        scores.forEach((s) => { if (s.tier) map[s.tier] = (map[s.tier] || 0) + 1; });
        setTierCounts(Object.entries(map).map(([tier, count]) => ({ tier, count })));
      }

      // Agent types
      const { data: agents } = await supabase
        .from("agents")
        .select("agent_type");
      if (agents) {
        const map: Record<string, number> = {};
        agents.forEach((a) => {
          const t = a.agent_type || "unknown";
          map[t] = (map[t] || 0) + 1;
        });
        setTypeCounts(Object.entries(map).map(([agent_type, count]) => ({ agent_type, count })));
      }

      // Top 10 states
      const { data: stateAgents } = await supabase
        .from("agents")
        .select("mailing_state");
      if (stateAgents) {
        const map: Record<string, number> = {};
        stateAgents.forEach((a) => {
          const s = a.mailing_state || "Unknown";
          map[s] = (map[s] || 0) + 1;
        });
        const sorted = Object.entries(map)
          .map(([state, count]) => ({ state, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);
        setStateCounts(sorted);
      }

      // Recent scoring
      const { data: recent } = await supabase
        .from("agent_scores")
        .select("id, composite_score, tier, scored_at, agent_id")
        .order("scored_at", { ascending: false })
        .limit(10);
      if (recent) {
        // Fetch agent names
        const agentIds = [...new Set(recent.map((r) => r.agent_id))];
        const { data: agentNames } = await supabase
          .from("agents")
          .select("id, first_name, last_name")
          .in("id", agentIds);
        const nameMap: Record<string, { first_name: string; last_name: string }> = {};
        agentNames?.forEach((a) => { nameMap[a.id] = a; });
        setRecentScores(
          recent.map((r) => ({
            ...r,
            first_name: nameMap[r.agent_id]?.first_name,
            last_name: nameMap[r.agent_id]?.last_name,
          }))
        );
      }

      setLoading(false);
    }
    fetchData();
  }, []);

  const tierTotal = tierCounts.reduce((s, t) => s + t.count, 0);

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-1">Dashboard</h1>
      <p className="text-gray-400 mb-8">Overview of agent recruitment metrics</p>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-400">Loading dashboard...</div>
        </div>
      ) : (
        <>
          {/* Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
            <MetricCard label="Total Agents" value={totalAgents.toLocaleString()} />
            {tierCounts.map((t) => (
              <MetricCard
                key={t.tier}
                label={`Tier ${t.tier}`}
                value={t.count.toLocaleString()}
                color={TIER_COLORS[t.tier]}
              />
            ))}
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Tier Distribution Bar Chart */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h2 className="text-lg font-semibold mb-4">Tier Distribution</h2>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={tierCounts}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="tier" stroke="#9ca3af" />
                  <YAxis stroke="#9ca3af" />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: "8px" }}
                    labelStyle={{ color: "#fff" }}
                    itemStyle={{ color: "#d1d5db" }}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {tierCounts.map((entry) => (
                      <Cell key={entry.tier} fill={TIER_COLORS[entry.tier] || "#6b7280"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Agent Type Pie Chart */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h2 className="text-lg font-semibold mb-4">Agent Types</h2>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={typeCounts}
                    dataKey="count"
                    nameKey="agent_type"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label={(props: PieLabelRenderProps) => {
                      const name = String(props.name ?? "");
                      const percent = Number(props.percent ?? 0);
                      return `${name} (${(percent * 100).toFixed(0)}%)`;
                    }}
                    labelLine={false}
                  >
                    {typeCounts.map((_, i) => (
                      <Cell key={i} fill={TYPE_COLORS[i % TYPE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: "8px" }}
                    itemStyle={{ color: "#d1d5db" }}
                  />
                  <Legend wrapperStyle={{ color: "#9ca3af" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Bottom Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top States */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h2 className="text-lg font-semibold mb-4">Agents by State (Top 10)</h2>
              <div className="space-y-3">
                {stateCounts.map((s) => (
                  <div key={s.state} className="flex items-center gap-3">
                    <span className="w-10 text-sm font-medium text-gray-300">{s.state}</span>
                    <div className="flex-1 bg-gray-800 rounded-full h-6 overflow-hidden">
                      <div
                        className="bg-blue-600 h-full rounded-full flex items-center pl-2 text-xs font-medium"
                        style={{ width: `${Math.max((s.count / (stateCounts[0]?.count || 1)) * 100, 8)}%` }}
                      >
                        {s.count.toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Scoring */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h2 className="text-lg font-semibold mb-4">Recent Scoring Activity</h2>
              <div className="space-y-2">
                {recentScores.length === 0 && (
                  <p className="text-gray-500 text-sm">No scoring activity yet.</p>
                )}
                {recentScores.map((s) => (
                  <div key={s.id} className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
                    <div>
                      <p className="text-sm font-medium">
                        {s.first_name} {s.last_name}
                      </p>
                      <p className="text-xs text-gray-500">
                        Score: {s.composite_score} | {s.scored_at ? new Date(s.scored_at).toLocaleDateString() : "N/A"}
                      </p>
                    </div>
                    <TierBadge tier={s.tier} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <p className="text-gray-400 text-sm mb-1">{label}</p>
      <p className="text-2xl font-bold" style={color ? { color } : undefined}>
        {value}
      </p>
    </div>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const colors: Record<string, string> = {
    A: "bg-green-900/50 text-green-400 border-green-700",
    B: "bg-blue-900/50 text-blue-400 border-blue-700",
    C: "bg-yellow-900/50 text-yellow-400 border-yellow-700",
    D: "bg-red-900/50 text-red-400 border-red-700",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${colors[tier] || "bg-gray-800 text-gray-400 border-gray-700"}`}>
      {tier}
    </span>
  );
}
