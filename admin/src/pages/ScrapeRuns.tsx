import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import Layout from "../components/Layout";

interface QueueDetail {
  user_id    : string;
  status     : string;
  error      : string | null;
  started_at : string | null;
  finished_at: string | null;
  users      : { name: string; gh_id: string } | null;
}

interface RunSummary {
  run_date    : string;
  total       : number;
  done        : number;
  failed      : number;
  running     : number;
  pending     : number;
  rows        : QueueDetail[];
  notified_at : string | null;
}

function recount(rows: QueueDetail[]) {
  return {
    total  : rows.length,
    done   : rows.filter((r) => r.status === "done").length,
    failed : rows.filter((r) => r.status === "failed").length,
    running: rows.filter((r) => r.status === "processing").length,
    pending: rows.filter((r) => r.status === "pending").length,
  };
}

function duration(row: QueueDetail): string {
  if (!row.started_at || !row.finished_at) return "—";
  const s = Math.round(
    (new Date(row.finished_at).getTime() - new Date(row.started_at).getTime()) / 1000
  );
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function NotifyBadge({ notifiedAt }: { notifiedAt: string | null }) {
  if (!notifiedAt) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400 bg-gray-50 border border-gray-100 px-2.5 py-1 rounded-full">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-300 inline-block" />
        Not notified
      </span>
    );
  }
  const time = new Date(notifiedAt).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day     : "2-digit",
    month   : "short",
    hour    : "2-digit",
    minute  : "2-digit",
  });
  return (
    <span
      title={`Telegram sent at ${time} IST`}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-100 px-2.5 py-1 rounded-full"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
      Notified · {time} IST
    </span>
  );
}

export default function ScrapeRuns() {
  const [runs,     setRuns]     = useState<RunSummary[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    fetchRuns();

    const channel = supabase
      .channel("scrape-runs")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scrape_queue" },
        (payload) => {
          if (payload.eventType !== "UPDATE") {
            // INSERT (new run started) / DELETE — re-fetch so joined user data + run grouping stay correct
            fetchRuns();
            return;
          }
          const updated = payload.new as any;
          setRuns((prev) =>
            prev.map((run) => {
              if (run.run_date !== updated.run_date) return run;
              const rows = run.rows.map((r) =>
                r.user_id === updated.user_id
                  ? { ...r, status: updated.status, error: updated.error, started_at: updated.started_at, finished_at: updated.finished_at }
                  : r
              );
              return { ...run, rows, ...recount(rows) };
            })
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scrape_run_summaries" },
        (payload) => {
          const row = payload.new as { run_date: string; notified_at: string | null } | null;
          if (!row) return;
          setRuns((prev) => prev.map((run) => (run.run_date === row.run_date ? { ...run, notified_at: row.notified_at } : run)));
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  async function fetchRuns() {
    setLoading(true);
    const [queueRes, summaryRes] = await Promise.all([
      supabase
        .from("scrape_queue")
        .select("run_date, user_id, status, error, started_at, finished_at, users(name, gh_id)")
        .order("run_date", { ascending: false }),
      supabase
        .from("scrape_run_summaries")
        .select("run_date, notified_at"),
    ]);

    if (!queueRes.data) { setLoading(false); return; }

    const summaryMap = new Map(
      (summaryRes.data ?? []).map((s: any) => [s.run_date as string, s.notified_at as string | null])
    );

    const grouped = new Map<string, RunSummary>();
    for (const row of queueRes.data as any[]) {
      const d = row.run_date as string;
      if (!grouped.has(d)) {
        grouped.set(d, {
          run_date    : d,
          total       : 0,
          done        : 0,
          failed      : 0,
          running     : 0,
          pending     : 0,
          rows        : [],
          notified_at : summaryMap.get(d) ?? null,
        });
      }
      const g = grouped.get(d)!;
      g.total++;
      if (row.status === "done")             g.done++;
      else if (row.status === "failed")      g.failed++;
      else if (row.status === "processing")  g.running++;
      else if (row.status === "pending")     g.pending++;
      g.rows.push(row as QueueDetail);
    }

    setRuns(Array.from(grouped.values()));
    setLoading(false);
  }

  function monthLabel(runDate: string) {
    return new Date(runDate + "T00:00:00").toLocaleDateString("en-IN", {
      month: "long",
      year : "numeric",
    });
  }

  return (
    <Layout>
      <div className="px-4 sm:px-8 py-6 sm:py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Scrape Runs</h1>
          <p className="text-sm text-gray-400 mt-0.5">Monthly scrape history per user</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48 bg-white rounded-xl border border-gray-100 shadow-sm">
            <p className="text-sm text-gray-400">Loading…</p>
          </div>
        ) : runs.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
            <p className="text-gray-400 text-sm font-medium">No scrape runs yet</p>
            <p className="text-gray-300 text-xs mt-1">Runs automatically on the 1st of each month at 12:00 PM IST</p>
          </div>
        ) : (
          <div className="space-y-3">
            {runs.map((run) => (
              <div key={run.run_date} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                {/* Run header row */}
                <div className="px-4 sm:px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  {/* Left: month + counts */}
                  <button
                    onClick={() => setExpanded(expanded === run.run_date ? null : run.run_date)}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1.5 sm:gap-6 hover:opacity-80 transition-opacity text-left"
                  >
                    <span className="font-semibold text-gray-900 text-sm">{monthLabel(run.run_date)}</span>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium">
                      <span className="flex items-center gap-1.5 text-green-600">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                        {run.done} done
                      </span>
                      {run.failed > 0 && (
                        <span className="flex items-center gap-1.5 text-red-500">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
                          {run.failed} failed
                        </span>
                      )}
                      {run.running > 0 && (
                        <span className="flex items-center gap-1.5 text-blue-600">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block animate-pulse" />
                          {run.running} running
                        </span>
                      )}
                      {run.pending > 0 && (
                        <span className="flex items-center gap-1.5 text-yellow-600">
                          <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" />
                          {run.pending} pending
                        </span>
                      )}
                      <span className="text-gray-300">·</span>
                      <span className="text-gray-400">{run.total} users</span>
                    </div>
                  </button>

                  {/* Right: notification badge + progress + expand toggle */}
                  <div className="flex items-center gap-3 sm:gap-4">
                    <NotifyBadge notifiedAt={run.notified_at} />
                    <div className="hidden sm:block w-28 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full flex">
                        <div className="bg-green-500"  style={{ width: `${(run.done    / run.total) * 100}%` }} />
                        <div className="bg-red-400"    style={{ width: `${(run.failed  / run.total) * 100}%` }} />
                        <div className="bg-blue-400"   style={{ width: `${(run.running / run.total) * 100}%` }} />
                        <div className="bg-yellow-300" style={{ width: `${(run.pending / run.total) * 100}%` }} />
                      </div>
                    </div>
                    <button
                      onClick={() => setExpanded(expanded === run.run_date ? null : run.run_date)}
                      className="text-gray-300 text-xs hover:text-gray-500 transition-colors"
                    >
                      {expanded === run.run_date ? "▲" : "▼"}
                    </button>
                  </div>
                </div>

                {/* Expanded per-user details */}
                {expanded === run.run_date && (
                  <div className="border-t border-gray-100 overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="px-5 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Name</th>
                          <th className="px-5 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">GH ID</th>
                          <th className="px-5 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Status</th>
                          <th className="px-5 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Duration</th>
                          <th className="px-5 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Error</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {run.rows.map((row) => (
                          <tr key={row.user_id} className="hover:bg-gray-50/60">
                            <td className="px-5 py-2.5 font-medium text-gray-800 text-sm">{row.users?.name ?? "—"}</td>
                            <td className="px-5 py-2.5 font-mono text-xs text-gray-500">{row.users?.gh_id ?? "—"}</td>
                            <td className="px-5 py-2.5">
                              {row.status === "done"       && <span className="text-xs bg-green-50 text-green-700 border border-green-100 px-2 py-0.5 rounded-full font-medium">Done</span>}
                              {row.status === "failed"     && <span className="text-xs bg-red-50 text-red-600 border border-red-100 px-2 py-0.5 rounded-full font-medium">Failed</span>}
                              {row.status === "processing" && <span className="text-xs bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-full font-medium">Running</span>}
                              {row.status === "pending"    && <span className="text-xs bg-gray-50 text-gray-400 border border-gray-100 px-2 py-0.5 rounded-full font-medium">Pending</span>}
                            </td>
                            <td className="px-5 py-2.5 text-xs text-gray-400 font-mono">{duration(row)}</td>
                            <td className="px-5 py-2.5 text-xs text-red-400 max-w-xs truncate" title={row.error ?? ""}>
                              {row.error ?? <span className="text-gray-200">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
