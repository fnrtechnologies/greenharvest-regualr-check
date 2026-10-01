import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Layout from "../components/Layout";
import UserTable, { UserRow } from "../components/UserTable";

function getMonthYear() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

interface UnassignedUser { id: string; name: string; gh_id: string; }

export default function GroupDetail() {
  const { id }                       = useParams<{ id: string }>();
  const [groupName,  setGroupName]   = useState("");
  const [users,      setUsers]       = useState<UserRow[]>([]);
  const [unassigned, setUnassigned]  = useState<UnassignedUser[]>([]);
  const [selected,   setSelected]    = useState<string[]>([]);
  const [monthYear,  setMonthYear]   = useState(getMonthYear());
  const [loading,    setLoading]     = useState(true);
  const [saving,     setSaving]      = useState(false);

  useEffect(() => { fetchData(); }, [id, monthYear]);

  async function fetchData() {
    setLoading(true);
    const [groupRes, usersRes, unassignedRes] = await Promise.all([
      supabase.from("groups").select("name").eq("id", id!).single(),
      supabase
        .from("users")
        .select("id, gh_id, name, username, bank, gh_portal_name, inv, order_no, groups(name), payouts(amount, payout_date, month_year), earnings(total_income, month_year)")
        .eq("group_id", id!)
        .order("order_no", { ascending: true, nullsFirst: false })
        .order("name"),
      supabase.from("users").select("id, name, gh_id").is("group_id", null).order("name"),
    ]);

    setGroupName(groupRes.data?.name ?? "");

    const rows: UserRow[] = (usersRes.data ?? []).map((u: any) => {
      const payout  = (u.payouts  as any[]).find((p) => p.month_year === monthYear);
      const earning = (u.earnings as any[]).find((e) => e.month_year === monthYear);
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
        all_payouts   : (u.payouts as any[]).map((p) => ({
          amount     : p.amount ?? null,
          month_year : p.month_year,
          payout_date: p.payout_date ?? null,
        })),
      };
    });

    setUsers(rows);
    setUnassigned(unassignedRes.data ?? []);
    setLoading(false);
  }

  async function assignUsers() {
    if (!selected.length) return;
    setSaving(true);
    await supabase.from("users").update({ group_id: id }).in("id", selected);
    setSelected([]);
    await fetchData();
    setSaving(false);
  }

  async function removeUser(userId: string) {
    await supabase.from("users").update({ group_id: null }).eq("id", userId);
    await fetchData();
  }

  function toggleSelect(userId: string) {
    setSelected((prev) =>
      prev.includes(userId) ? prev.filter((x) => x !== userId) : [...prev, userId]
    );
  }

  return (
    <Layout>
      <div className="px-4 sm:px-8 py-6 sm:py-8">
        <div className="flex items-center gap-3 mb-8">
          <Link to="/groups" className="text-sm text-gray-400 hover:text-green-600 transition font-medium">
            ← Groups
          </Link>
          <span className="text-gray-200">/</span>
          <h1 className="text-2xl font-bold text-gray-900">{groupName}</h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Add users panel */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 md:col-span-1 self-start">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Add members</h2>
            {unassigned.length === 0 ? (
              <p className="text-xs text-gray-400">All users are already in a group.</p>
            ) : (
              <>
                <ul className="space-y-0.5 max-h-64 overflow-y-auto mb-4">
                  {unassigned.map((u) => (
                    <li key={u.id}>
                      <label className="flex items-center gap-2.5 text-sm cursor-pointer hover:bg-gray-50 px-2 py-1.5 rounded-lg">
                        <input
                          type="checkbox"
                          checked={selected.includes(u.id)}
                          onChange={() => toggleSelect(u.id)}
                          className="accent-green-600"
                        />
                        <span className="text-gray-800 font-medium">{u.name}</span>
                        <span className="text-gray-400 text-xs font-mono">{u.gh_id}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={assignUsers}
                  disabled={saving || !selected.length}
                  className="w-full bg-green-600 hover:bg-green-700 text-white text-sm py-2 rounded-lg disabled:opacity-40 font-medium transition"
                >
                  {saving ? "Assigning…" : `Assign ${selected.length || ""} user${selected.length !== 1 ? "s" : ""}`}
                </button>
              </>
            )}
          </div>

          {/* Members */}
          <div className="md:col-span-2">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
              <p className="text-sm text-gray-500 font-medium">{users.length} member{users.length !== 1 ? "s" : ""}</p>
              <input
                type="month"
                value={monthYear}
                onChange={(e) => setMonthYear(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-40 bg-white rounded-xl border border-gray-100 shadow-sm">
                <p className="text-sm text-gray-400">Loading…</p>
              </div>
            ) : (
              <>
                <UserTable users={users} monthYear={monthYear} />
                {users.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs text-gray-400 mb-2">Remove from group:</p>
                    <div className="flex flex-wrap gap-2">
                      {users.map((u) => (
                        <button
                          key={u.id}
                          onClick={() => removeUser(u.id)}
                          className="text-xs border border-gray-200 px-2.5 py-1 rounded-full hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition text-gray-500"
                        >
                          {u.name} ×
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
