"use client"

import { useEffect, useMemo, useState } from "react"
import {
  ArrowLeft,
  BookOpenText,
  CheckCircle2,
  ChevronRight,
  FileJson2,
  FlaskConical,
  HelpCircle,
  Loader2,
  RotateCw,
  ServerCog,
  Settings2,
} from "lucide-react"
import {
  fetchFeatureGuide,
  fetchOpenClawConfig,
  restartOpenClaw,
  saveCrabChatState,
  saveOpenClawSessionConfig,
} from "@/lib/client-api"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { CustomCheckbox } from "@/components/ui/custom-checkbox"
import { CustomSwitch } from "@/components/ui/custom-switch"
import { SegmentedControl } from "@/components/ui/segmented-control"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type {
  CrabChatFeatures,
  OpenClawConfigView,
  OpenClawSessionConfig,
  OpenClawSessionResetConfig,
  Settings,
} from "@/lib/types"

type SettingsView = "main" | "openclaw" | "features"
type ConfigTab = "connection" | "sessions" | "agents"
type FeatureTab = "archiving"
type PendingExit = "close" | "back" | null
type ResetKey = "reset" | "direct" | "group" | "thread"

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: Settings
  onSettingsChange: (settings: Settings) => void
  features: CrabChatFeatures
  onFeaturesChange: (features: CrabChatFeatures) => void
}

interface ResetForm {
  mode: "" | "daily" | "idle"
  atHour: string
  idleMinutes: string
}

interface SessionConfigForm {
  scope: "" | NonNullable<OpenClawSessionConfig["scope"]>
  dmScope: "" | NonNullable<OpenClawSessionConfig["dmScope"]>
  reset: ResetForm
  direct: ResetForm
  group: ResetForm
  thread: ResetForm
  maintenance: {
    pruneAfter: string
    maxEntries: string
  }
}

interface FeaturesForm {
  archiving: {
    enabled: boolean
  }
}

const emptyReset: ResetForm = {
  mode: "",
  atHour: "",
  idleMinutes: "",
}

const emptyForm: SessionConfigForm = {
  scope: "",
  dmScope: "",
  reset: emptyReset,
  direct: emptyReset,
  group: emptyReset,
  thread: emptyReset,
  maintenance: {
    pruneAfter: "",
    maxEntries: "",
  },
}

const defaultFeaturesForm: FeaturesForm = {
  archiving: {
    enabled: true,
  },
}

const sessionHelp = {
  scope:
    'Sets base session grouping strategy: "per-sender" isolates by sender and "global" shares one session per channel context.',
  dmScope:
    'DM session scoping: "main" keeps continuity, while per-peer modes increase isolation for shared inboxes or multi-account deployments.',
  reset:
    "Default reset policy used when no type-specific or channel-specific override applies.",
  resetDirect:
    "Reset policy for direct chats. Supersedes the base session reset configuration for direct messages.",
  resetGroup:
    "Reset policy for group chat sessions where continuity and noise patterns differ from DMs.",
  resetThread:
    "Reset policy for thread-scoped sessions, including focused channel thread workflows.",
  resetMode:
    'Reset strategy: "daily" resets at a configured hour and "idle" resets after inactivity windows.',
  resetAtHour:
    "Local-hour boundary from 0 to 23 for daily reset mode.",
  resetIdleMinutes:
    "Inactivity window before reset for idle mode.",
  pruneAfter:
    "Removes entries older than this duration, for example 30d or 12h.",
  maxEntries:
    "Caps total session entry count retained in the store to prevent unbounded growth.",
}

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onSettingsChange,
  features,
  onFeaturesChange,
}: SettingsDialogProps) {
  const [view, setView] = useState<SettingsView>("main")
  const [tab, setTab] = useState<ConfigTab>("connection")
  const [featureTab, setFeatureTab] = useState<FeatureTab>("archiving")
  const [config, setConfig] = useState<OpenClawConfigView | null>(null)
  const [form, setForm] = useState<SessionConfigForm>(emptyForm)
  const [savedForm, setSavedForm] = useState<SessionConfigForm>(emptyForm)
  const [featureForm, setFeatureForm] = useState<FeaturesForm>(defaultFeaturesForm)
  const [savedFeatureForm, setSavedFeatureForm] = useState<FeaturesForm>(defaultFeaturesForm)
  const [featureGuide, setFeatureGuide] = useState("")
  const [loadingFeatureGuide, setLoadingFeatureGuide] = useState(false)
  const [featureError, setFeatureError] = useState<string | null>(null)
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [saving, setSaving] = useState(false)
  const [configError, setConfigError] = useState<string | null>(null)
  const [pendingExit, setPendingExit] = useState<PendingExit>(null)
  const [restartNotice, setRestartNotice] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [restartError, setRestartError] = useState<string | null>(null)

  const openClawDirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(savedForm),
    [form, savedForm]
  )
  const featuresDirty = useMemo(
    () => JSON.stringify(featureForm) !== JSON.stringify(savedFeatureForm),
    [featureForm, savedFeatureForm]
  )
  const dirty = view === "openclaw" ? openClawDirty : view === "features" ? featuresDirty : false
  const validation = useMemo(() => validateSessionForm(form), [form])
  const sessionPreview = useMemo(() => formToSessionConfig(form), [form])
  const featurePreview = useMemo(() => featureFormToConfig(featureForm), [featureForm])
  const saveDisabled =
    view === "openclaw"
      ? !dirty || validation.length > 0 || saving || loadingConfig
      : !dirty || saving

  useEffect(() => {
    if (!open) {
      setView("main")
      setTab("connection")
      setFeatureTab("archiving")
      setPendingExit(null)
    }
  }, [open])

  const loadConfig = async () => {
    setView("openclaw")
    setTab("connection")
    setLoadingConfig(true)
    setConfigError(null)
    try {
      const next = await fetchOpenClawConfig()
      const nextForm = formFromSessionConfig(next.session)
      setConfig(next)
      setForm(nextForm)
      setSavedForm(nextForm)
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : "Could not load OpenClaw config")
    } finally {
      setLoadingConfig(false)
    }
  }

  const loadFeatures = () => {
    const nextForm = featuresToForm(features)
    setFeatureForm(nextForm)
    setSavedFeatureForm(nextForm)
    setFeatureError(null)
    setFeatureTab("archiving")
    setView("features")
  }

  useEffect(() => {
    if (view !== "features") return

    let cancelled = false
    setLoadingFeatureGuide(true)
    setFeatureError(null)
    fetchFeatureGuide("session-archiving")
      .then((payload) => {
        if (!cancelled) setFeatureGuide(payload.markdown)
      })
      .catch((error) => {
        if (!cancelled) {
          setFeatureError(error instanceof Error ? error.message : "Could not load feature guide")
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingFeatureGuide(false)
      })

    return () => {
      cancelled = true
    }
  }, [view])

  const requestClose = (nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange(true)
      return
    }
    if (view !== "main" && dirty) {
      setPendingExit("close")
      return
    }
    onOpenChange(false)
  }

  const requestBack = () => {
    if (dirty) {
      setPendingExit("back")
      return
    }
    setView("main")
  }

  const discardPendingExit = () => {
    const action = pendingExit
    setPendingExit(null)
    if (view === "openclaw") setForm(savedForm)
    if (view === "features") setFeatureForm(savedFeatureForm)
    if (action === "back") setView("main")
    if (action === "close") onOpenChange(false)
  }

  const handleSave = async () => {
    if (saveDisabled) return
    if (view === "features") {
      setSaving(true)
      setFeatureError(null)
      try {
        const next = await saveCrabChatState({ features: featurePreview })
        const nextForm = featuresToForm(next.features)
        onFeaturesChange(next.features)
        setFeatureForm(nextForm)
        setSavedFeatureForm(nextForm)
      } catch (error) {
        setFeatureError(error instanceof Error ? error.message : "Could not save features")
      } finally {
        setSaving(false)
      }
      return
    }

    setSaving(true)
    setConfigError(null)
    try {
      const next = await saveOpenClawSessionConfig(sessionPreview)
      const nextForm = formFromSessionConfig(next.session)
      setConfig(next)
      setForm(nextForm)
      setSavedForm(nextForm)
      setRestartNotice(true)
      setRestartError(null)
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : "Could not save OpenClaw config")
    } finally {
      setSaving(false)
    }
  }

  const handleRestart = async () => {
    setRestarting(true)
    setRestartError(null)
    try {
      await restartOpenClaw()
      setRestartNotice(false)
    } catch (error) {
      setRestartError(error instanceof Error ? error.message : "Could not restart OpenClaw")
    } finally {
      setRestarting(false)
    }
  }

  return (
    <>
      {restartNotice && (
        <div className="fixed left-1/2 top-4 z-[70] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
            <div className="min-w-0 flex-1">
              <div>You need to restart OpenClaw to apply these changes</div>
              {restartError && (
                <div className="mt-1 truncate text-xs text-destructive" title={restartError}>
                  {restartError}
                </div>
              )}
            </div>
            <Button size="sm" onClick={handleRestart} disabled={restarting}>
              {restarting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
              Restart
            </Button>
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={requestClose}>
        <DialogContent
          showCloseButton={view === "main"}
          className={cn(
            "max-h-[90vh] w-full overflow-hidden p-0",
            view !== "main"
              ? "max-w-[calc(100vw-2rem)] sm:max-w-[64rem]"
              : "max-w-[calc(100vw-2rem)] sm:max-w-md"
          )}
        >
          <DialogHeader className="border-b border-border px-4 py-3">
            {view !== "main" ? (
              <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
                <Button variant="ghost" size="icon-sm" onClick={requestBack} title="Back">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <DialogTitle className="sr-only">
                  {view === "openclaw" ? "OpenClaw configuration" : "Features"}
                </DialogTitle>
                <div className="flex justify-center">
                  {view === "openclaw" ? (
                    <SegmentedControl
                      value={tab}
                      onValueChange={(value) => setTab(value as ConfigTab)}
                      options={[
                        { value: "connection", label: "Connection" },
                        { value: "sessions", label: "Sessions" },
                        { value: "agents", label: "Agents" },
                      ]}
                      size="sm"
                    />
                  ) : (
                    <SegmentedControl
                      value={featureTab}
                      onValueChange={(value) => setFeatureTab(value as FeatureTab)}
                      options={[{ value: "archiving", label: "Archiving" }]}
                      size="sm"
                    />
                  )}
                </div>
                <Button size="sm" onClick={handleSave} disabled={saveDisabled}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Save
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 pr-8">
                <div className="h-7 w-7" />
                <DialogTitle className="min-w-0 flex-1 truncate font-brand text-lg font-normal tracking-wide">
                  Settings
                </DialogTitle>
                <div className="h-7 w-14" />
              </div>
            )}
          </DialogHeader>

          {view === "openclaw" ? (
            <OpenClawConfigPanel
              config={config}
              form={form}
              loading={loadingConfig}
              error={configError}
              tab={tab}
              validation={validation}
              sessionPreview={sessionPreview}
              onFormChange={setForm}
            />
          ) : view === "features" ? (
            <FeaturesPanel
              form={featureForm}
              guide={featureGuide}
              loadingGuide={loadingFeatureGuide}
              error={featureError}
              preview={featurePreview}
              onFormChange={setFeatureForm}
            />
          ) : (
            <MainSettings
              settings={settings}
              onSettingsChange={onSettingsChange}
              onOpenFeatures={loadFeatures}
              onOpenOpenClaw={loadConfig}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(pendingExit)} onOpenChange={(next) => !next && setPendingExit(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your configuration changes have not been saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={discardPendingExit}>
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function MainSettings({
  settings,
  onSettingsChange,
  onOpenFeatures,
  onOpenOpenClaw,
}: {
  settings: Settings
  onSettingsChange: (settings: Settings) => void
  onOpenFeatures: () => void
  onOpenOpenClaw: () => void
}) {
  return (
    <div className="overflow-y-auto px-4 py-4 custom-scrollbar">
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

      <section className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">Chat</h3>
        <SwitchRow
          label="Display changes summary"
          checked={settings.displayChangesSummary}
          onChange={(checked) => onSettingsChange({ ...settings, displayChangesSummary: checked })}
        />
        <SwitchRow
          label="Display token usage"
          checked={settings.displayTokenUsage}
          onChange={(checked) => onSettingsChange({ ...settings, displayTokenUsage: checked })}
        />
      </section>

      <Separator className="my-4" />

      <section className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">Other</h3>
        <SettingsCard
          icon={FlaskConical}
          title="Features"
          description="Configure CrabChat features, like Diffs, Session history or Summaries"
          onClick={onOpenFeatures}
        />
        <SettingsCard
          icon={ServerCog}
          title="OpenClaw configuration"
          description="Configure and manage your OpenClaw instance"
          onClick={onOpenOpenClaw}
        />
      </section>
    </div>
  )
}

function SwitchRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <CustomSwitch checked={checked} onCheckedChange={onChange} size="sm" />
    </div>
  )
}

function SettingsCard({
  icon: Icon,
  title,
  description,
  disabled,
  onClick,
}: {
  icon: typeof Settings2
  title: string
  description: string
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-lg border border-border bg-muted/10 px-3 py-3 text-left transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-55"
    >
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground ring-1 ring-border">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
      {!disabled && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
    </button>
  )
}

function OpenClawConfigPanel({
  config,
  form,
  loading,
  error,
  tab,
  validation,
  sessionPreview,
  onFormChange,
}: {
  config: OpenClawConfigView | null
  form: SessionConfigForm
  loading: boolean
  error: string | null
  tab: ConfigTab
  validation: string[]
  sessionPreview: OpenClawSessionConfig
  onFormChange: (form: SessionConfigForm) => void
}) {
  return (
    <div className="min-h-0 overflow-hidden">
      {loading ? (
        <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading OpenClaw config
        </div>
      ) : error ? (
        <div className="p-4 text-sm text-destructive">{error}</div>
      ) : tab === "connection" ? (
        <ConnectionTab config={config} />
      ) : tab === "sessions" ? (
        <ConfigEditorShell preview={sessionPreview}>
          <SessionsTab form={form} validation={validation} onFormChange={onFormChange} />
        </ConfigEditorShell>
      ) : (
        <ConfigEditorShell preview={{}}>
          <div className="p-4 text-sm text-muted-foreground">Agent configuration will be added later.</div>
        </ConfigEditorShell>
      )}
    </div>
  )
}

function ConnectionTab({ config }: { config: OpenClawConfigView | null }) {
  return (
    <div className="flex h-[72vh] items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-3">
        <ReadOnlyField label="OpenClaw URL" value={config?.connection.url || ""} />
        <ReadOnlyField
          label="Password"
          value={config?.connection.password ? "Configured" : "Not configured"}
        />
      </div>
    </div>
  )
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Input value={value} readOnly className="h-7 bg-muted/30 text-sm" />
    </label>
  )
}

function ConfigEditorShell({
  preview,
  children,
}: {
  preview: unknown
  children: React.ReactNode
}) {
  return (
    <div className="grid h-[72vh] min-h-0 grid-cols-[minmax(0,1fr)_minmax(340px,0.9fr)]">
      <div className="min-h-0 overflow-y-auto p-4 custom-scrollbar">{children}</div>
      <div className="min-h-0 border-l border-border bg-muted/10">
        <div className="flex h-9 items-center gap-2 border-b border-border px-3 text-xs font-medium text-muted-foreground">
          <FileJson2 className="h-3.5 w-3.5" />
          JSON preview
        </div>
        <pre className="h-[calc(72vh-2.25rem)] overflow-auto p-3 text-xs leading-5 text-foreground/85 custom-scrollbar">
          {JSON.stringify(preview, null, 2)}
        </pre>
      </div>
    </div>
  )
}

function FeaturesPanel({
  form,
  guide,
  loadingGuide,
  error,
  onFormChange,
}: {
  form: FeaturesForm
  guide: string
  loadingGuide: boolean
  error: string | null
  preview: CrabChatFeatures
  onFormChange: (form: FeaturesForm) => void
}) {
  return (
    <div className="grid h-[72vh] min-h-0 grid-cols-[minmax(0,1fr)_minmax(340px,0.9fr)]">
      <div className="min-h-0 overflow-y-auto p-4 custom-scrollbar">
        <section className="space-y-4">
          <div>
            <h3 className="text-sm font-medium text-foreground">Session Archiving</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Keep local copies of sessions that disappear from OpenClaw so they remain visible as archived history.
            </p>
          </div>

          <label className="flex items-start gap-3 rounded-lg border border-border bg-muted/10 p-3">
            <CustomCheckbox
              className="mt-0.5"
              checked={form.archiving.enabled}
              onCheckedChange={(checked) =>
                onFormChange({
                  ...form,
                  archiving: {
                    ...form.archiving,
                    enabled: checked === true,
                  },
                })
              }
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">Enable archiving</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                When enabled, locally known sessions that are no longer returned by OpenClaw are moved into the archive instead of disappearing from CrabChat.
              </span>
            </span>
          </label>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </section>
      </div>

      <div className="min-h-0 border-l border-border bg-muted/10">
        <div className="flex h-9 items-center gap-2 border-b border-border px-3 text-xs font-medium text-muted-foreground">
          <BookOpenText className="h-3.5 w-3.5" />
          Feature guide
        </div>
        <div className="h-[calc(72vh-2.25rem)] overflow-auto p-4 custom-scrollbar">
          {loadingGuide ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading guide
            </div>
          ) : (
            <MarkdownGuide markdown={guide} />
          )}
        </div>
      </div>
    </div>
  )
}

function MarkdownGuide({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n")
  const blocks: React.ReactNode[] = []
  let paragraph: string[] = []
  let list: string[] = []

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push(
      <p key={`p-${blocks.length}`} className="text-sm leading-6 text-muted-foreground">
        {renderInline(paragraph.join(" "))}
      </p>
    )
    paragraph = []
  }

  const flushList = () => {
    if (list.length === 0) return
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="ml-4 list-disc space-y-1 text-sm leading-6 text-muted-foreground">
        {list.map((item) => (
          <li key={item}>{renderInline(item)}</li>
        ))}
      </ul>
    )
    list = []
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      flushParagraph()
      flushList()
      continue
    }

    if (trimmed.startsWith("# ")) {
      flushParagraph()
      flushList()
      blocks.push(
        <h1 key={`h1-${blocks.length}`} className="text-lg font-semibold text-foreground">
          {renderInline(trimmed.slice(2))}
        </h1>
      )
      continue
    }

    if (trimmed.startsWith("## ")) {
      flushParagraph()
      flushList()
      blocks.push(
        <h2 key={`h2-${blocks.length}`} className="pt-2 text-sm font-semibold text-foreground">
          {renderInline(trimmed.slice(3))}
        </h2>
      )
      continue
    }

    if (trimmed.startsWith("- ")) {
      flushParagraph()
      list.push(trimmed.slice(2))
      continue
    }

    flushList()
    paragraph.push(trimmed)
  }

  flushParagraph()
  flushList()

  return <div className="space-y-3">{blocks}</div>
}

function renderInline(text: string) {
  return text.split(/(`[^`]+`)/g).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={`${part}-${index}`} className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">
          {part.slice(1, -1)}
        </code>
      )
    }
    return <span key={`${part}-${index}`}>{part}</span>
  })
}

function SessionsTab({
  form,
  validation,
  onFormChange,
}: {
  form: SessionConfigForm
  validation: string[]
  onFormChange: (form: SessionConfigForm) => void
}) {
  const setForm = (patch: Partial<SessionConfigForm>) => onFormChange({ ...form, ...patch })
  const setReset = (key: ResetKey, patch: Partial<ResetForm>) => {
    setForm({ [key]: { ...form[key], ...patch } } as Partial<SessionConfigForm>)
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">Sessions</h3>
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label="Session scope"
            description={sessionHelp.scope}
            value={form.scope}
            options={[
              ["", "Unset"],
              ["per-sender", "per-sender"],
              ["global", "global"],
            ]}
            onChange={(scope) => setForm({ scope: scope as SessionConfigForm["scope"] })}
          />
          <SelectField
            label="DM session scope"
            description={sessionHelp.dmScope}
            value={form.dmScope}
            options={[
              ["", "Unset"],
              ["main", "main"],
              ["per-peer", "per-peer"],
              ["per-channel-peer", "per-channel-peer"],
              ["per-account-channel-peer", "per-account-channel-peer"],
            ]}
            onChange={(dmScope) => setForm({ dmScope: dmScope as SessionConfigForm["dmScope"] })}
          />
        </div>
      </section>

      <Separator />

      <section className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">Reset</h3>
        <ResetFields title="Default reset policy" description={sessionHelp.reset} value={form.reset} onChange={(patch) => setReset("reset", patch)} />
        <ResetFields title="Direct chat reset" description={sessionHelp.resetDirect} value={form.direct} onChange={(patch) => setReset("direct", patch)} />
        <ResetFields title="Group chat reset" description={sessionHelp.resetGroup} value={form.group} onChange={(patch) => setReset("group", patch)} />
        <ResetFields title="Thread reset" description={sessionHelp.resetThread} value={form.thread} onChange={(patch) => setReset("thread", patch)} />
      </section>

      <Separator />

      <section className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">Maintenance</h3>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Prune after"
            description={sessionHelp.pruneAfter}
            value={form.maintenance.pruneAfter}
            placeholder="30d"
            onChange={(pruneAfter) =>
              setForm({ maintenance: { ...form.maintenance, pruneAfter } })
            }
          />
          <TextField
            label="Maximum entries"
            description={sessionHelp.maxEntries}
            value={form.maintenance.maxEntries}
            placeholder="500"
            inputMode="numeric"
            onChange={(maxEntries) =>
              setForm({ maintenance: { ...form.maintenance, maxEntries } })
            }
          />
        </div>
      </section>

      {validation.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {validation.map((issue) => (
            <div key={issue}>{issue}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function ResetFields({
  title,
  description,
  value,
  onChange,
}: {
  title: string
  description: string
  value: ResetForm
  onChange: (patch: Partial<ResetForm>) => void
}) {
  const handleModeChange = (mode: ResetForm["mode"]) => {
    onChange({
      mode,
      ...(mode === "daily" ? { idleMinutes: "" } : {}),
      ...(mode === "idle" ? { atHour: "" } : {}),
    })
  }

  return (
    <div className="rounded-lg border border-border bg-muted/10 p-3">
      <div className="mb-3">
        <FieldLabel label={title} description={description} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <SelectField
          label="Reset mode"
          description={sessionHelp.resetMode}
          value={value.mode}
          options={[
            ["", "Unset"],
            ["daily", "daily"],
            ["idle", "idle"],
          ]}
          onChange={(mode) => handleModeChange(mode as ResetForm["mode"])}
        />
        <TextField
          label="Daily reset hour"
          description={sessionHelp.resetAtHour}
          value={value.atHour}
          inputMode="numeric"
          placeholder="0-23"
          disabled={value.mode === "idle"}
          onChange={(atHour) => onChange({ atHour })}
        />
        <TextField
          label="Idle minutes"
          description={sessionHelp.resetIdleMinutes}
          value={value.idleMinutes}
          inputMode="numeric"
          placeholder="60"
          disabled={value.mode === "daily"}
          onChange={(idleMinutes) => onChange({ idleMinutes })}
        />
      </div>
    </div>
  )
}

function SelectField({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string
  description?: string
  value: string
  options: [string, string][]
  onChange: (value: string) => void
}) {
  return (
    <label className="block space-y-1.5">
      <FieldLabel label={label} description={description} />
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  )
}

function TextField({
  label,
  description,
  value,
  placeholder,
  inputMode,
  disabled,
  onChange,
}: {
  label: string
  description?: string
  value: string
  placeholder?: string
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="block space-y-1.5">
      <FieldLabel label={label} description={description} />
      <Input
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function FieldLabel({
  label,
  description,
}: {
  label: string
  description?: string
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      {label}
      {description && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground">
                <HelpCircle className="h-3.5 w-3.5" />
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-64 text-balance leading-5" side="top">
              {description}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </span>
  )
}

function featuresToForm(features: CrabChatFeatures): FeaturesForm {
  return {
    archiving: {
      enabled: features.archiving?.enabled !== false,
    },
  }
}

function featureFormToConfig(form: FeaturesForm): CrabChatFeatures {
  return {
    archiving: {
      enabled: form.archiving.enabled,
    },
  }
}

function formFromSessionConfig(session: OpenClawSessionConfig = {}): SessionConfigForm {
  return {
    scope: session.scope || "",
    dmScope: session.dmScope || "",
    reset: resetToForm(session.reset),
    direct: resetToForm(session.resetByType?.direct),
    group: resetToForm(session.resetByType?.group),
    thread: resetToForm(session.resetByType?.thread),
    maintenance: {
      pruneAfter: valueToString(session.maintenance?.pruneAfter),
      maxEntries: valueToString(session.maintenance?.maxEntries),
    },
  }
}

function resetToForm(reset?: OpenClawSessionResetConfig): ResetForm {
  return {
    mode: reset?.mode || "",
    atHour: valueToString(reset?.atHour),
    idleMinutes: valueToString(reset?.idleMinutes),
  }
}

function valueToString(value: unknown) {
  return value === undefined || value === null ? "" : String(value)
}

function parsePositiveInteger(value: string) {
  if (!value.trim()) return undefined
  if (!/^\d+$/.test(value.trim())) return Number.NaN
  return Number(value)
}

function resetFromForm(reset: ResetForm): OpenClawSessionResetConfig | undefined {
  const next: OpenClawSessionResetConfig = {}
  if (reset.mode) next.mode = reset.mode
  const atHour = reset.mode !== "idle" ? parsePositiveInteger(reset.atHour) : undefined
  const idleMinutes = reset.mode !== "daily" ? parsePositiveInteger(reset.idleMinutes) : undefined
  if (atHour !== undefined && !Number.isNaN(atHour)) next.atHour = atHour
  if (idleMinutes !== undefined && !Number.isNaN(idleMinutes)) next.idleMinutes = idleMinutes
  return Object.keys(next).length > 0 ? next : undefined
}

function formToSessionConfig(form: SessionConfigForm): OpenClawSessionConfig {
  const reset = resetFromForm(form.reset)
  const direct = resetFromForm(form.direct)
  const group = resetFromForm(form.group)
  const thread = resetFromForm(form.thread)
  const maxEntries = parsePositiveInteger(form.maintenance.maxEntries)
  const maintenance: NonNullable<OpenClawSessionConfig["maintenance"]> = {}
  if (form.maintenance.pruneAfter.trim()) maintenance.pruneAfter = form.maintenance.pruneAfter.trim()
  if (maxEntries !== undefined && !Number.isNaN(maxEntries)) maintenance.maxEntries = maxEntries

  return {
    ...(form.scope ? { scope: form.scope } : {}),
    ...(form.dmScope ? { dmScope: form.dmScope } : {}),
    ...(reset ? { reset } : {}),
    ...(direct || group || thread
      ? {
          resetByType: {
            ...(direct ? { direct } : {}),
            ...(group ? { group } : {}),
            ...(thread ? { thread } : {}),
          },
        }
      : {}),
    ...(Object.keys(maintenance).length > 0 ? { maintenance } : {}),
  }
}

function validateSessionForm(form: SessionConfigForm) {
  const issues: string[] = []
  const validateReset = (label: string, reset: ResetForm) => {
    const atHour = reset.mode !== "idle" ? parsePositiveInteger(reset.atHour) : undefined
    const idleMinutes = reset.mode !== "daily" ? parsePositiveInteger(reset.idleMinutes) : undefined
    if (atHour !== undefined && (!Number.isInteger(atHour) || atHour < 0 || atHour > 23)) {
      issues.push(`${label}.atHour must be an integer from 0 to 23.`)
    }
    if (idleMinutes !== undefined && (!Number.isInteger(idleMinutes) || idleMinutes <= 0)) {
      issues.push(`${label}.idleMinutes must be a positive integer.`)
    }
  }

  validateReset("reset", form.reset)
  validateReset("resetByType.direct", form.direct)
  validateReset("resetByType.group", form.group)
  validateReset("resetByType.thread", form.thread)

  const pruneAfter = form.maintenance.pruneAfter.trim()
  if (pruneAfter && !/^\d+(\.\d+)?\s*(ms|s|m|h|d)?$/i.test(pruneAfter)) {
    issues.push("maintenance.pruneAfter must be a duration like 30d, 12h, or a number of days.")
  }

  const maxEntries = parsePositiveInteger(form.maintenance.maxEntries)
  if (maxEntries !== undefined && (!Number.isInteger(maxEntries) || maxEntries <= 0)) {
    issues.push("maintenance.maxEntries must be a positive integer.")
  }

  return issues
}
