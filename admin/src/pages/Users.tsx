import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import Layout from "../components/Layout";
import UserModal, { UserFormData } from "../components/UserModal";

interface UserRecord {
  id            : string;
  gh_id         : string;
  name          : string;
  username      : string;
  bank          : string | null;
  gh_portal_name: string | null;
  inv           : number | null;
  order_no      : number | null;
  enabled       : boolean;
  group_id      : string | null;
  groups        : { name: string } | null;
}

type ModalState =
  | { open: false }
  | { open: true; mode: "add" }
  | { open: true; mode: "edit"; user: UserRecord };

type SortKey = "order_no" | "name" | "gh_id" | "gh_portal_name" | "bank" | "inv" | "username" | "group" | "status";
type SortDir = "asc" | "desc";

function compareUsers(a: UserRecord, b: UserRecord, key: SortKey): number {
  switch (key) {
    case "order_no":       return (a.order_no ?? Infinity) - (b.order_no ?? Infinity);
    case "name":           return a.name.localeCompare(b.name);
    case "gh_id":          return a.gh_id.localeCompare(b.gh_id);
    case "gh_portal_name": return (a.gh_portal_name ?? "").localeCompare(b.gh_portal_name ?? "");
    case "bank":           return (a.bank ?? "").localeCompare(b.bank ?? "");
    case "inv":            return (a.inv ?? 0) - (b.inv ?? 0);
    case "username":       return a.username.localeCompare(b.username);
    case "group":          return (a.groups?.name ?? "").localeCompare(b.groups?.name ?? "");
    case "status":         return Number(a.enabled) - Number(b.enabled);
  }
}

function SortArrow({ dir }: { dir: SortDir }) {
  return <span className="text-[9px] ml-1">{dir === "asc" ? "▲" : "▼"}</span>;
}

export default function Users() {
  const [users,   setUsers]   = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState<ModalState>({ open: false });
  const [filter,  setFilter]  = useState<"all" | "enabled" | "disabled">("all");
  const [search,  setSearch]  = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("order_no");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function sortTh(key: SortKey, label: string, align: "left" | "right" = "left") {
    const active = sortKey === key;
    return (
      <th
        onClick={() => toggleSort(key)}
        className={`px-4 py-3 text-${align} text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors ${
          active ? "text-gray-700" : "text-gray-400 hover:text-gray-600"
        }`}
      >
        {label}{active && <SortArrow dir={sortDir} />}
      </th>
    );
  }

  useEffect(() => { fetchUsers(); }, []);

  async function fetchUsers() {
    setLoading(true);
    const { data } = await supabase
      .from("users")
      .select("id, gh_id, name, username, bank, gh_portal_name, inv, order_no, enabled, group_id, groups(name)")
      .order("order_no", { ascending: true, nullsFirst: false })
      .order("name");
    setUsers((data as any[]) ?? []);
    setLoading(false);
  }

  async function toggleEnabled(user: UserRecord) {
    await supabase.from("users").update({ enabled: !user.enabled }).eq("id", user.id);
    setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, enabled: !u.enabled } : u));
  }

  async function deleteUser(user: UserRecord) {
    if (!confirm(`Delete ${user.name} (${user.gh_id})? This removes all their payout history.`)) return;
    await supabase.from("users").delete().eq("id", user.id);
    setUsers((prev) => prev.filter((u) => u.id !== user.id));
  }

  const needle = search.trim().toLowerCase();

  const displayed = users
    .filter((u) => (filter === "all" ? true : filter === "enabled" ? u.enabled : !u.enabled))
    .filter((u) =>
      !needle ||
      [u.name, u.gh_id, u.gh_portal_name, u.bank, u.username, u.groups?.name]
        .some((v) => v?.toLowerCase().includes(needle))
    )
    .sort((a, b) => {
      const sign = sortDir === "asc" ? 1 : -1;
      const primary = compareUsers(a, b, sortKey);
      return primary !== 0 ? sign * primary : a.name.localeCompare(b.name);
    });

  const active   = users.filter((u) => u.enabled).length;
  const disabled = users.filter((u) => !u.enabled).length;

  return (
    <Layout>
      <div className="px-4 sm:px-8 py-6 sm:py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 sm:mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Users</h1>
            <p className="text-sm text-gray-400 mt-0.5">{active} active · {disabled} disabled</p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search users…"
              className="flex-1 sm:flex-none sm:w-48 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as any)}
              className="flex-1 sm:flex-none border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="all">All users</option>
              <option value="enabled">Active only</option>
              <option value="disabled">Disabled only</option>
            </select>
            <button
              onClick={() => setModal({ open: true, mode: "add" })}
              className="shrink-0 bg-green-600 hover:bg-green-700 text-white text-sm px-4 py-2 rounded-lg font-medium shadow-sm transition"
            >
              + Add User
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48 bg-white rounded-xl border border-gray-100 shadow-sm">
            <p className="text-sm text-gray-400">Loading…</p>
          </div>
        ) : displayed.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
            <p className="text-gray-400 text-sm">
              {needle ? `No users match “${search}”.` : "No users found."}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    {sortTh("order_no", "Order", "right")}
                    {sortTh("name", "Name")}
                    {sortTh("gh_id", "GH ID")}
                    {sortTh("gh_portal_name", "GH Portal Name")}
                    {sortTh("bank", "Bank")}
                    {sortTh("inv", "Investment", "right")}
                    {sortTh("username", "Username")}
                    {sortTh("group", "Group")}
                    {sortTh("status", "Status")}
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {displayed.map((u) => (
                    <tr key={u.id} className={`hover:bg-gray-50/60 transition-colors ${!u.enabled ? "opacity-50" : ""}`}>
                      <td className="px-4 py-3.5 text-right font-mono text-xs text-gray-400">
                        {u.order_no ?? <span className="text-gray-200">—</span>}
                      </td>
                      <td className="px-4 py-3.5 font-semibold text-gray-900">{u.name}</td>
                      <td className="px-4 py-3.5 font-mono text-xs text-gray-500">{u.gh_id}</td>
                      <td className="px-4 py-3.5 text-gray-600 text-xs">{u.gh_portal_name ?? <span className="text-gray-200">—</span>}</td>
                      <td className="px-4 py-3.5 text-gray-600 text-xs">{u.bank ?? <span className="text-gray-200">—</span>}</td>
                      <td className="px-4 py-3.5 text-right font-mono text-gray-700 text-xs font-medium">
                        {u.inv != null ? u.inv.toLocaleString("en-IN") : <span className="text-gray-200">—</span>}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-gray-400 text-xs">{u.username}</td>
                      <td className="px-4 py-3.5">
                        {u.groups?.name ? (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-600 font-medium border border-blue-100">
                            {u.groups.name}
                          </span>
                        ) : (
                          <span className="text-gray-200 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                          u.enabled
                            ? "bg-green-50 text-green-700 border-green-100"
                            : "bg-gray-50 text-gray-400 border-gray-100"
                        }`}>
                          {u.enabled ? "Active" : "Disabled"}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => setModal({ open: true, mode: "edit", user: u })}
                            className="text-xs text-blue-500 hover:text-blue-700 font-medium transition"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => toggleEnabled(u)}
                            className={`text-xs font-medium transition ${
                              u.enabled
                                ? "text-amber-500 hover:text-amber-700"
                                : "text-green-600 hover:text-green-800"
                            }`}
                          >
                            {u.enabled ? "Disable" : "Enable"}
                          </button>
                          <button
                            onClick={() => deleteUser(u)}
                            className="text-xs text-red-400 hover:text-red-600 font-medium transition"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {modal.open && modal.mode === "add" && (
        <UserModal mode="add" onClose={() => setModal({ open: false })} onSaved={fetchUsers} />
      )}
      {modal.open && modal.mode === "edit" && (
        <UserModal
          mode="edit"
          initial={{
            id            : modal.user.id,
            gh_id         : modal.user.gh_id,
            name          : modal.user.name,
            gh_portal_name: modal.user.gh_portal_name ?? "",
            bank          : modal.user.bank ?? "",
            inv           : modal.user.inv?.toString() ?? "",
            order_no      : modal.user.order_no?.toString() ?? "",
            username      : modal.user.username,
            password      : "",
            group_id      : modal.user.group_id ?? "",
          }}
          onClose={() => setModal({ open: false })}
          onSaved={fetchUsers}
        />
      )}
    </Layout>
  );
}
