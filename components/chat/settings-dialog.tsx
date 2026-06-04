"use client"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { CustomSwitch } from "@/components/ui/custom-switch"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { X } from "lucide-react"
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
        <DialogHeader className="flex flex-row items-center justify-between border-b border-border px-4 py-3">
          <DialogTitle className="text-base font-semibold">Settings</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            className="h-8 w-8 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </Button>
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
              <span className="text-sm text-muted-foreground">Show tool messages</span>
              <CustomSwitch
                checked={settings.showToolMessages}
                onCheckedChange={(checked) =>
                  onSettingsChange({ ...settings, showToolMessages: checked })
                }
                size="sm"
              />
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-sm text-muted-foreground">
                Show reasoning blocks
              </span>
              <CustomSwitch
                checked={settings.showReasoningBlocks}
                onCheckedChange={(checked) =>
                  onSettingsChange({ ...settings, showReasoningBlocks: checked })
                }
                size="sm"
              />
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-sm text-muted-foreground">Thinking level</span>
              <SegmentedControl
                value={settings.thinkingLevel}
                onValueChange={(value) =>
                  onSettingsChange({
                    ...settings,
                    thinkingLevel: value as Settings["thinkingLevel"],
                  })
                }
                options={[
                  { value: "low", label: "Low" },
                  { value: "medium", label: "Medium" },
                  { value: "high", label: "High" },
                ]}
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

        <div className="flex justify-end border-t border-border px-4 py-3">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
