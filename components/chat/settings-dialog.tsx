"use client"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { CustomSwitch } from "@/components/ui/custom-switch"
import { SegmentedControl } from "@/components/ui/segmented-control"
import type { Settings } from "@/lib/types"

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: Settings
  onSettingsChange: (settings: Settings) => void
}

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onSettingsChange,
}: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-full max-w-md overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="font-brand text-lg font-normal tracking-wide">
            Settings
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto px-4 py-4 custom-scrollbar">
          {/* Connection */}
          <section className="space-y-3">
            <h3 className="text-sm font-medium text-foreground">Connection</h3>
            <div className="flex items-center justify-between py-1">
              <span className="text-sm text-muted-foreground">Status</span>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-sm text-foreground">Connected</span>
              </div>
            </div>
          </section>

          <Separator className="my-4" />

          {/* Appearance */}
          <section className="space-y-3">
            <h3 className="text-sm font-medium text-foreground">Appearance</h3>
            <div className="flex items-center justify-between py-1">
              <span className="text-sm text-muted-foreground">Theme</span>
              <SegmentedControl
                value={settings.theme}
                onValueChange={(value) =>
                  onSettingsChange({ ...settings, theme: value as Settings["theme"] })
                }
                options={[
                  { value: "system", label: "System" },
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                ]}
                size="sm"
              />
            </div>
          </section>

          <Separator className="my-4" />

          {/* Chat */}
          <section className="space-y-3">
            <h3 className="text-sm font-medium text-foreground">Chat</h3>
            <div className="flex items-center justify-between py-1">
              <span className="text-sm text-muted-foreground">Display changes summary</span>
              <CustomSwitch
                checked={settings.displayChangesSummary}
                onCheckedChange={(checked) =>
                  onSettingsChange({ ...settings, displayChangesSummary: checked })
                }
                size="sm"
              />
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-sm text-muted-foreground">Display token usage</span>
              <CustomSwitch
                checked={settings.displayTokenUsage}
                onCheckedChange={(checked) =>
                  onSettingsChange({ ...settings, displayTokenUsage: checked })
                }
                size="sm"
              />
            </div>
          </section>

          <Separator className="my-4" />

          {/* About */}
          <section className="space-y-3">
            <h3 className="text-sm font-medium text-foreground">About</h3>
            <p className="text-sm text-muted-foreground">
              Assistant client (beta)
            </p>
          </section>
        </div>

      </DialogContent>
    </Dialog>
  )
}
