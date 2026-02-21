const DISCOVERY_BASE = "https://app.ticketmaster.com/discovery/v2/events.json";

export type EventSearchParams = {
  apiKey: string;
  location?: string;
  keyword?: string;
  days?: number;
};

export type EventResult = {
  name: string;
  date: string;
  time?: string;
  venue: string;
  city: string;
  url: string;
};

export async function fetchEvents(params: EventSearchParams): Promise<EventResult[]> {
  const { apiKey, location, keyword, days = 7 } = params;

  const url = new URL(DISCOVERY_BASE);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("size", "20");
  url.searchParams.set("sort", "date,asc");

  if (location) {
    url.searchParams.set("city", extractCity(location));
  }
  if (keyword) {
    url.searchParams.set("keyword", keyword);
  }

  const now = new Date();
  url.searchParams.set("startDateTime", toTmDate(now));
  const end = new Date(now.getTime() + days * 86_400_000);
  url.searchParams.set("endDateTime", toTmDate(end));

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ticketmaster API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as TmResponse;
  const events = json._embedded?.events;
  if (!events || events.length === 0) {
    return [];
  }

  return events.map(parseEvent);
}

export function formatEvents(events: EventResult[]): string {
  if (events.length === 0) {
    return "No events found for the given criteria.";
  }

  return events
    .map((e, i) => {
      const time = e.time ? ` ${e.time}` : "";
      return `${i + 1}. **${e.name}**\n   ${e.date}${time} — ${e.venue}, ${e.city}\n   ${e.url}`;
    })
    .join("\n\n");
}

// Ticketmaster expects ISO 8601 with trailing Z, no millis
function toTmDate(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// "Miami, FL" → "Miami", "New York" → "New York"
function extractCity(location: string): string {
  return location.split(",")[0].trim();
}

function parseEvent(e: TmEvent): EventResult {
  const venue = e._embedded?.venues?.[0];
  return {
    name: e.name,
    date: e.dates?.start?.localDate ?? "TBD",
    time: e.dates?.start?.localTime?.slice(0, 5),
    venue: venue?.name ?? "Unknown venue",
    city: venue?.city?.name ?? "",
    url: e.url,
  };
}

// Minimal Ticketmaster Discovery API response types
type TmResponse = {
  _embedded?: { events?: TmEvent[] };
};

type TmEvent = {
  name: string;
  url: string;
  dates?: { start?: { localDate?: string; localTime?: string } };
  _embedded?: { venues?: Array<{ name?: string; city?: { name?: string } }> };
};
