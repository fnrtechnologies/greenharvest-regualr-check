import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

interface Group { id: string; name: string; }

export interface UserFormData {
  gh_id          : string;
  name           : string;
  gh_portal_name : string;
  bank           : string;
  inv            : string;
  order_no       : string;
  username       : string;
  password       : string;
  group_id       : string;
}

interface Props {
  mode     : "add" | "edit";
  initial? : Partial<UserFormData> & { id?: string };
  onClose  : () => void;
  onSaved  : () => void;
}

const EMPTY: UserFormData = {
  gh_id: "", name: "", gh_portal_name: "", bank: "",
  inv: "", order_no: "", username: "", password: "", group_id: "",
};

export default function UserModal({ mode, initial, onClose, onSaved }: Props) {
  const [form,   setForm]   = useState<UserFormData>({ ...EMPTY, ...initial });
  const [groups, setGroups] = useState<Group[]>([]);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  useEffect(() => {
    supabase.from("groups").select("id, name").order("name").then(({ data }) => {
      setGroups(data ?? []);
    });
  }, []);

  function set(field: keyof UserFormData, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);

    const payload: Record<string, unknown> = {
      gh_id          : form.gh_id.trim(),
      name           : form.name.trim(),
      gh_portal_name : form.gh_portal_name.trim() || null,
      bank           : form.bank.trim() || null,
      inv            : form.inv ? Number(form.inv) : null,
      order_no       : form.order_no ? Number(form.order_no) : null,
      username       : form.username.trim(),
      group_id       : form.group_id || null,
    };

    if (mode === "add" || form.password.trim()) {
      payload.password = form.password.trim();
    }

    let err;
    if (mode === "add") {
      ({ error: err } = await supabase.from("users").insert(payload));
    } else {
      ({ error: err } = await supabase.from("users").update(payload).eq("id", initial!.id!));
    }

    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">{mode === "add" ? "Add User" : "Edit User"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <Row label="GH ID *">
            <input required value={form.gh_id} onChange={(e) => set("gh_id", e.target.value)}
              className={input} placeholder="GH379589" />
          </Row>
          <Row label="Name *">
            <input required value={form.name} onChange={(e) => set("name", e.target.value)}
              className={input} placeholder="Full name" />
          </Row>
          <Row label="GH Portal Name">
            <input value={form.gh_portal_name} onChange={(e) => set("gh_portal_name", e.target.value)}
              className={input} placeholder="Name shown on portal" />
          </Row>
          <Row label="Bank">
            <input value={form.bank} onChange={(e) => set("bank", e.target.value)}
              className={input} placeholder="Bank name" />
          </Row>
          <Row label="Investment">
            <input type="number" value={form.inv} onChange={(e) => set("inv", e.target.value)}
              className={input} placeholder="0" min="0" />
          </Row>
          <Row label="Sort Order">
            <input type="number" value={form.order_no} onChange={(e) => set("order_no", e.target.value)}
              className={input} placeholder="e.g. 1 (lower shows first)" />
          </Row>
          <Row label="Username *">
            <input required value={form.username} onChange={(e) => set("username", e.target.value)}
              className={input} placeholder="Portal username" />
          </Row>
          <Row label={mode === "add" ? "Password *" : "Password"}>
            <input
              required={mode === "add"}
              type="text"
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              className={input}
              placeholder={mode === "edit" ? "Leave blank to keep current" : "Portal password"}
            />
          </Row>
          <Row label="Group">
            <select value={form.group_id} onChange={(e) => set("group_id", e.target.value)} className={input}>
              <option value="">— No group —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </Row>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </form>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition">
            Cancel
          </button>
          <button
            onClick={(e) => handleSubmit(e as any)}
            disabled={saving}
            className="px-5 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50 transition"
          >
            {saving ? "Saving…" : mode === "add" ? "Add User" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-3 items-center">
      <label className="text-sm text-gray-600 text-right">{label}</label>
      <div className="col-span-2">{children}</div>
    </div>
  );
}

const input = "w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400";
