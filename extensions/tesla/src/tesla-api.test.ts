import { describe, expect, it, vi, beforeEach } from "vitest";
import { TeslaClient, TeslaApiError, type TeslaClientConfig } from "./tesla-api.js";

const DEFAULT_CONFIG: TeslaClientConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  refreshToken: "test-refresh-token",
  region: "na",
};

function mockFetch(responses: Array<{ ok: boolean; status: number; body: unknown }>) {
  let callIndex = 0;
  return vi.fn(async (_url: string, _init?: RequestInit) => {
    const resp = responses[callIndex++];
    if (!resp) {
      throw new Error(`Unexpected fetch call #${callIndex}`);
    }
    return {
      ok: resp.ok,
      status: resp.status,
      json: async () => resp.body,
      text: async () => JSON.stringify(resp.body),
    };
  });
}

describe("TeslaClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("token refresh", () => {
    it("refreshes token on first API call", async () => {
      const fetchMock = mockFetch([
        // Token refresh
        {
          ok: true,
          status: 200,
          body: {
            access_token: "new-access-token",
            refresh_token: "new-refresh-token",
            expires_in: 3600,
          },
        },
        // listVehicles
        {
          ok: true,
          status: 200,
          body: {
            response: [
              {
                id: 1,
                vehicle_id: 100,
                vin: "5YJ3E1EA0LF000001",
                display_name: "My Tesla",
                state: "online",
              },
            ],
          },
        },
      ]);

      vi.stubGlobal("fetch", fetchMock);
      const client = new TeslaClient(DEFAULT_CONFIG);
      const vehicles = await client.listVehicles();

      expect(vehicles).toHaveLength(1);
      expect(vehicles[0]!.vin).toBe("5YJ3E1EA0LF000001");
      expect(vehicles[0]!.displayName).toBe("My Tesla");

      // Token refresh call
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const tokenCall = fetchMock.mock.calls[0]!;
      expect(tokenCall[0]).toBe("https://auth.tesla.com/oauth2/v3/token");
    });

    it("throws TeslaApiError on token refresh failure", async () => {
      const fetchMock = mockFetch([{ ok: false, status: 401, body: { error: "invalid_grant" } }]);

      vi.stubGlobal("fetch", fetchMock);
      const client = new TeslaClient(DEFAULT_CONFIG);

      await expect(client.listVehicles()).rejects.toThrow(TeslaApiError);
    });
  });

  describe("listVehicles", () => {
    it("returns mapped vehicle info", async () => {
      const fetchMock = mockFetch([
        {
          ok: true,
          status: 200,
          body: { access_token: "tok", refresh_token: "rt", expires_in: 3600 },
        },
        {
          ok: true,
          status: 200,
          body: {
            response: [
              { id: 1, vehicle_id: 100, vin: "VIN1", display_name: "Car 1", state: "online" },
              { id: 2, vehicle_id: 200, vin: "VIN2", display_name: "Car 2", state: "asleep" },
            ],
          },
        },
      ]);

      vi.stubGlobal("fetch", fetchMock);
      const client = new TeslaClient(DEFAULT_CONFIG);
      const vehicles = await client.listVehicles();

      expect(vehicles).toHaveLength(2);
      expect(vehicles[0]).toEqual({
        id: 1,
        vehicleId: 100,
        vin: "VIN1",
        displayName: "Car 1",
        state: "online",
      });
    });
  });

  describe("resolveVehicleId", () => {
    it("resolves by VIN", async () => {
      const fetchMock = mockFetch([
        {
          ok: true,
          status: 200,
          body: { access_token: "tok", refresh_token: "rt", expires_in: 3600 },
        },
        {
          ok: true,
          status: 200,
          body: {
            response: [
              { id: 10, vehicle_id: 100, vin: "VIN_A", display_name: "A", state: "online" },
              { id: 20, vehicle_id: 200, vin: "VIN_B", display_name: "B", state: "online" },
            ],
          },
        },
      ]);

      vi.stubGlobal("fetch", fetchMock);
      const client = new TeslaClient(DEFAULT_CONFIG);
      const id = await client.resolveVehicleId("VIN_B");

      expect(id).toBe(20);
    });

    it("uses first vehicle when no VIN specified", async () => {
      const fetchMock = mockFetch([
        {
          ok: true,
          status: 200,
          body: { access_token: "tok", refresh_token: "rt", expires_in: 3600 },
        },
        {
          ok: true,
          status: 200,
          body: {
            response: [
              { id: 42, vehicle_id: 100, vin: "VIN_X", display_name: "X", state: "online" },
            ],
          },
        },
      ]);

      vi.stubGlobal("fetch", fetchMock);
      const client = new TeslaClient(DEFAULT_CONFIG);
      const id = await client.resolveVehicleId();

      expect(id).toBe(42);
    });

    it("throws when VIN not found", async () => {
      const fetchMock = mockFetch([
        {
          ok: true,
          status: 200,
          body: { access_token: "tok", refresh_token: "rt", expires_in: 3600 },
        },
        {
          ok: true,
          status: 200,
          body: {
            response: [
              { id: 1, vehicle_id: 100, vin: "VIN_A", display_name: "A", state: "online" },
            ],
          },
        },
      ]);

      vi.stubGlobal("fetch", fetchMock);
      const client = new TeslaClient(DEFAULT_CONFIG);

      await expect(client.resolveVehicleId("NONEXISTENT")).rejects.toThrow("not found");
    });

    it("throws when no vehicles on account", async () => {
      const fetchMock = mockFetch([
        {
          ok: true,
          status: 200,
          body: { access_token: "tok", refresh_token: "rt", expires_in: 3600 },
        },
        { ok: true, status: 200, body: { response: [] } },
      ]);

      vi.stubGlobal("fetch", fetchMock);
      const client = new TeslaClient(DEFAULT_CONFIG);

      await expect(client.resolveVehicleId()).rejects.toThrow("No vehicles found");
    });
  });

  describe("commands", () => {
    function setupCommandTest() {
      const fetchMock = mockFetch([
        // Token refresh
        {
          ok: true,
          status: 200,
          body: { access_token: "tok", refresh_token: "rt", expires_in: 3600 },
        },
        // Command response
        { ok: true, status: 200, body: { response: { result: true } } },
      ]);
      vi.stubGlobal("fetch", fetchMock);
      return { fetchMock, client: new TeslaClient(DEFAULT_CONFIG) };
    }

    it("sends lock command", async () => {
      const { fetchMock, client } = setupCommandTest();
      await client.lock(123);

      const cmdCall = fetchMock.mock.calls[1]!;
      expect(cmdCall[0]).toContain("/api/1/vehicles/123/command/door_lock");
    });

    it("sends unlock command", async () => {
      const { fetchMock, client } = setupCommandTest();
      await client.unlock(123);

      const cmdCall = fetchMock.mock.calls[1]!;
      expect(cmdCall[0]).toContain("/api/1/vehicles/123/command/door_unlock");
    });

    it("sends set_temps command", async () => {
      const { fetchMock, client } = setupCommandTest();
      await client.setTemperature(123, 22, 23);

      const cmdCall = fetchMock.mock.calls[1]!;
      expect(cmdCall[0]).toContain("/api/1/vehicles/123/command/set_temps");
      const body = JSON.parse((cmdCall[1] as unknown as { body: string }).body);
      expect(body).toEqual({ driver_temp: 22, passenger_temp: 23 });
    });

    it("sends charge limit clamped to 50-100", async () => {
      const { fetchMock, client } = setupCommandTest();
      await client.setChargeLimit(123, 30);

      const cmdCall = fetchMock.mock.calls[1]!;
      const body = JSON.parse((cmdCall[1] as unknown as { body: string }).body);
      expect(body.percent).toBe(50);
    });

    it("sends actuate_trunk for rear", async () => {
      const { fetchMock, client } = setupCommandTest();
      await client.openTrunk(123);

      const cmdCall = fetchMock.mock.calls[1]!;
      expect(cmdCall[0]).toContain("actuate_trunk");
      const body = JSON.parse((cmdCall[1] as unknown as { body: string }).body);
      expect(body.which_trunk).toBe("rear");
    });

    it("sends actuate_trunk for front (frunk)", async () => {
      const { fetchMock, client } = setupCommandTest();
      await client.openFrunk(123);

      const cmdCall = fetchMock.mock.calls[1]!;
      const body = JSON.parse((cmdCall[1] as unknown as { body: string }).body);
      expect(body.which_trunk).toBe("front");
    });

    it("sends sentry mode on", async () => {
      const { fetchMock, client } = setupCommandTest();
      await client.setSentryMode(123, true);

      const cmdCall = fetchMock.mock.calls[1]!;
      expect(cmdCall[0]).toContain("set_sentry_mode");
      const body = JSON.parse((cmdCall[1] as unknown as { body: string }).body);
      expect(body.on).toBe(true);
    });
  });

  describe("region hosts", () => {
    it("uses EU host for eu region", async () => {
      const fetchMock = mockFetch([
        {
          ok: true,
          status: 200,
          body: { access_token: "tok", refresh_token: "rt", expires_in: 3600 },
        },
        { ok: true, status: 200, body: { response: [] } },
      ]);

      vi.stubGlobal("fetch", fetchMock);
      const client = new TeslaClient({ ...DEFAULT_CONFIG, region: "eu" });
      await client.listVehicles();

      const apiCall = fetchMock.mock.calls[1]!;
      expect(apiCall[0]).toContain("fleet-api.prd.eu.vn.cloud.tesla.com");
    });

    it("defaults to NA host for unknown region", async () => {
      const fetchMock = mockFetch([
        {
          ok: true,
          status: 200,
          body: { access_token: "tok", refresh_token: "rt", expires_in: 3600 },
        },
        { ok: true, status: 200, body: { response: [] } },
      ]);

      vi.stubGlobal("fetch", fetchMock);
      const client = new TeslaClient({ ...DEFAULT_CONFIG, region: "unknown" });
      await client.listVehicles();

      const apiCall = fetchMock.mock.calls[1]!;
      expect(apiCall[0]).toContain("fleet-api.prd.na.vn.cloud.tesla.com");
    });
  });
});
