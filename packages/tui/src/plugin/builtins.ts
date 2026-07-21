import HomeFooter from "../feature-plugins/home/footer"
import PromptFooter from "../feature-plugins/prompt/footer"
import SidebarContext from "../feature-plugins/sidebar/context"
import SidebarFooter from "../feature-plugins/sidebar/footer"
import SidebarMcp from "../feature-plugins/sidebar/mcp"
import DiffViewer from "../feature-plugins/system/diff-viewer"
import Notifications from "../feature-plugins/system/notifications"
import Plugins from "../feature-plugins/system/plugins"
import Storybook from "../feature-plugins/system/storybook"

// Deferred so the list does not dereference its imports while this module is
// evaluating. A built-in that mounts a PluginSlot imports the plugin context,
// which imports this module back; evaluating the array eagerly would then read
// a still-uninitialized export whenever that built-in is the entry point.
export const builtins = () => [
  HomeFooter,
  PromptFooter,
  SidebarContext,
  SidebarMcp,
  SidebarFooter,
  Notifications,
  Plugins,
  // The storybook is a development tool; keep its route and palette commands out of
  // normal launches and register it only for OPENCODE_STORY runs.
  ...(process.env.OPENCODE_STORY ? [Storybook] : []),
  DiffViewer,
]
