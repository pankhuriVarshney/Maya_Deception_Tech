import type { ReactNode } from "react"

import { AppSidebar } from "@/components/dashboard/app-sidebar"
import { Navbar } from "@/components/dashboard/navbar"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <Navbar title="MAYA | Dashboard" exportDisabled leading={<SidebarTrigger />} />
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}
