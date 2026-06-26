import { describe, expect, it, vi } from "vitest"
import {
  buildModelOptionFromRef,
  dedupeModelsById,
  getDefaultsModelId,
  getModelContextCapacity,
  getPreferredThinkingLevel,
  getSessionModelId,
  getThinkingLevels,
  getTransientAgentActivity,
  hasEquivalentVisibleModel,
  mergeSessionUpdate,
  resolveConfiguredAgentModels,
} from "@/components/chat/workspace-helpers"
import type { Agent, ModelOption, Session, SessionDefaults } from "@/lib/types"

describe("workspace helpers", () => {
  it("builds stable model ids from sessions and defaults", () => {
    expect(getSessionModelId({ id: "s", title: "S", pinned: false, model: "gpt-5", modelProvider: "openai" })).toBe("openai/gpt-5")
    expect(getSessionModelId({ id: "s", title: "S", pinned: false, model: "openai/gpt-5" })).toBe("openai/gpt-5")
    expect(getDefaultsModelId({ model: "claude", modelProvider: "anthropic" })).toBe("anthropic/claude")
  })

  it("dedupes models and recognizes equivalent visible models", () => {
    const models: ModelOption[] = [
      { id: "openai/gpt-5", name: "GPT-5" },
      { id: " OpenAI/GPT-5 ", name: "Duplicate" },
      { id: "anthropic/claude", name: "Claude" },
    ]

    expect(dedupeModelsById(models)).toEqual([models[0], models[2]])
    expect(hasEquivalentVisibleModel({ id: "gpt-5", name: "Other name" }, [models[0]])).toBe(true)
    expect(hasEquivalentVisibleModel({ id: "missing", name: "Claude" }, [models[2]])).toBe(true)
  })

  it("filters models by configured agent refs and falls back to refs when absent", () => {
    const models: ModelOption[] = [
      { id: "openai/gpt-5", name: "GPT-5" },
      { id: "anthropic/claude", name: "Claude" },
    ]
    const agent: Agent = {
      id: "agent",
      name: "Agent",
      model: { primary: "gpt-5", fallbacks: ["missing/provider-model"] },
    }

    expect(resolveConfiguredAgentModels(agent, models)).toEqual([models[0]])
    expect(resolveConfiguredAgentModels({ ...agent, model: { primary: "other/model" } }, models)).toEqual([
      { id: "other/model", name: "model", provider: "other" },
    ])
  })

  it("resolves thinking levels and preferred thinking level", () => {
    const defaults: SessionDefaults = {
      model: "openai/gpt-5",
      thinkingLevels: [{ id: "medium", label: "Medium" }],
      thinkingOptions: ["low", "high"],
    }

    expect(getThinkingLevels({ model: "openai/gpt-5" }, defaults)).toEqual([
      { id: "medium", label: "Medium" },
    ])
    expect(getThinkingLevels({ model: "other", thinkingOptions: ["fast"] }, defaults)).toEqual([
      { id: "fast", label: "fast" },
    ])
    expect(getPreferredThinkingLevel([{ id: "low", label: "Low" }], { thinkingDefault: "low" })).toBe("low")
    expect(getPreferredThinkingLevel([], {})).toBe("medium")
  })

  it("merges session updates without erasing agent identity", () => {
    const current: Session = {
      id: "s",
      title: "Before",
      pinned: false,
      agentId: "agent",
      agentName: "Agent",
    }
    const updated: Session = { id: "s", title: "After", pinned: false }

    expect(mergeSessionUpdate(current, updated)).toMatchObject({
      title: "After",
      agentId: "agent",
      agentName: "Agent",
    })
  })

  it("derives transient activity only while responding", () => {
    vi.spyOn(Date, "now").mockReturnValue(123)

    expect(getTransientAgentActivity(null, false)).toBeNull()
    expect(getTransientAgentActivity(null, true)).toEqual({
      kind: "thinking",
      label: "Thinking",
      active: true,
      updatedAt: 123,
    })
    expect(getModelContextCapacity({ id: "m", name: "M", contextWindow: 100 })).toBe(100)
    expect(buildModelOptionFromRef("single")).toEqual({ id: "single", name: "single" })
  })
})
