import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Layout from "../components/Layout";
import GroupPanel, { Group } from "../components/GroupPanel";

interface GroupWithCount extends Group {
  user_count: number;
}

export default function Groups() {
  const [groups,  setGroups]  = useState<GroupWithCount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchGroups(); }, []);

  async function fetchGroups() {
    setLoading(true);
    const { data, error } = await supabase
      .from("groups")
      .select("id, name, users(count)")
      .order("name");

    if (error) { console.error(error); setLoading(false); return; }

    setGroups(
      (data ?? []).map((g: any) => ({
        id        : g.id,
        name      : g.name,
        user_count: g.users?.[0]?.count ?? 0,
      }))
    );
    setLoading(false);
  }

  return (
    <Layout>
      <div className="px-4 sm:px-8 py-6 sm:py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Groups</h1>
          <p className="text-sm text-gray-400 mt-0.5">Organise users into groups</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-1">
            <GroupPanel groups={groups} onRefresh={fetchGroups} />
          </div>

          <div className="md:col-span-2">
            {loading ? (
              <div className="flex items-center justify-center h-40 bg-white rounded-xl border border-gray-100 shadow-sm">
                <p className="text-sm text-gray-400">Loading…</p>
              </div>
            ) : groups.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-10 text-center">
                <p className="text-gray-400 text-sm">No groups yet.</p>
                <p className="text-gray-300 text-xs mt-1">Create one on the left.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {groups.map((g) => (
                  <Link
                    key={g.id}
                    to={`/groups/${g.id}`}
                    className="block bg-white rounded-xl border border-gray-100 shadow-sm p-5 hover:border-green-200 hover:shadow-md transition-all"
                  >
                    <p className="font-semibold text-gray-900">{g.name}</p>
                    <p className="text-sm text-gray-400 mt-1">
                      {g.user_count} member{g.user_count !== 1 ? "s" : ""}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
