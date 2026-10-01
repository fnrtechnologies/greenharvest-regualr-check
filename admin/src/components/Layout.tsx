import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { logout } from "../lib/auth";

const NAV = [
  {
    to: "/", label: "Dashboard", end: true,
    icon: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  },
  {
    to: "/users", label: "Users", end: false,
    icon: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3 3-5 7-5s7 2 7 5" /></>,
  },
  {
    to: "/groups", label: "Groups", end: false,
    icon: <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />,
  },
  {
    to: "/scrape-runs", label: "Scrape Runs", end: false,
    icon: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 2" /></>,
  },
];

const COLLAPSE_KEY = "gh-admin-sidebar-collapsed";

function Icon({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`}>
      {children}
    </svg>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [navOpen,   setNavOpen]   = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }

  const sidebarW = collapsed ? "md:w-16" : "md:w-52";
  const contentML = collapsed ? "md:ml-16" : "md:ml-52";

  return (
    <div className="flex min-h-screen">
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-gray-900 flex items-center justify-between px-4 z-30 border-b border-gray-800">
        <div className="text-white font-bold text-sm tracking-tight">🌾 Green Harvest</div>
        <button
          onClick={() => setNavOpen((v) => !v)}
          aria-label="Toggle navigation"
          className="text-gray-300 hover:text-white p-2 -mr-2"
        >
          {navOpen ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M6 18L18 6" /></svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          )}
        </button>
      </div>

      {/* Overlay (mobile, when nav open) */}
      {navOpen && (
        <div
          onClick={() => setNavOpen(false)}
          className="md:hidden fixed inset-0 bg-black/40 z-20"
        />
      )}

      <aside
        className={`w-52 ${sidebarW} bg-gray-900 flex flex-col fixed top-0 left-0 h-full z-30 transform transition-all duration-200 ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0`}
      >
        <div className={`px-5 py-6 border-b border-gray-800 hidden md:flex items-center ${collapsed ? "justify-center px-0" : "justify-between"}`}>
          {collapsed ? (
            <span className="text-xl">🌾</span>
          ) : (
            <div>
              <div className="text-white font-bold text-sm tracking-tight">🌾 Green Harvest</div>
              <div className="text-gray-500 text-xs mt-0.5">Admin Portal</div>
            </div>
          )}
        </div>
        <div className="h-14 md:hidden" />

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setNavOpen(false)}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  collapsed ? "md:justify-center md:px-0" : ""
                } ${
                  isActive
                    ? "bg-green-600 text-white"
                    : "text-gray-400 hover:bg-gray-800 hover:text-white"
                }`
              }
            >
              <Icon>{item.icon}</Icon>
              <span className={collapsed ? "md:hidden" : ""}>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-gray-800 space-y-0.5">
          {/* Desktop collapse toggle */}
          <button
            onClick={toggleCollapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`hidden md:flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-800 hover:text-white transition-colors text-left ${
              collapsed ? "justify-center px-0" : ""
            }`}
          >
            <Icon className={`transition-transform ${collapsed ? "rotate-180" : ""}`}>
              <path d="M11 5l-6 7 6 7M18 5l-6 7 6 7" />
            </Icon>
            <span className={collapsed ? "md:hidden" : ""}>Collapse</span>
          </button>

          <button
            onClick={() => { logout(); navigate("/login"); }}
            title={collapsed ? "Sign out" : undefined}
            className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-800 hover:text-white transition-colors text-left ${
              collapsed ? "md:justify-center md:px-0" : ""
            }`}
          >
            <Icon><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" /></Icon>
            <span className={collapsed ? "md:hidden" : ""}>Sign out</span>
          </button>
        </div>
      </aside>

      <div className={`${contentML} flex-1 min-w-0 bg-gray-50 min-h-screen pt-14 md:pt-0 overflow-x-hidden transition-all duration-200`}>
        {children}
      </div>
    </div>
  );
}
