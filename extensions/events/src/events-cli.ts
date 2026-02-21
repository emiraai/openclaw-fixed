import type { Command } from "commander";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { fetchEvents, formatEvents } from "./ticketmaster.js";

type EventsPluginConfig = {
  apiKey?: string;
  defaultLocation?: string;
};

export function registerEventsCli(api: OpenClawPluginApi, { program }: { program: Command }) {
  program
    .command("events [location]")
    .description("Search for upcoming events near a location")
    .option("-k, --keyword <keyword>", "Genre or artist filter")
    .option("-d, --days <days>", "Number of days to look ahead", "7")
    .action(async (location?: string, opts?: { keyword?: string; days?: string }) => {
      const cfg = (api.pluginConfig ?? {}) as EventsPluginConfig;
      const apiKey = cfg.apiKey;
      if (!apiKey) {
        console.error(
          "Error: events plugin apiKey not configured.\n" +
            "Set it via: openclaw config set plugins.entries.events.config.apiKey YOUR_KEY",
        );
        process.exitCode = 1;
        return;
      }

      const resolvedLocation = location?.trim() || cfg.defaultLocation || undefined;
      const keyword = opts?.keyword?.trim() || undefined;
      const days = parseInt(opts?.days ?? "7", 10) || 7;

      try {
        const events = await fetchEvents({
          apiKey,
          location: resolvedLocation,
          keyword,
          days,
        });
        console.log(formatEvents(events));
      } catch (err) {
        console.error(`Error fetching events: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    });
}
