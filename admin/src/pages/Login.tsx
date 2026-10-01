import { useState, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { adminLogin } from "../lib/auth";

export default function Login() {
  const navigate            = useNavigate();
  const [email,   setEmail] = useState("");
  const [pass,    setPass]  = useState("");
  const [error,   setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const err = await adminLogin(email, pass);
    if (err) {
      setError(err);
      setLoading(false);
    } else {
      navigate("/");
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">🌾</div>
          <h1 className="text-white font-bold text-xl tracking-tight">Green Harvest</h1>
          <p className="text-gray-500 text-sm mt-1">Admin Portal</p>
        </div>

        {/* Card */}
        <div className="bg-gray-800 rounded-2xl border border-gray-700 p-8 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition"
                placeholder="admin@example.com"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-800 rounded-lg px-3 py-2">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-green-600 hover:bg-green-500 text-white font-semibold py-2.5 rounded-lg transition disabled:opacity-50 shadow-lg shadow-green-900/30 text-sm mt-2"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
