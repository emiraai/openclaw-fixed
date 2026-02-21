import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { fetchEvents, formatEvents } from "./ticketmaster.js";

type EventsPluginConfig = {
  apiKey?: string;
  defaultLocation?: string;
};

export function createEventsTool(api: OpenClawPluginApi) {
  return {
    name: "events_search",
    label: "Events Search",
    description:
      "Search for upcoming events near a location. Returns concerts, sports, theater, and other live events from Ticketmaster.",
    parameters: Type.Object({
      location: Type.Optional(
        Type.String({
          description: 'City to search (e.g. "Miami"). Falls back to configured default.',
        }),
      ),
      keyword: Type.Optional(
        Type.String({ description: 'Genre or artist filter (e.g. "electronic", "Taylor Swift").' }),
      ),
      days: Type.Optional(
        Type.Number({ description: "Number of days to look ahead (default: 7)." }),
      ),
    }),

    async execute(_id: string, params: Record<string, unknown>) {
      const cfg = (api.pluginConfig ?? {}) as EventsPluginConfig;
      const apiKey = cfg.apiKey;
      if (!apiKey) {
        throw new Error(
          "events plugin: apiKey not configured. Set it in plugins.entries.events.config.apiKey",
        );
      }

      const location =
        (typeof params.location === "string" && params.location.trim()) ||
        cfg.defaultLocation ||
        undefined;

      const keyword = (typeof params.keyword === "string" && params.keyword.trim()) || undefined;

      const days = typeof params.days === "number" && params.days > 0 ? params.days : 7;

      const events = await fetchEvents({ apiKey, location, keyword, days });
      const text = formatEvents(events);

      return {
        content: [{ type: "text" as const, text }],
        details: { count: events.length, events },
      };
    },
  };
}
