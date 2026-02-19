/**
 * Tesla tool — exposes Tesla vehicle commands to the OpenClaw agent.
 *
 * Actions: status, lock, unlock, climate_on, climate_off, set_temp,
 * start_charge, stop_charge, set_charge_limit, open_trunk, open_frunk,
 * honk, flash, vent_windows, close_windows, sentry_on, sentry_off,
 * open_charge_port, close_charge_port, location, list_vehicles.
 */

import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../../../src/plugins/types.js";
import {
  TeslaApiError,
  TeslaClient,
  type TeslaClientConfig,
  type VehicleStatus,
} from "./tesla-api.js";

const ACTIONS = [
  "status",
  "lock",
  "unlock",
  "climate_on",
  "climate_off",
  "set_temp",
  "start_charge",
  "stop_charge",
  "set_charge_limit",
  "open_trunk",
  "open_frunk",
  "honk",
  "flash",
  "vent_windows",
  "close_windows",
  "sentry_on",
  "sentry_off",
  "open_charge_port",
  "close_charge_port",
  "location",
  "list_vehicles",
] as const;

type Action = (typeof ACTIONS)[number];

function resolveConfig(api: OpenClawPluginApi): TeslaClientConfig {
  const cfg = api.pluginConfig ?? {};
  const clientId = typeof cfg.clientId === "string" ? cfg.clientId.trim() : "";
  const clientSecret = typeof cfg.clientSecret === "string" ? cfg.clientSecret.trim() : "";
  const refreshToken = typeof cfg.refreshToken === "string" ? cfg.refreshToken.trim() : "";
  const region = typeof cfg.region === "string" ? cfg.region.trim() : "na";

  if (!clientId) {
    throw new Error("Tesla plugin: clientId is required. Set it in the plugin config.");
  }
  if (!clientSecret) {
    throw new Error("Tesla plugin: clientSecret is required. Set it in the plugin config.");
  }
  if (!refreshToken) {
    throw new Error("Tesla plugin: refreshToken is required. Set it in the plugin config.");
  }

  return { clientId, clientSecret, refreshToken, region };
}

function getDefaultVin(api: OpenClawPluginApi): string | undefined {
  const cfg = api.pluginConfig ?? {};
  const vin = typeof cfg.vin === "string" ? cfg.vin.trim() : "";
  return vin || undefined;
}

function formatStatus(s: VehicleStatus): string {
  const lines: string[] = [];
  lines.push(`## ${s.vehicle.displayName} (${s.vehicle.vin})`);
  lines.push(`State: ${s.vehicle.state}`);
  lines.push("");

  // Battery & Charging
  lines.push("### Battery & Charging");
  lines.push(`Battery: ${s.charge.batteryLevel}% (${s.charge.batteryRange.toFixed(1)} mi range)`);
  lines.push(`Charging: ${s.charge.chargingState}`);
  if (s.charge.chargingState === "Charging") {
    lines.push(`  Rate: ${s.charge.chargeRateKw} kW`);
    lines.push(`  Time to full: ${s.charge.minutesToFullCharge} min`);
  }
  lines.push(`Charge limit: ${s.charge.chargeLimitPercent}%`);
  lines.push(`Charge port: ${s.charge.chargePortOpen ? "open" : "closed"}`);
  lines.push("");

  // Climate
  lines.push("### Climate");
  lines.push(`Climate: ${s.climate.isClimateOn ? "ON" : "OFF"}`);
  lines.push(`Inside: ${s.climate.insideTemp}°C / Outside: ${s.climate.outsideTemp}°C`);
  lines.push(
    `Target: driver ${s.climate.driverTempSetting}°C, passenger ${s.climate.passengerTempSetting}°C`,
  );
  lines.push("");

  // Location
  lines.push("### Location");
  lines.push(`Lat: ${s.drive.latitude}, Lon: ${s.drive.longitude}`);
  lines.push(`Heading: ${s.drive.heading}°`);
  if (s.drive.speed !== null) {
    lines.push(`Speed: ${s.drive.speed} mph`);
  }
  lines.push("");

  // Vehicle
  lines.push("### Vehicle");
  lines.push(`Locked: ${s.vehicleState.locked ? "yes" : "no"}`);
  lines.push(`Odometer: ${s.vehicleState.odometer.toFixed(1)} mi`);
  lines.push(`Sentry mode: ${s.vehicleState.sentryMode ? "ON" : "OFF"}`);
  lines.push(`Frunk: ${s.vehicleState.frunkOpen ? "open" : "closed"}`);
  lines.push(`Trunk: ${s.vehicleState.trunkOpen ? "open" : "closed"}`);
  lines.push(`Windows: ${s.vehicleState.windowsOpen ? "open" : "closed"}`);

  if (s.vehicleState.softwareUpdate.status) {
    lines.push(
      `Software update: ${s.vehicleState.softwareUpdate.status} (${s.vehicleState.softwareUpdate.version})`,
    );
  }

  return lines.join("\n");
}

export function createTeslaTool(api: OpenClawPluginApi) {
  // Lazily create client on first use so startup doesn't fail if config is missing.
  let client: TeslaClient | null = null;

  function getClient(): TeslaClient {
    if (!client) {
      client = new TeslaClient(resolveConfig(api));
    }
    return client;
  }

  return {
    name: "tesla",
    label: "Tesla",
    description: [
      "Control a Tesla vehicle. Actions:",
      "- status: full vehicle status (battery, climate, location, locks)",
      "- lock / unlock: door locks",
      "- climate_on / climate_off: start or stop climate",
      "- set_temp: set target temperature (provide temperature in °C)",
      "- start_charge / stop_charge: charging control",
      "- set_charge_limit: set charge limit percentage",
      "- open_charge_port / close_charge_port",
      "- open_trunk / open_frunk",
      "- honk / flash: honk horn or flash lights",
      "- vent_windows / close_windows",
      "- sentry_on / sentry_off: sentry mode",
      "- location: get current GPS coordinates",
      "- list_vehicles: list all vehicles on the account",
    ].join("\n"),

    parameters: Type.Object({
      action: Type.Unsafe<Action>({
        type: "string",
        enum: [...ACTIONS],
        description: "The Tesla command to execute.",
      }),
      vin: Type.Optional(
        Type.String({ description: "Vehicle VIN. Uses the default VIN from config if omitted." }),
      ),
      temperature: Type.Optional(
        Type.Number({ description: "Target temperature in °C (for set_temp action)." }),
      ),
      chargeLimit: Type.Optional(
        Type.Number({
          description: "Charge limit percentage 50-100 (for set_charge_limit action).",
        }),
      ),
    }),

    async execute(_id: string, params: Record<string, unknown>) {
      const action = (typeof params.action === "string" ? params.action.trim() : "") as Action;
      if (!action || !ACTIONS.includes(action)) {
        const valid = ACTIONS.join(", ");
        throw new Error(`Invalid action "${action}". Valid actions: ${valid}`);
      }

      const tesla = getClient();
      const vin = (typeof params.vin === "string" ? params.vin.trim() : "") || getDefaultVin(api);

      try {
        // list_vehicles doesn't need a specific vehicle
        if (action === "list_vehicles") {
          const vehicles = await tesla.listVehicles();
          const text =
            vehicles.length === 0
              ? "No vehicles found on your Tesla account."
              : vehicles
                  .map((v) => `- **${v.displayName}** | VIN: ${v.vin} | State: ${v.state}`)
                  .join("\n");
          return { content: [{ type: "text" as const, text }], details: vehicles };
        }

        // All other actions need a vehicle ID
        const vehicleId = await tesla.resolveVehicleId(vin);

        // Wake the vehicle before issuing commands (idempotent if already online)
        await tesla.wakeUp(vehicleId);

        switch (action) {
          case "status": {
            const status = await tesla.getVehicleData(vehicleId);
            return {
              content: [{ type: "text" as const, text: formatStatus(status) }],
              details: status,
            };
          }
          case "location": {
            const data = await tesla.getVehicleData(vehicleId);
            const loc = data.drive;
            const text = `Location: ${loc.latitude}, ${loc.longitude} (heading ${loc.heading}°)${loc.speed !== null ? `, speed: ${loc.speed} mph` : ""}`;
            return { content: [{ type: "text" as const, text }], details: loc };
          }
          case "lock": {
            await tesla.lock(vehicleId);
            return { content: [{ type: "text" as const, text: "Doors locked." }] };
          }
          case "unlock": {
            await tesla.unlock(vehicleId);
            return { content: [{ type: "text" as const, text: "Doors unlocked." }] };
          }
          case "climate_on": {
            await tesla.startClimate(vehicleId);
            return { content: [{ type: "text" as const, text: "Climate turned on." }] };
          }
          case "climate_off": {
            await tesla.stopClimate(vehicleId);
            return { content: [{ type: "text" as const, text: "Climate turned off." }] };
          }
          case "set_temp": {
            const temp = typeof params.temperature === "number" ? params.temperature : null;
            if (temp === null) {
              throw new Error("temperature parameter is required for set_temp action (in °C).");
            }
            await tesla.setTemperature(vehicleId, temp);
            return { content: [{ type: "text" as const, text: `Temperature set to ${temp}°C.` }] };
          }
          case "start_charge": {
            await tesla.startCharging(vehicleId);
            return { content: [{ type: "text" as const, text: "Charging started." }] };
          }
          case "stop_charge": {
            await tesla.stopCharging(vehicleId);
            return { content: [{ type: "text" as const, text: "Charging stopped." }] };
          }
          case "set_charge_limit": {
            const limit = typeof params.chargeLimit === "number" ? params.chargeLimit : null;
            if (limit === null) {
              throw new Error(
                "chargeLimit parameter is required for set_charge_limit action (50-100).",
              );
            }
            await tesla.setChargeLimit(vehicleId, limit);
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Charge limit set to ${Math.max(50, Math.min(100, limit))}%.`,
                },
              ],
            };
          }
          case "open_charge_port": {
            await tesla.openChargePort(vehicleId);
            return { content: [{ type: "text" as const, text: "Charge port opened." }] };
          }
          case "close_charge_port": {
            await tesla.closeChargePort(vehicleId);
            return { content: [{ type: "text" as const, text: "Charge port closed." }] };
          }
          case "open_trunk": {
            await tesla.openTrunk(vehicleId);
            return { content: [{ type: "text" as const, text: "Trunk opened/toggled." }] };
          }
          case "open_frunk": {
            await tesla.openFrunk(vehicleId);
            return { content: [{ type: "text" as const, text: "Frunk opened." }] };
          }
          case "honk": {
            await tesla.honkHorn(vehicleId);
            return { content: [{ type: "text" as const, text: "Horn honked." }] };
          }
          case "flash": {
            await tesla.flashLights(vehicleId);
            return { content: [{ type: "text" as const, text: "Lights flashed." }] };
          }
          case "vent_windows": {
            await tesla.ventWindows(vehicleId);
            return { content: [{ type: "text" as const, text: "Windows vented." }] };
          }
          case "close_windows": {
            await tesla.closeWindows(vehicleId);
            return { content: [{ type: "text" as const, text: "Windows closed." }] };
          }
          case "sentry_on": {
            await tesla.setSentryMode(vehicleId, true);
            return { content: [{ type: "text" as const, text: "Sentry mode enabled." }] };
          }
          case "sentry_off": {
            await tesla.setSentryMode(vehicleId, false);
            return { content: [{ type: "text" as const, text: "Sentry mode disabled." }] };
          }
          default: {
            // Exhaustiveness: all actions are handled above.
            const _never: never = action;
            throw new Error(`Unhandled action: ${_never}`);
          }
        }
      } catch (err) {
        if (err instanceof TeslaApiError) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Tesla API error (${err.statusCode}): ${err.message}`,
              },
            ],
          };
        }
        throw err;
      }
    },
  };
}
