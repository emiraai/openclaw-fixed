# Events Plugin

Search for upcoming concerts, sports, theater, and other live events using the
[Ticketmaster Discovery API](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/).

## Get a Free API Key

1. Create an account at <https://developer.ticketmaster.com/>
2. Go to **My Apps** → **Add a new App**
3. Copy the **Consumer Key** (this is your API key)

The free tier allows 5,000 requests per day.

## Enable the Plugin

```json
{
  "plugins": {
    "entries": {
      "events": {
        "enabled": true,
        "config": {
          "apiKey": "YOUR_TICKETMASTER_API_KEY",
          "defaultLocation": "Miami"
        }
      }
    }
  }
}
```

Or via CLI:

```bash
openclaw config set plugins.entries.events.enabled true
openclaw config set plugins.entries.events.config.apiKey YOUR_KEY
openclaw config set plugins.entries.events.config.defaultLocation Miami
```

## Config

| Key               | Type   | Required | Description                                |
| ----------------- | ------ | -------- | ------------------------------------------ |
| `apiKey`          | string | yes      | Ticketmaster Discovery API consumer key    |
| `defaultLocation` | string | no       | Default city for searches (e.g. `"Miami"`) |

## Agent Tool

The plugin registers an `events_search` tool available to all agents when the
plugin is enabled.

### Parameters

- `location` (string, optional) — city to search; falls back to `defaultLocation`
- `keyword` (string, optional) — genre or artist filter (e.g. `"electronic"`)
- `days` (number, optional) — how many days ahead to search (default: 7)

### Example prompt

> "What concerts are happening in Austin this weekend?"

## CLI

```bash
openclaw events Miami --keyword jazz --days 14
openclaw events "New York" --keyword "Broadway"
openclaw events                # uses defaultLocation from config
```
