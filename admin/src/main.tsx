import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";

import Login       from "./pages/Login";
import Dashboard   from "./pages/Dashboard";
import Groups      from "./pages/Groups";
import GroupDetail from "./pages/GroupDetail";
import Users       from "./pages/Users";
import ScrapeRuns  from "./pages/ScrapeRuns";
import { supabase } from "./lib/supabase";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const [checked, setChecked] = useState(false);
  const [authed,  setAuthed]  = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthed(!!data.session);
      setChecked(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthed(!!session);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (!checked) return null;
  return authed ? <>{children}</> : <Navigate to="/login" replace />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/"          element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/users"     element={<RequireAuth><Users /></RequireAuth>} />
        <Route path="/groups"    element={<RequireAuth><Groups /></RequireAuth>} />
        <Route path="/groups/:id"    element={<RequireAuth><GroupDetail /></RequireAuth>} />
        <Route path="/scrape-runs"  element={<RequireAuth><ScrapeRuns /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
