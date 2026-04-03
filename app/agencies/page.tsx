"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";

const PER_PAGE = 50;

interface Agency {
  id: string;
  name: string;
  npn: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  has_life_partner: boolean;
  source_state: string;
}

export default function AgenciesPage() {
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [npnFilter, setNpnFilter] = useState("");
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fetchAgencies = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("agencies")
      .select("*", { count: "exact" });

    if (query.trim()) {
      q = q.or(`name.ilike.%${query}%,email.ilike.%${query}%,city.ilike.%${query}%`);
    }
    if (stateFilter.trim()) {
      q = q.ilike("state", stateFilter.trim());
    }
    if (npnFilter.trim()) {
      q = q.ilike("npn", `%${npnFilter.trim()}%`);
    }

    q = q.order("name", { ascending: true })
      .range(page * PER_PAGE, (page + 1) * PER_PAGE - 1);

    const { data, count } = await q;
    setAgencies((data || []) as Agency[]);
    setTotalCount(count ?? 0);
    setLoading(false);
  }, [query, stateFilter, npnFilter, page]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchAgencies();
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [fetchAgencies]);

  const totalPages = Math.ceil(totalCount / PER_PAGE);

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-1">Agency Search</h1>
      <p className="text-gray-400 mb-6">Browse and search insurance agencies</p>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <input
          type="text"
          placeholder="Search name, email, city..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(0); }}
          className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        <input
          type="text"
          placeholder="State (e.g. FL)"
          value={stateFilter}
          onChange={(e) => { setStateFilter(e.target.value); setPage(0); }}
          className="w-32 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        <input
          type="text"
          placeholder="NPN"
          value={npnFilter}
          onChange={(e) => { setNpnFilter(e.target.value); setPage(0); }}
          className="w-40 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Results info + pagination */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-400">
          {loading ? "Searching..." : `${totalCount.toLocaleString()} agencies found`}
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

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-gray-400">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">NPN</th>
              <th className="px-4 py-3 font-medium">Location</th>
              <th className="px-4 py-3 font-medium">Phone</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Life Partner</th>
            </tr>
          </thead>
          <tbody>
            {agencies.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  No agencies found.
                </td>
              </tr>
            )}
            {agencies.map((a) => (
              <tr key={a.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                <td className="px-4 py-3 font-medium text-white">{a.name || "—"}</td>
                <td className="px-4 py-3 text-gray-300">{a.npn || "—"}</td>
                <td className="px-4 py-3 text-gray-300">
                  {[a.city, a.state].filter(Boolean).join(", ")}{a.zip ? ` ${a.zip}` : ""}
                </td>
                <td className="px-4 py-3 text-gray-300">{a.phone || "—"}</td>
                <td className="px-4 py-3 text-gray-300">{a.email || "—"}</td>
                <td className="px-4 py-3">
                  {a.has_life_partner ? (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-900/50 text-green-400 border border-green-700">Yes</span>
                  ) : (
                    <span className="text-gray-600">No</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
