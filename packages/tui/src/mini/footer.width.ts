export function footerWidthPolicy(width: number) {
  return {
    dialog: {
      narrow: width < 80,
    },
  }
}

const USAGE_HEADROOM = 8

export function footerStatuslinePolicy(input: {
  width: number
  mainWidth: number
  commandWidth?: number
  agentWidth?: number
  contextWidths: number[]
  modelWidth?: number
  variantWidth?: number
  usageWidth?: number
  providerUsageWidths?: number[]
}) {
  let remaining = input.width - input.mainWidth - (input.commandWidth ?? 0)
  let hasSection = input.commandWidth !== undefined
  const include = (width: number | undefined, headroom = 0) => {
    if (width === undefined) return false
    const required = width + (hasSection ? 3 : 1)
    if (remaining < required + headroom) return false
    remaining -= required
    hasSection = true
    return true
  }

  const showModel = include(input.modelWidth)
  const showAgent = include(input.agentWidth)
  const hiddenContext = input.contextWidths.findIndex((width) => !include(width))
  const contextCount = hiddenContext === -1 ? input.contextWidths.length : hiddenContext
  const contextComplete = contextCount === input.contextWidths.length
  const variantWidth = input.variantWidth
  const showVariant = showModel && contextComplete && variantWidth !== undefined && remaining >= variantWidth
  if (showVariant) remaining -= variantWidth
  const showUsage =
    (showModel || input.modelWidth === undefined) &&
    (showAgent || input.agentWidth === undefined) &&
    contextComplete &&
    (showVariant || input.variantWidth === undefined) &&
    include(input.usageWidth, USAGE_HEADROOM)

  // Subscription usage is allocated last, so it is the first thing to go: the
  // context reading and the model matter every turn, a quota that resets in
  // days does not. Providers are measured one at a time, closest-to-its-limit
  // first, so a narrow row keeps only the provider worth the columns. It keeps
  // the same headroom as the context reading rather than eating it.
  const providerUsageWidths = input.providerUsageWidths ?? []
  const hiddenProviderUsage = providerUsageWidths.findIndex((width) => !include(width, USAGE_HEADROOM))
  const providerUsageCount = hiddenProviderUsage === -1 ? providerUsageWidths.length : hiddenProviderUsage

  return {
    showAgent,
    contextCount,
    showModel,
    showVariant,
    showUsage,
    providerUsageCount,
  }
}
