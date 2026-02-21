import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { registerEventsCli } from "./src/events-cli.js";
import { createEventsTool } from "./src/events-tool.js";

const eventsPlugin = {
  id: "events",
  name: "Events",
  description: "Search nearby events via Ticketmaster Discovery API",

  register(api: OpenClawPluginApi) {
    api.registerTool(createEventsTool(api), { name: "events_search" });

    api.registerCli(({ program }) => registerEventsCli(api, { program }), { commands: ["events"] });
  },
};

export default eventsPlugin;
