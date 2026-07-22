import { expect, test } from "bun:test"
import path from "node:path"
import { createModelPreferenceRepository, decodeModelPreference } from "../src/model-preference"
import { tmpdir } from "./fixture/fixture"

test("repairs known model preferences and preserves unrelated fields", () => {
  expect(
    decodeModelPreference({
      unrelated: { keep: true },
      recent: [{ providerID: "openai", modelID: "gpt-5", ignored: true }, null],
      favorite: "malformed",
      variant: { "openai/gpt-5": "high", default: "default", invalid: 42 },
    }),
  ).toEqual({
    unrelated: { keep: true },
    recent: [{ providerID: "openai", modelID: "gpt-5" }],
    favorite: [],
    variant: { "openai/gpt-5": "high" },
  })
})

test("atomically serializes patches and variant updates", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "model.json")
  await Bun.write(file, JSON.stringify({ unrelated: "keep", favorite: [], variant: {} }))
  const repository = createModelPreferenceRepository(file)
  const openai = { providerID: "openai", modelID: "org/gpt-5" }
  const anthropic = { providerID: "anthropic", modelID: "claude/sonnet" }

  await Promise.all([
    repository.patch({ recent: [openai] }),
    repository.saveVariant(openai, "high"),
    repository.saveVariant(anthropic, "low"),
  ])
  expect(await Bun.file(file).json()).toEqual({
    unrelated: "keep",
    recent: [openai],
    favorite: [],
    variant: { "openai/org/gpt-5": "high", "anthropic/claude/sonnet": "low" },
  })

  await repository.saveVariant(openai, "default")
  expect(await repository.resolveVariant(openai)).toBeUndefined()
  expect((await Bun.file(file).json()).variant).toEqual({ "anthropic/claude/sonnet": "low" })
})

test("saveModel promotes to the front of recent without duplicating", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "model.json")
  const openai = { providerID: "openai", modelID: "gpt-5" }
  const anthropic = { providerID: "anthropic", modelID: "claude" }
  const repository = createModelPreferenceRepository(file)

  await repository.saveModel(openai)
  await repository.saveModel(anthropic)
  expect(await repository.resolveModels()).toEqual([anthropic, openai])

  await repository.saveModel(openai)
  expect(await repository.resolveModels()).toEqual([openai, anthropic])
})
