"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

const COLUMNS = ["Prospect", "Contacted", "Interested", "Onboarding", "Recruited"] as const;
type Column = (typeof COLUMNS)[number];

interface PipelineCard {
  agent_id: string;
  npn: string;
  name: string;
  tier: string;
  state: string;
  column: Column;
}

const TIER_BADGE: Record<string, string> = {
  A: "bg-green-900/50 text-green-400 border-green-700",
  B: "bg-blue-900/50 text-blue-400 border-blue-700",
  C: "bg-yellow-900/50 text-yellow-400 border-yellow-700",
  D: "bg-red-900/50 text-red-400 border-red-700",
};

const COLUMN_COLORS: Record<Column, string> = {
  Prospect: "border-gray-500",
  Contacted: "border-blue-500",
  Interested: "border-yellow-500",
  Onboarding: "border-purple-500",
  Recruited: "border-green-500",
};

const LS_KEY = "agentpulse_pipeline";

function loadPipeline(): PipelineCard[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePipeline(cards: PipelineCard[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(cards));
}

export default function PipelinePage() {
  const [cards, setCards] = useState<PipelineCard[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ id: string; npn: string; first_name: string; last_name: string; mailing_state: string; agent_scores: Array<{ tier: string }> }>>([]);
  const [searching, setSearching] = useState(false);
  const [movingCard, setMovingCard] = useState<string | null>(null);

  useEffect(() => {
    setCards(loadPipeline());
  }, []);

  const updateCards = useCallback((newCards: PipelineCard[]) => {
    setCards(newCards);
    savePipeline(newCards);
  }, []);

  const searchAgents = useCallback(async (q: string) => {
    if (!q.trim()) { setSearchResults([]); return; }
    setSearching(true);
    const { data } = await supabase
      .from("agents")
      .select("id, npn, first_name, last_name, mailing_state, agent_scores(tier)")
      .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,npn.ilike.%${q}%`)
      .limit(10);
    setSearchResults(data || []);
    setSearching(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => searchAgents(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery, searchAgents]);

  function addToPipeline(agent: (typeof searchResults)[0]) {
    if (cards.some((c) => c.agent_id === agent.id)) return;
    const newCard: PipelineCard = {
      agent_id: agent.id,
      npn: agent.npn,
      name: `${agent.first_name} ${agent.last_name}`,
      tier: agent.agent_scores?.[0]?.tier || "—",
      state: agent.mailing_state || "—",
      column: "Prospect",
    };
    updateCards([...cards, newCard]);
    setShowAdd(false);
    setSearchQuery("");
    setSearchResults([]);
  }

  function moveCard(agentId: string, newColumn: Column) {
    updateCards(cards.map((c) => (c.agent_id === agentId ? { ...c, column: newColumn } : c)));
    setMovingCard(null);
  }

  function removeCard(agentId: string) {
    updateCards(cards.filter((c) => c.agent_id !== agentId));
  }

  return (
    <div className="max-w-full mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-1">Recruitment Pipeline</h1>
          <p className="text-gray-400">Track agents through the recruitment process</p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors"
        >
          + Add Agent
        </button>
      </div>

      {/* Add Agent Modal */}
      {showAdd && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
          <h3 className="text-lg font-semibold mb-3">Search for an agent to add</h3>
          <input
            type="text"
            placeholder="Search by name or NPN..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 mb-3"
            autoFocus
          />
          {searching && <p className="text-gray-500 text-sm">Searching...</p>}
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {searchResults.map((a) => {
              const already = cards.some((c) => c.agent_id === a.id);
              return (
                <button
                  key={a.id}
                  onClick={() => !already && addToPipeline(a)}
                  disabled={already}
                  className={`w-full text-left px-4 py-2 rounded-lg text-sm flex items-center justify-between transition-colors ${
                    already ? "opacity-40 cursor-not-allowed bg-gray-800" : "hover:bg-gray-800"
                  }`}
                >
                  <span>
                    {a.first_name} {a.last_name} <span className="text-gray-500">({a.npn})</span>
                  </span>
                  <span className="text-gray-500">{a.mailing_state}</span>
                </button>
              );
            })}
          </div>
          <button
            onClick={() => { setShowAdd(false); setSearchQuery(""); setSearchResults([]); }}
            className="mt-3 text-sm text-gray-400 hover:text-white"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Kanban Board */}
      <div className="grid grid-cols-5 gap-4 min-h-[600px]">
        {COLUMNS.map((col) => {
          const colCards = cards.filter((c) => c.column === col);
          return (
            <div key={col} className={`bg-gray-900/50 border-t-2 ${COLUMN_COLORS[col]} rounded-xl p-3`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-200">{col}</h3>
                <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
                  {colCards.length}
                </span>
              </div>
              <div className="space-y-2">
                {colCards.map((card) => (
                  <div
                    key={card.agent_id}
                    className="bg-gray-900 border border-gray-800 rounded-lg p-3 hover:border-gray-600 transition-colors group"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <p className="text-sm font-medium text-white leading-tight">{card.name}</p>
                      <button
                        onClick={() => removeCard(card.agent_id)}
                        className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                        title="Remove from pipeline"
                      >
                        x
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      {card.tier !== "—" && (
                        <span className={`px-1.5 py-0.5 rounded text-xs font-semibold border ${TIER_BADGE[card.tier] || "border-gray-700 text-gray-400"}`}>
                          {card.tier}
                        </span>
                      )}
                      <span className="text-xs text-gray-500">{card.state}</span>
                    </div>

                    {/* Move controls */}
                    {movingCard === card.agent_id ? (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {COLUMNS.filter((c) => c !== col).map((c) => (
                          <button
                            key={c}
                            onClick={() => moveCard(card.agent_id, c)}
                            className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
                          >
                            {c}
                          </button>
                        ))}
                        <button
                          onClick={() => setMovingCard(null)}
                          className="text-xs px-2 py-1 text-gray-500 hover:text-white"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setMovingCard(card.agent_id)}
                        className="text-xs text-gray-500 hover:text-blue-400 transition-colors mt-1"
                      >
                        Move &rarr;
                      </button>
                    )}
                  </div>
                ))}
                {colCards.length === 0 && (
                  <p className="text-xs text-gray-600 text-center py-4">No agents</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
