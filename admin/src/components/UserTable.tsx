import React, { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import PayoutBadge from "./PayoutBadge";
import UserPayoutModal from "./UserPayoutModal";

export interface UserRow {
  id             : string;
  gh_id          : string;
  name           : string;
  username       : string;
  bank?          : string | null;
  gh_portal_name?: string | null;
  inv?           : number | null;
  order_no?      : number | null;
  group_name?    : string | null;
  payout_amount? : string | null;
  payout_date?   : string | null;
  month_year?    : string | null;
  total_income?  : string | null;
  scrape_status? : string | null;
  scrape_error?  : string | null;
  all_payouts?   : Array<{ amount: string | null; month_year: string; payout_date?: string | null }>;
}

interface Props {
  users      : UserRow[];
  monthYear  : string;
  runDate?   : string;
  onRefresh? : () => void;
  showGroups?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseAmount(val: string | null | undefined): number {
  if (!val) return 0;
  // Remove all non-digit, non-period, non-comma chars, then strip leading period
  // "Rs.24333" → ".24333" → "24333"; "₹24,333.50" → "24,333.50" → "24333.50"
  const n = parseFloat(
    val.replace(/[^\d.,]/g, "").replace(/^\./, "").replace(/,/g, "")
  );
  return isNaN(n) ? 0 : n;
}

function fmtINR(val: number): string {
  if (val === 0) return "—";
  return "₹" + val.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function userTotalPayout(u: UserRow): number {
  return (u.all_payouts ?? []).reduce((s, p) => s + parseAmount(p.amount), 0);
}

interface Totals { inv: number; payoutCount: number; payout: number; totalPayout: number; income: number; }

function computeTotals(rows: UserRow[]): Totals {
  return {
    inv        : rows.reduce((s, u) => s + (u.inv ?? 0), 0),
    payoutCount: rows.reduce((s, u) => s + (u.all_payouts?.length ?? 0), 0),
    payout     : rows.reduce((s, u) => s + parseAmount(u.payout_amount), 0),
    totalPayout: rows.reduce((s, u) => s + userTotalPayout(u), 0),
    income     : rows.reduce((s, u) => s + parseAmount(u.total_income), 0),
  };
}

function matchesFilter(u: UserRow, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return [u.name, u.gh_id, u.username, u.bank, u.gh_portal_name, u.group_name]
    .some((v) => v?.toLowerCase().includes(needle));
}

type SortKey =
  | "order" | "name" | "gh_id" | "bank" | "inv"
  | "payoutCount" | "totalPayout" | "payout" | "income" | "payout_date";
type SortDir = "asc" | "desc";

function compareRows(a: UserRow, b: UserRow, key: SortKey): number {
  switch (key) {
    case "order":       return (a.order_no ?? Infinity) - (b.order_no ?? Infinity);
    case "name":        return a.name.localeCompare(b.name);
    case "gh_id":       return a.gh_id.localeCompare(b.gh_id);
    case "bank":        return (a.bank ?? "").localeCompare(b.bank ?? "");
    case "inv":         return (a.inv ?? 0) - (b.inv ?? 0);
    case "payoutCount": return (a.all_payouts?.length ?? 0) - (b.all_payouts?.length ?? 0);
    case "totalPayout": return userTotalPayout(a) - userTotalPayout(b);
    case "payout":      return parseAmount(a.payout_amount) - parseAmount(b.payout_amount);
    case "income":      return parseAmount(a.total_income) - parseAmount(b.total_income);
    case "payout_date": return (a.payout_date ?? "").localeCompare(b.payout_date ?? "");
  }
}

function sortRows(rows: UserRow[], key: SortKey, dir: SortDir): UserRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const primary = compareRows(a, b, key);
    return primary !== 0 ? sign * primary : a.name.localeCompare(b.name);
  });
}

function SortArrow({ dir }: { dir: SortDir }) {
  return <span className="text-[9px] ml-1">{dir === "asc" ? "▲" : "▼"}</span>;
}

function groupRows(users: UserRow[]): Array<{ name: string | null; rows: UserRow[] }> {
  const map = new Map<string, UserRow[]>();
  for (const u of users) {
    const key = u.group_name ?? "";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(u);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => {
      if (a === "") return 1;
      if (b === "") return -1;
      return a.localeCompare(b);
    })
    .map(([key, rows]) => ({ name: key || null, rows }));
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ScrapeBadge({ user, runDate, onRefresh }: { user: UserRow; runDate?: string; onRefresh?: () => void }) {
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    setRetrying(true);
    try {
      // Starts a full GitHub Actions scrape run (all users); it resets and updates the queue rows itself.
      const { error } = await supabase.rpc("dispatch_scrape");
      if (error) { alert(`Retry failed: ${error.message}`); return; }
      onRefresh?.();
    } finally {
      setRetrying(false);
    }
  }

  if (!user.scrape_status) return <span className="text-gray-200 text-xs">—</span>;
  if (user.scrape_status === "done") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-100">✓ Done</span>
  );
  if (user.scrape_status === "failed") return (
    <div className="flex items-center gap-2">
      <span title={user.scrape_error ?? ""} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-600 border border-red-100 cursor-help">✕ Failed</span>
      <button onClick={retry} disabled={retrying} className="text-xs text-blue-500 hover:text-blue-700 disabled:opacity-40 font-medium transition">
        {retrying ? "…" : "Retry"}
      </button>
    </div>
  );
  if (user.scrape_status === "processing") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-50 text-yellow-700 border border-yellow-100">⟳ Running</span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-50 text-gray-400 border border-gray-100">· Pending</span>
  );
}

// Sticky-column styling for the frozen Name / GH ID columns. `bg` should be an
// opaque background class matching the row's tint so scrolled content doesn't show through.
// On small screens the frozen columns shrink and their text wraps so the rest of the
// table remains viewable without excessive horizontal scroll.
//
// The GH ID column's `left` offset must equal the Name column's *rendered* width — but
// table-auto layout grows columns to fit content/breakpoint, so a hardcoded offset would
// drift and the two sticky columns would overlap once scrolled. Instead it's measured at
// runtime (see `nameColWidth` below) and applied as an inline style.
function freezeCls(frozen: boolean, col: "name" | "ghid", bg: string): string {
  if (!frozen) return "";
  return col === "name"
    ? `${bg} w-20 sm:w-40 text-[11px] sm:text-xs`
    : `${bg} w-16 sm:w-28 text-[11px] sm:text-xs`;
}

function freezeStyle(frozen: boolean, leftPx: number): React.CSSProperties | undefined {
  return frozen ? { position: "sticky", left: leftPx, zIndex: 10 } : undefined;
}

function TotalRow({ totals, label, showScrape, bold, frozen }: { totals: Totals; label: string; showScrape: boolean; bold?: boolean; frozen: boolean }) {
  const bg   = bold ? "border-t-2 border-emerald-100 bg-emerald-50/40" : "border-t border-blue-100 bg-blue-50/50";
  const text = bold ? "font-bold text-emerald-800" : "font-semibold text-blue-700";
  const stickyBg = bold ? "bg-emerald-50" : "bg-blue-50";
  return (
    <tr className={bg}>
      <td colSpan={2} style={freezeStyle(frozen, 0)} className={`px-4 py-2.5 text-xs uppercase tracking-wider truncate ${text} ${frozen ? stickyBg : ""}`}>{label}</td>
      <td className="px-4 py-2.5" />
      <td className={`px-4 py-2.5 text-right font-mono text-xs ${text}`}>
        {totals.inv > 0 ? totals.inv.toLocaleString("en-IN") : "—"}
      </td>
      <td className={`px-4 py-2.5 text-right font-mono text-xs ${text}`}>
        {totals.payoutCount > 0 ? totals.payoutCount : "—"}
      </td>
      <td className={`px-4 py-2.5 text-right font-mono text-xs ${text}`}>{fmtINR(totals.totalPayout)}</td>
      <td className={`px-4 py-2.5 font-mono text-xs ${bold ? "font-bold text-emerald-700" : "font-semibold text-emerald-600"}`}>
        {fmtINR(totals.payout)}
      </td>
      <td className={`px-4 py-2.5 text-right font-mono text-xs ${bold ? "font-bold text-emerald-700" : "font-semibold text-emerald-600"}`}>
        {fmtINR(totals.income)}
      </td>
      <td className="px-4 py-2.5" />
      {showScrape && <td className="px-4 py-2.5" />}
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function UserTable({ users, monthYear, runDate, onRefresh, showGroups = false }: Props) {
  const [historyUser, setHistoryUser] = useState<UserRow | null>(null);
  const [isGrouped,   setIsGrouped]   = useState(showGroups);
  const [collapsed,   setCollapsed]   = useState<Set<string>>(new Set());
  const [frozen,      setFrozen]      = useState(true);
  const [search,      setSearch]      = useState("");
  const [sortKey,     setSortKey]     = useState<SortKey>("order");
  const [sortDir,     setSortDir]     = useState<SortDir>("asc");

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  // Measure the Name column's rendered width so the GH ID column can stick at the
  // correct offset — table-auto layout sizes columns by content, so this can't be hardcoded.
  const nameThRef = useRef<HTMLTableCellElement | null>(null);
  const [nameColWidth, setNameColWidth] = useState(0);

  useEffect(() => {
    if (!frozen) return;
    const el = nameThRef.current;
    if (!el) return;
    const update = () => setNameColWidth(el.getBoundingClientRect().width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [frozen, isGrouped, users]);

  const showScrape = users.some((u) => u.scrape_status != null);
  const canGroup   = users.some((u) => u.group_name);

  function toggleCollapse(name: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  const visible     = sortRows(users.filter((u) => matchesFilter(u, search)), sortKey, sortDir);
  const groups      = isGrouped ? groupRows(visible) : [{ name: null, rows: visible }];
  const groupNames  = groups.map((g) => g.name).filter((n): n is string => n !== null);
  const allCollapsed = groupNames.length > 0 && groupNames.every((n) => collapsed.has(n));

  function expandAll()   { setCollapsed(new Set()); }
  function collapseAll() { setCollapsed(new Set(groupNames)); }
  const grandTotals = computeTotals(visible);

  if (!users.length) return <p className="text-sm text-gray-400 mt-4">No users found.</p>;

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="relative">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none">
              <circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, GH ID, bank, group…"
              className="pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 w-56"
            />
          </div>
          {search && (
            <button onClick={() => setSearch("")} className="text-xs text-gray-400 hover:text-gray-600 transition">
              Clear
            </button>
          )}
          {search && (
            <span className="text-xs text-gray-400">{visible.length} of {users.length}</span>
          )}
        </div>

        <div className="flex items-center gap-3">
        <button
          onClick={() => setFrozen((v) => !v)}
          className={`text-xs px-3 py-1.5 rounded-lg font-medium border transition ${
            frozen
              ? "bg-amber-50 text-amber-700 border-amber-100 hover:bg-amber-100"
              : "bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100"
          }`}
        >
          {frozen ? "Unfreeze columns" : "Freeze columns"}
        </button>

        {canGroup && isGrouped && groupNames.length > 1 && (
          <button
            onClick={allCollapsed ? expandAll : collapseAll}
            className="text-xs px-3 py-1.5 rounded-lg font-medium bg-blue-50 text-blue-600 border border-blue-100 hover:bg-blue-100 transition"
          >
            {allCollapsed ? "Expand all" : "Collapse all"}
          </button>
        )}

        {canGroup && (
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setIsGrouped(true)}
              className={`text-xs px-3 py-1.5 rounded-md font-medium transition ${
                isGrouped ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Grouped
            </button>
            <button
              onClick={() => setIsGrouped(false)}
              className={`text-xs px-3 py-1.5 rounded-md font-medium transition ${
                !isGrouped ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Flat
            </button>
          </div>
        )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th
                  ref={nameThRef}
                  style={freezeStyle(frozen, 0)}
                  onClick={() => toggleSort("name")}
                  className={`px-2 sm:px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors ${sortKey === "name" ? "text-gray-700" : "text-gray-400 hover:text-gray-600"} ${freezeCls(frozen, "name", "bg-gray-50")}`}
                >
                  Name{sortKey === "name" && <SortArrow dir={sortDir} />}
                </th>
                <th
                  style={freezeStyle(frozen, nameColWidth)}
                  onClick={() => toggleSort("gh_id")}
                  className={`px-2 sm:px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors ${sortKey === "gh_id" ? "text-gray-700" : "text-gray-400 hover:text-gray-600"} ${freezeCls(frozen, "ghid", "bg-gray-50")}`}
                >
                  GH ID{sortKey === "gh_id" && <SortArrow dir={sortDir} />}
                </th>
                <th onClick={() => toggleSort("bank")} className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors ${sortKey === "bank" ? "text-gray-700" : "text-gray-400 hover:text-gray-600"}`}>
                  Bank{sortKey === "bank" && <SortArrow dir={sortDir} />}
                </th>
                <th onClick={() => toggleSort("inv")} className={`px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors ${sortKey === "inv" ? "text-gray-700" : "text-gray-400 hover:text-gray-600"}`}>
                  Investment{sortKey === "inv" && <SortArrow dir={sortDir} />}
                </th>
                <th onClick={() => toggleSort("payoutCount")} className={`px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors ${sortKey === "payoutCount" ? "text-gray-700" : "text-gray-400 hover:text-gray-600"}`}>
                  Payouts{sortKey === "payoutCount" && <SortArrow dir={sortDir} />}
                </th>
                <th onClick={() => toggleSort("totalPayout")} className={`px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors ${sortKey === "totalPayout" ? "text-gray-700" : "text-gray-400 hover:text-gray-600"}`}>
                  Total Payout{sortKey === "totalPayout" && <SortArrow dir={sortDir} />}
                </th>
                <th onClick={() => toggleSort("payout")} className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors ${sortKey === "payout" ? "text-gray-700" : "text-gray-400 hover:text-gray-600"}`}>
                  Payout{sortKey === "payout" && <SortArrow dir={sortDir} />}
                </th>
                <th onClick={() => toggleSort("income")} className={`px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors ${sortKey === "income" ? "text-gray-700" : "text-gray-400 hover:text-gray-600"}`}>
                  Est. Next{sortKey === "income" && <SortArrow dir={sortDir} />}
                </th>
                <th onClick={() => toggleSort("payout_date")} className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors ${sortKey === "payout_date" ? "text-gray-700" : "text-gray-400 hover:text-gray-600"}`}>
                  Payout Date{sortKey === "payout_date" && <SortArrow dir={sortDir} />}
                </th>
                {showScrape && (
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Scrape</th>
                )}
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-50">
              {visible.length === 0 && (
                <tr>
                  <td colSpan={9 + (showScrape ? 1 : 0)} className="px-4 py-10 text-center text-sm text-gray-400">
                    No users match “{search}”.
                  </td>
                </tr>
              )}
              {groups.map((group, groupIndex) => {
                const isCollapsed  = group.name !== null && collapsed.has(group.name);
                const groupTotals  = computeTotals(group.rows);
                const collapsible  = group.name !== null;

                return (
                  <React.Fragment key={group.name ?? "__ungrouped__"}>
                    {/* Spacer between groups */}
                    {isGrouped && groupIndex > 0 && (
                      <tr aria-hidden="true">
                        <td colSpan={9 + (showScrape ? 1 : 0)} className="p-0 h-3 bg-gray-100 border-0" />
                      </tr>
                    )}

                    {/* Group header */}
                    {isGrouped && (
                      <tr
                        className={`bg-indigo-50/50 border-y border-indigo-100 ${collapsible ? "cursor-pointer hover:bg-indigo-50 transition-colors" : ""}`}
                        onClick={() => collapsible && toggleCollapse(group.name!)}
                      >
                        <td colSpan={2} style={freezeStyle(frozen, 0)} className={`px-4 py-2.5 ${frozen ? "bg-indigo-50" : ""}`}>
                          <div className="flex items-center gap-2 truncate">
                            {collapsible && (
                              <span className="text-indigo-300 text-xs w-3 shrink-0 select-none">
                                {isCollapsed ? "▶" : "▼"}
                              </span>
                            )}
                            {group.name ? (
                              <span className="text-xs font-bold text-indigo-700 uppercase tracking-wider truncate">{group.name}</span>
                            ) : (
                              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider italic">No Group</span>
                            )}
                            <span className="text-xs text-indigo-400 shrink-0">
                              · {group.rows.length} member{group.rows.length !== 1 ? "s" : ""}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5" />
                        <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-500">
                          {isCollapsed && groupTotals.inv > 0 && (
                            <span className="font-semibold text-gray-700">{groupTotals.inv.toLocaleString("en-IN")}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-500">
                          {isCollapsed && groupTotals.payoutCount > 0 && (
                            <span className="font-semibold text-gray-700">{groupTotals.payoutCount}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-500">
                          {isCollapsed && groupTotals.totalPayout > 0 && (
                            <span className="font-semibold text-gray-700">{fmtINR(groupTotals.totalPayout)}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs">
                          {isCollapsed && groupTotals.payout > 0 && (
                            <span className="font-semibold text-emerald-600">{fmtINR(groupTotals.payout)}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs">
                          {isCollapsed && groupTotals.income > 0 && (
                            <span className="font-semibold text-emerald-600">{fmtINR(groupTotals.income)}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5" />
                        {showScrape && <td className="px-4 py-2.5" />}
                      </tr>
                    )}

                    {/* User rows (hidden when collapsed) */}
                    {!isCollapsed && group.rows.map((u) => (
                      <tr key={u.id} className="group hover:bg-gray-50/60 transition-colors">
                        <td style={freezeStyle(frozen, 0)} className={`px-2 sm:px-4 py-3.5 ${freezeCls(frozen, "name", "bg-white group-hover:bg-gray-50")}`}>
                          <button
                            onClick={() => setHistoryUser(u)}
                            className={`font-semibold text-gray-900 hover:text-green-600 transition-colors text-left leading-tight ${
                              frozen ? "whitespace-normal break-words" : "truncate block max-w-[9.5rem]"
                            }`}
                            title={u.name}
                          >
                            {u.name}
                          </button>
                        </td>
                        <td
                          style={freezeStyle(frozen, nameColWidth)}
                          className={`px-2 sm:px-4 py-3.5 font-mono text-xs text-gray-500 ${frozen ? "whitespace-normal break-words leading-tight" : "truncate"} ${freezeCls(frozen, "ghid", "bg-white group-hover:bg-gray-50")}`}
                        >
                          {u.gh_id}
                        </td>
                        <td className="px-4 py-3.5 text-gray-500 text-xs">{u.bank ?? <span className="text-gray-200">—</span>}</td>
                        <td className="px-4 py-3.5 text-right font-mono text-xs font-medium text-gray-700">
                          {u.inv != null ? u.inv.toLocaleString("en-IN") : <span className="text-gray-200">—</span>}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono text-xs text-gray-500">
                          {(u.all_payouts?.length ?? 0) > 0 ? u.all_payouts!.length : <span className="text-gray-200">—</span>}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono text-sm font-bold text-gray-800">
                          {userTotalPayout(u) > 0 ? fmtINR(userTotalPayout(u)) : <span className="text-gray-200 font-normal text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3.5">
                          <PayoutBadge amount={u.payout_amount} monthYear={u.month_year ?? monthYear} />
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono text-sm font-bold text-emerald-600">
                          {u.total_income ? fmtINR(parseAmount(u.total_income)) : <span className="text-gray-200 font-normal text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3.5 text-xs text-gray-400">
                          {u.payout_date ?? <span className="text-gray-200">—</span>}
                        </td>
                        {showScrape && (
                          <td className="px-4 py-3.5">
                            <ScrapeBadge user={u} runDate={runDate} onRefresh={onRefresh} />
                          </td>
                        )}
                      </tr>
                    ))}

                    {/* Group subtotal (only when expanded) */}
                    {isGrouped && !isCollapsed && (
                      <TotalRow
                        totals={groupTotals}
                        label={`Subtotal · ${group.rows.length} member${group.rows.length !== 1 ? "s" : ""}`}
                        showScrape={showScrape}
                        frozen={frozen}
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>

            <tfoot>
              <TotalRow
                totals={grandTotals}
                label={
                  search
                    ? `Total · ${visible.length} of ${users.length} user${users.length !== 1 ? "s" : ""}`
                    : `Total · ${users.length} user${users.length !== 1 ? "s" : ""}`
                }
                showScrape={showScrape}
                frozen={frozen}
                bold
              />
            </tfoot>
          </table>
        </div>
      </div>

      {historyUser && (
        <UserPayoutModal user={historyUser} onClose={() => setHistoryUser(null)} />
      )}
    </>
  );
}
