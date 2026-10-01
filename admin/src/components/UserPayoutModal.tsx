import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { UserRow } from "./UserTable";

interface PayoutEntry {
  month_year  : string;
  payout_date : string | null;
  amount      : string | null;
  total_income: string | null;
}

function parseAmount(val: string | null | undefined): number {
  if (!val) return 0;
  const n = parseFloat(
    val.replace(/[^\d.,]/g, "").replace(/^\./, "").replace(/,/g, "")
  );
  return isNaN(n) ? 0 : n;
}

function fmtINR(val: number): string {
  return "₹" + val.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function monthLabel(my: string) {
  const [y, m] = my.split("-");
  return new Date(Number(y), Number(m) - 1).toLocaleString("en-IN", { month: "short", year: "numeric" });
}

interface Props {
  user   : UserRow;
  onClose: () => void;
}

export default function UserPayoutModal({ user, onClose }: Props) {
  const [entries, setEntries] = useState<PayoutEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchHistory(); }, [user.id]);

  async function fetchHistory() {
    setLoading(true);
    const [payoutsRes, earningsRes] = await Promise.all([
      supabase.from("payouts")
        .select("month_year, payout_date, amount")
        .eq("user_id", user.id)
        .order("month_year", { ascending: false }),
      supabase.from("earnings")
        .select("month_year, total_income")
        .eq("user_id", user.id),
    ]);

    const earningsMap = new Map(
      (earningsRes.data ?? []).map((e: any) => [e.month_year as string, e.total_income as string | null])
    );

    setEntries(
      (payoutsRes.data ?? []).map((p: any) => ({
        month_year  : p.month_year,
        payout_date : p.payout_date,
        amount      : p.amount,
        total_income: earningsMap.get(p.month_year) ?? null,
      }))
    );
    setLoading(false);
  }

  const totalEarned  = entries.reduce((s, e) => s + parseAmount(e.amount), 0);
  const totalIncome  = entries.reduce((s, e) => s + parseAmount(e.total_income), 0);
  const latestDate   = entries[0]?.payout_date ?? null;
  const latestMonth  = entries[0] ? monthLabel(entries[0].month_year) : "no data";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-3 sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-gray-100 flex items-start justify-between gap-3 flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900 truncate">{user.name}</h2>
            <p className="text-xs text-gray-400 font-mono mt-0.5">{user.gh_id}</p>
            {user.group_name && (
              <span className="mt-1.5 inline-flex px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-600 font-medium border border-blue-100">
                {user.group_name}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none transition-colors shrink-0"
          >
            ×
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-12">
            <p className="text-sm text-gray-400">Loading history…</p>
          </div>
        ) : (
          <>
            {/* Stat cards */}
            <div className="px-4 sm:px-6 py-3 sm:py-4 grid grid-cols-3 gap-2 sm:gap-3 flex-shrink-0 border-b border-gray-50">
              <div className="bg-gray-50 rounded-xl px-2.5 sm:px-4 py-2.5 sm:py-3 min-w-0">
                <p className="text-[10px] sm:text-xs font-semibold text-gray-400 uppercase tracking-wider truncate">Total Payout</p>
                <p className="text-sm sm:text-xl font-bold text-emerald-600 mt-1 truncate">{totalEarned > 0 ? fmtINR(totalEarned) : "—"}</p>
                <p className="text-[10px] sm:text-xs text-gray-400 mt-0.5 truncate">all time payouts</p>
              </div>
              <div className="bg-gray-50 rounded-xl px-2.5 sm:px-4 py-2.5 sm:py-3 min-w-0">
                <p className="text-[10px] sm:text-xs font-semibold text-gray-400 uppercase tracking-wider truncate">Months Scraped</p>
                <p className="text-sm sm:text-xl font-bold text-gray-900 mt-1 truncate">{entries.length}</p>
                <p className="text-[10px] sm:text-xs text-gray-400 mt-0.5 truncate">payout records</p>
              </div>
              <div className="bg-gray-50 rounded-xl px-2.5 sm:px-4 py-2.5 sm:py-3 min-w-0">
                <p className="text-[10px] sm:text-xs font-semibold text-gray-400 uppercase tracking-wider truncate">Latest Payout</p>
                <p className="text-sm sm:text-xl font-bold text-gray-900 mt-1 truncate">{latestDate ?? "—"}</p>
                <p className="text-[10px] sm:text-xs text-gray-400 mt-0.5 truncate">{latestMonth}</p>
              </div>
            </div>

            {/* History table */}
            <div className="overflow-auto flex-1">
              {entries.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <p className="text-sm text-gray-400">No payout history found.</p>
                </div>
              ) : (
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50 sticky top-0">
                      <th className="px-3 sm:px-5 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">Month</th>
                      <th className="px-3 sm:px-5 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">Payout</th>
                      <th className="px-3 sm:px-5 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">Est. Next</th>
                      <th className="px-3 sm:px-5 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {entries.map((e) => (
                      <tr key={e.month_year} className="hover:bg-gray-50/60">
                        <td className="px-3 sm:px-5 py-3 font-medium text-gray-800 whitespace-nowrap">{monthLabel(e.month_year)}</td>
                        <td className="px-3 sm:px-5 py-3 text-right font-mono font-bold text-emerald-600 whitespace-nowrap">
                          {e.amount ? fmtINR(parseAmount(e.amount)) : <span className="text-gray-300 font-normal text-xs">—</span>}
                        </td>
                        <td className="px-3 sm:px-5 py-3 text-right font-mono font-bold text-gray-700 whitespace-nowrap">
                          {e.total_income ? fmtINR(parseAmount(e.total_income)) : <span className="text-gray-300 font-normal text-xs">—</span>}
                        </td>
                        <td className="px-3 sm:px-5 py-3 text-xs text-gray-400 whitespace-nowrap">{e.payout_date ?? <span className="text-gray-200">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 bg-gray-50">
                      <td className="px-3 sm:px-5 py-3 text-xs font-bold text-gray-600 uppercase tracking-wider whitespace-nowrap">
                        Total Payout ({entries.length} months)
                      </td>
                      <td className="px-3 sm:px-5 py-3 text-right font-mono text-sm font-bold text-emerald-700 whitespace-nowrap">
                        {fmtINR(totalEarned)}
                      </td>
                      <td className="px-3 sm:px-5 py-3 text-right font-mono text-sm font-bold text-gray-700 whitespace-nowrap">
                        {totalIncome > 0 ? fmtINR(totalIncome) : "—"}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
