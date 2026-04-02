import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const maxDuration = 60;

export async function POST() {
  try {
    const supabase = supabaseAdmin();

    // Download FL state CSV data
    const csvUrl =
      "https://data.florida.gov/api/views/4fgh-wm4c/rows.csv?accessType=DOWNLOAD";
    const response = await fetch(csvUrl);

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to download CSV: ${response.statusText}` },
        { status: 502 }
      );
    }

    const csvText = await response.text();
    const lines = csvText.split("\n").filter((line) => line.trim());

    if (lines.length < 2) {
      return NextResponse.json(
        { error: "CSV has no data rows" },
        { status: 400 }
      );
    }

    const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map((v) => v.trim().replace(/"/g, ""));
      const row: Record<string, string> = {};
      headers.forEach((header, idx) => {
        row[header] = values[idx] ?? "";
      });
      rows.push(row);
    }

    // Upsert in batches of 500
    const batchSize = 500;
    let upserted = 0;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error } = await supabase.from("agents").upsert(batch, {
        onConflict: "id",
        ignoreDuplicates: false,
      });

      if (error) {
        return NextResponse.json(
          {
            error: `Upsert failed at batch ${Math.floor(i / batchSize)}: ${error.message}`,
            upsertedSoFar: upserted,
          },
          { status: 500 }
        );
      }
      upserted += batch.length;
    }

    return NextResponse.json({
      success: true,
      totalRows: rows.length,
      upserted,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
