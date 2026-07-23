import { expect, test } from "bun:test"
import { getTreeSitterClient } from "@opentui/core"
// Imported for its registration side effect, which is what this file tests.
import "../../src/mini/scrollback.surface"

// Grammars come from the opentui asset cache under ~/.local/share/opentui, and
// are fetched once on a cold cache -- so a first run needs network.
test("mini registers the grammars opentui does not bundle", async () => {
  const client = getTreeSitterClient()
  await client.initialize()

  for (const [filetype, source] of [
    ["python", "def greet(name):\n    return name\n"],
    ["bash", 'echo "hello"\n'],
  ] as const) {
    const result = await client.highlightOnce(source, filetype)
    expect(result.warning).toBeUndefined()
    expect(result.highlights?.length ?? 0).toBeGreaterThan(0)
  }

  await client.destroy()
})
