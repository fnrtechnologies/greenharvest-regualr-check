import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import Layout from "../components/Layout";
import UserTable, { UserRow } from "../components/UserTable";

function getMonthYear() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

interface QueueRow {
  user_id    : string;
  status     : string;
  error      : string | null;
  started_at : string | null;
  finished_at: string | null;
}

export default function Dashboard() {
  const [users,      setUsers]      = useState<UserRow[]>([]);
  const [queue,      setQueue]      = useState<QueueRow[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [monthYear,  setMonthYear]  = useState(getMonthYear());
  const [notifiedAt, setNotifiedAt] = useState<string | null>(null);

  useEffect(() => {
    fetchData();

    const runDate = `${monthYear}-01`;
    const channel = supabase
      .channel(`dashboard-${runDate}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scrape_queue", filter: `run_date=eq.${runDate}` },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          const row = payload.new as QueueRow;
          setQueue((prev) => {
            const idx = prev.findIndex((q) => q.user_id === row.user_id);
            if (idx === -1) return [...prev, row];
            const next = [...prev];
            next[idx] = row;
            return next;
          });
          setUsers((prev) =>
            prev.map((u) => (u.id === row.user_id ? { ...u, scrape_status: row.status, scrape_error: row.error } : u))
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scrape_run_summaries", filter: `run_date=eq.${runDate}` },
        (payload) => {
          const row = payload.new as { notified_at: string | null } | null;
          setNotifiedAt(row?.notified_at ?? null);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [monthYear]);

  async function fetchData() {
    setLoading(true);
    const runDate = `${monthYear}-01`;

    const [usersRes, queueRes, summaryRes] = await Promise.all([
      supabase
        .from("users")
        .select("id, gh_id, name, username, bank, gh_portal_name, inv, order_no, groups(name), payouts(amount, payout_date, month_year), earnings(total_income, month_year)")
        .order("order_no", { ascending: true, nullsFirst: false })
        .order("name"),
      supabase
        .from("scrape_queue")
        .select("user_id, status, error, started_at, finished_at")
        .eq("run_date", runDate),
      supabase
        .from("scrape_run_summaries")
        .select("notified_at")
        .eq("run_date", runDate)
        .maybeSingle(),
    ]);

    const queueMap = new Map((queueRes.data ?? []).map((q: QueueRow) => [q.user_id, q]));

    const rows: UserRow[] = (usersRes.data ?? []).map((u: any) => {
      const payout  = (u.payouts  as any[]).find((p) => p.month_year === monthYear);
      const earning = (u.earnings as any[]).find((e) => e.month_year === monthYear);
      const qRow    = queueMap.get(u.id) as QueueRow | undefined;
      return {
        id            : u.id,
        gh_id         : u.gh_id,
        name          : u.name,
        username      : u.username,
        bank          : u.bank ?? null,
        gh_portal_name: u.gh_portal_name ?? null,
        inv           : u.inv ?? null,
        order_no      : u.order_no ?? null,
        group_name    : u.groups?.name ?? null,
        payout_amount : payout?.amount ?? null,
        payout_date   : payout?.payout_date ?? null,
        month_year    : payout?.month_year ?? monthYear,
        total_income  : earning?.total_income ?? null,
        scrape_status : qRow?.status ?? null,
        scrape_error  : qRow?.error ?? null,
        all_payouts   : (u.payouts as any[]).map((p) => ({
          amount     : p.amount ?? null,
          month_year : p.month_year,
          payout_date: p.payout_date ?? null,
        })),
      };
    });

    setUsers(rows);
    setQueue(queueRes.data ?? []);
    setNotifiedAt(summaryRes.data?.notified_at ?? null);
    setLoading(false);
  }

  const runDate   = `${monthYear}-01`;
  const done      = queue.filter((q) => q.status === "done").length;
  const failed    = queue.filter((q) => q.status === "failed").length;
  const running   = queue.filter((q) => q.status === "processing").length;
  const pending   = queue.filter((q) => q.status === "pending").length;
  const hasQueue  = queue.length > 0;
  const lastRun   = queue
    .filter((q) => q.finished_at)
    .sort((a, b) => new Date(b.finished_at!).getTime() - new Date(a.finished_at!).getTime())[0]?.finished_at;

  const scraped = hasQueue ? done : users.filter((u) => u.payout_amount).length;

  const notifyTime = notifiedAt
    ? new Date(notifiedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) + " IST"
    : "not yet";

  const stats = [
    { label: "Total Users", value: users.length,             sub: "in system" },
    { label: "Scraped",     value: scraped,                  sub: hasQueue ? `of ${queue.length}` : "have payouts", color: "text-green-600" },
    { label: "Failed",      value: hasQueue ? failed : "—",  sub: hasQueue ? (failed > 0 ? "need retry" : "all good") : "no run yet", color: failed > 0 ? "text-red-500" : undefined },
    { label: "Running",     value: hasQueue ? running : "—", sub: "in progress", color: running > 0 ? "text-yellow-600" : undefined },
    { label: "Pending",     value: hasQueue ? pending : "—", sub: "in queue" },
    { label: "Notified",    value: notifiedAt ? "✓" : "—",   sub: notifyTime, color: notifiedAt ? "text-green-600" : "text-gray-300" },
  ];

  return (
    <Layout>
      <div className="px-4 sm:px-8 py-6 sm:py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 sm:mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-sm text-gray-400 mt-0.5">Payout overview by month</p>
          </div>
          <input
            type="month"
            value={monthYear}
            onChange={(e) => setMonthYear(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 self-start sm:self-auto"
          />
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-6">
          {stats.map((s) => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{s.label}</p>
              <p className={`text-4xl font-bold mt-2 ${s.color ?? "text-gray-900"}`}>{s.value}</p>
              <p className="text-xs text-gray-400 mt-1">{s.sub}</p>
            </div>
          ))}
        </div>

        {/* Scrape run progress bar */}
        {hasQueue && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-4 mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
              <div>
                <p className="text-sm font-semibold text-gray-800">
                  Scrape Run — {monthYear}
                </p>
                {lastRun && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    Last activity:{" "}
                    {new Date(lastRun).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST
                  </p>
                )}
              </div>
              <div className="flex items-center gap-4 text-xs font-medium">
                <span className="flex items-center gap-1.5 text-green-600">
                  <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                  {done} Done
                </span>
                {failed > 0 && (
                  <span className="flex items-center gap-1.5 text-red-500">
                    <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />
                    {failed} Failed
                  </span>
                )}
                {running > 0 && (
                  <span className="flex items-center gap-1.5 text-blue-600">
                    <span className="w-2 h-2 rounded-full bg-blue-400 inline-block animate-pulse" />
                    {running} Running
                  </span>
                )}
                {pending > 0 && (
                  <span className="flex items-center gap-1.5 text-yellow-600">
                    <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
                    {pending} Pending
                  </span>
                )}
              </div>
            </div>
            <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full flex">
                <div className="bg-green-500 transition-all" style={{ width: `${(done / queue.length) * 100}%` }} />
                <div className="bg-red-400 transition-all"   style={{ width: `${(failed / queue.length) * 100}%` }} />
                <div className="bg-blue-400 transition-all"  style={{ width: `${(running / queue.length) * 100}%` }} />
                <div className="bg-yellow-300 transition-all" style={{ width: `${(pending / queue.length) * 100}%` }} />
              </div>
            </div>
          </div>
        )}

        {/* User table */}
        {loading ? (
          <div className="flex items-center justify-center h-48 bg-white rounded-xl border border-gray-100 shadow-sm">
            <p className="text-sm text-gray-400">Loading…</p>
          </div>
        ) : (
          <UserTable users={users} monthYear={monthYear} runDate={runDate} onRefresh={fetchData} showGroups />
        )}
      </div>
    </Layout>
  );
}
