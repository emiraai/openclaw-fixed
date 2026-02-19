/**
 * Tesla extension entry point.
 *
 * Registers the `tesla` tool (opt-in) so the AI agent can control
 * a Tesla vehicle via the Fleet API.
 */

import type {
  AnyAgentTool,
  OpenClawPluginApi,
  OpenClawPluginToolFactory,
} from "../../src/plugins/types.js";
import { createTeslaTool } from "./src/tesla-tool.js";

export default function register(api: OpenClawPluginApi) {
  // Register as optional + factory so the tool is only created when explicitly
  // enabled and skipped in sandboxed contexts (vehicle commands are side-effectful).
  api.registerTool(
    ((ctx) => {
      if (ctx.sandboxed) {
        return null;
      }
      return createTeslaTool(api) as AnyAgentTool;
    }) as OpenClawPluginToolFactory,
    { optional: true },
  );
}
