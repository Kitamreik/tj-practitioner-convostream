import React from "react";
import { Outlet } from "react-router-dom";
import AppSidebar from "@/components/AppSidebar";

const AppLayout: React.FC = () => (
  <div className="flex h-screen overflow-hidden bg-background">
    <AppSidebar />
    <main className="flex-1 overflow-y-auto">
      <Outlet />
    </main>
  </div>
);

export default AppLayout;
