import { Link, useNavigate } from "react-router-dom";
import { logout } from "../lib/auth";

export default function Navbar() {
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-6">
        <span className="text-green-700 font-bold text-lg">Green Harvest</span>
        <Link to="/"       className="text-sm text-gray-600 hover:text-green-700 transition">Dashboard</Link>
        <Link to="/users"  className="text-sm text-gray-600 hover:text-green-700 transition">Users</Link>
        <Link to="/groups" className="text-sm text-gray-600 hover:text-green-700 transition">Groups</Link>
      </div>
      <button
        onClick={handleLogout}
        className="text-sm text-gray-500 hover:text-red-500 transition"
      >
        Sign out
      </button>
    </nav>
  );
}
