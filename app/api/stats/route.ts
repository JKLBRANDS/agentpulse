import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  try {
    const [agents, agencies] = await Promise.all([
      supabase.from("agents").select("*", { count: "exact", head: true }),
      supabase.from("agencies").select("*", { count: "exact", head: true }),
    ]);

    return NextResponse.json({
      agentCount: agents.count ?? 0,
      agencyCount: agencies.count ?? 0,
      agentError: agents.error?.message ?? null,
      agencyError: agencies.error?.message ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
