"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Activity, Gauge, Server, ShieldAlert, Shield, Swords } from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: Gauge, exact: true },
  { href: "/dashboard/attackers", label: "Attackers", icon: ShieldAlert },
  { href: "/dashboard/activity", label: "Live Activity", icon: Activity },
  { href: "/dashboard/infrastructure", label: "Infrastructure", icon: Server },
  { href: "/dashboard/simulations", label: "Simulations", icon: Swords },
] as const

export function AppSidebar() {
  const pathname = usePathname()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <Shield className="h-6 w-6 text-primary shrink-0" />
          <span className="text-lg font-bold tracking-wide text-foreground group-data-[collapsible=icon]:hidden">
            MAYA
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>SOC Dashboard</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                const isActive = item.exact
                  ? pathname === item.href
                  : pathname === item.href || pathname?.startsWith(`${item.href}/`)

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
