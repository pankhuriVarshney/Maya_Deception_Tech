"use client"

import * as React from "react"
import { Bell, Settings, Shield, MoreVertical, Moon, Sun, Monitor } from "lucide-react"
import { useTheme } from "next-themes"

import { toast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type NavbarProps = {
  title?: string
  onExport?: () => void
  onRefresh?: () => void
  exportDisabled?: boolean
}

export function Navbar({ title = "MAYA", onExport, onRefresh, exportDisabled }: NavbarProps) {
  const { theme, setTheme } = useTheme()

  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-border bg-card">
      <div className="flex items-center gap-2">
        <Shield className="h-7 w-7 text-primary" />
        <span className="text-xl font-bold tracking-wide text-foreground">{title}</span>
      </div>
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Notifications"
          onClick={() => toast({ title: "Notifications", description: "No new alerts." })}
        >
          <Bell className="h-5 w-5" />
        </Button>

        <Dialog>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Settings">
              <Settings className="h-5 w-5" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Settings</DialogTitle>
              <DialogDescription>
                Basic UI preferences for this dashboard.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3">
              <div className="text-sm font-medium">Theme</div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={theme === "light" ? "secondary" : "outline"}
                  onClick={() => setTheme("light")}
                >
                  <Sun className="h-4 w-4" />
                  Light
                </Button>
                <Button
                  type="button"
                  variant={theme === "dark" ? "secondary" : "outline"}
                  onClick={() => setTheme("dark")}
                >
                  <Moon className="h-4 w-4" />
                  Dark
                </Button>
                <Button
                  type="button"
                  variant={theme === "system" ? "secondary" : "outline"}
                  onClick={() => setTheme("system")}
                >
                  <Monitor className="h-4 w-4" />
                  System
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Menu">
              <MoreVertical className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() =>
                onRefresh
                  ? onRefresh()
                  : toast({ title: "Refresh", description: "Reloading dashboard…" })
              }
            >
              Refresh
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={exportDisabled}
              onClick={() => {
                if (exportDisabled) return
                if (!onExport) {
                  toast({ title: "Export", description: "Export not wired up." })
                  return
                }
                onExport()
              }}
            >
              Export
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() =>
                toast({ title: "About", description: "MAYA SOC Dashboard" })
              }
            >
              About
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
