"use client";

import { useEffect, useState } from "react";

interface Stats {
  agentCount: number;
  agencyCount: number;
  agentError: string | null;
  agencyError: string | null;
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [ingesting, setIngesting] = useState(false);
  const [ingestResult, setIngestResult] = useState<string | null>(null);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/stats");
      const data = await res.json();
      setStats(data);
    } catch {
      setStats(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const handleIngestFL = async () => {
    setIngesting(true);
    setIngestResult(null);
    try {
      const res = await fetch("/api/ingest-fl", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setIngestResult(`Success! Loaded ${data.upserted} rows.`);
        fetchStats();
      } else {
        setIngestResult(`Error: ${data.error}`);
      }
    } catch (err) {
      setIngestResult(
        `Error: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setIngesting(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-2">AgentPulse</h1>
        <p className="text-gray-400 mb-8">
          Real-time dashboard for agent &amp; agency data
        </p>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-10">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <p className="text-gray-400 text-sm mb-1">Agents</p>
            <p className="text-3xl font-bold">
              {loading ? "..." : stats?.agentCount?.toLocaleString() ?? "—"}
            </p>
            {stats?.agentError && (
              <p className="text-red-400 text-xs mt-2">{stats.agentError}</p>
            )}
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <p className="text-gray-400 text-sm mb-1">Agencies</p>
            <p className="text-3xl font-bold">
              {loading ? "..." : stats?.agencyCount?.toLocaleString() ?? "—"}
            </p>
            {stats?.agencyError && (
              <p className="text-red-400 text-xs mt-2">{stats.agencyError}</p>
            )}
          </div>
        </div>

        {/* Data Ingestion */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4">Data Ingestion</h2>
          <div className="flex flex-wrap gap-4">
            <button
              onClick={handleIngestFL}
              disabled={ingesting}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed px-6 py-2 rounded-lg font-medium transition-colors"
            >
              {ingesting ? "Loading FL Data..." : "Ingest FL State Data"}
            </button>
            <button
              onClick={fetchStats}
              disabled={loading}
              className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 px-6 py-2 rounded-lg font-medium transition-colors"
            >
              Refresh Stats
            </button>
          </div>
          {ingestResult && (
            <p
              className={`mt-4 text-sm ${ingestResult.startsWith("Success") ? "text-green-400" : "text-red-400"}`}
            >
              {ingestResult}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
