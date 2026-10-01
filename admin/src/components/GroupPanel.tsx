import { useState } from "react";
import { supabase } from "../lib/supabase";

export interface Group {
  id  : string;
  name: string;
}

interface Props {
  groups  : Group[];
  onRefresh: () => void;
}

export default function GroupPanel({ groups, onRefresh }: Props) {
  const [newName, setNewName] = useState("");
  const [saving, setSaving]   = useState(false);
  const [error,  setError]    = useState<string | null>(null);

  async function createGroup() {
    if (!newName.trim()) return;
    setSaving(true);
    setError(null);
    const { error: e } = await supabase.from("groups").insert({ name: newName.trim() });
    if (e) setError(e.message);
    else { setNewName(""); onRefresh(); }
    setSaving(false);
  }

  async function deleteGroup(id: string) {
    if (!confirm("Delete this group? Users in it will become ungrouped.")) return;
    await supabase.from("groups").delete().eq("id", id);
    onRefresh();
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">Groups</h2>

      <div className="flex gap-2 mb-4">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createGroup()}
          placeholder="New group name"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
        />
        <button
          onClick={createGroup}
          disabled={saving || !newName.trim()}
          className="bg-green-600 hover:bg-green-700 text-white text-sm px-4 py-1.5 rounded-lg disabled:opacity-50 transition"
        >
          Add
        </button>
      </div>

      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

      <ul className="space-y-1">
        {groups.map((g) => (
          <li key={g.id} className="flex items-center justify-between text-sm py-1 px-2 rounded-lg hover:bg-gray-50">
            <span className="text-gray-800">{g.name}</span>
            <button
              onClick={() => deleteGroup(g.id)}
              className="text-xs text-red-400 hover:text-red-600 transition"
            >
              Delete
            </button>
          </li>
        ))}
        {!groups.length && <li className="text-xs text-gray-400">No groups yet.</li>}
      </ul>
    </div>
  );
}
