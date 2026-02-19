import { describe, expect, it, vi, beforeEach } from "vitest";
import type { OpenClawPluginApi } from "../../../src/plugins/types.js";
import { createTeslaTool } from "./tesla-tool.js";

// Stub the TeslaClient module so we don't make real API calls.
vi.mock("./tesla-api.js", () => {
  const mockClient = {
    listVehicles: vi.fn(),
    resolveVehicleId: vi.fn(),
    wakeUp: vi.fn(),
    getVehicleData: vi.fn(),
    lock: vi.fn(),
    unlock: vi.fn(),
    startClimate: vi.fn(),
    stopClimate: vi.fn(),
    setTemperature: vi.fn(),
    startCharging: vi.fn(),
    stopCharging: vi.fn(),
    setChargeLimit: vi.fn(),
    openChargePort: vi.fn(),
    closeChargePort: vi.fn(),
    openTrunk: vi.fn(),
    openFrunk: vi.fn(),
    honkHorn: vi.fn(),
    flashLights: vi.fn(),
    ventWindows: vi.fn(),
    closeWindows: vi.fn(),
    setSentryMode: vi.fn(),
    remoteStartDrive: vi.fn(),
  };

  // Use a real class so `new TeslaClient(...)` works.
  class MockTeslaClient {
    constructor(_config: unknown) {
      return mockClient;
    }
  }

  return {
    TeslaClient: MockTeslaClient,
    TeslaApiError: class TeslaApiError extends Error {
      statusCode: number;
      apiError: string;
      constructor(statusCode: number, apiError: string, message: string) {
        super(message);
        this.statusCode = statusCode;
        this.apiError = apiError;
        this.name = "TeslaApiError";
      }
    },
    __mockClient: mockClient,
  };
});

// Access the shared mock client for assertions.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { __mockClient: mockClient } = (await import("./tesla-api.js")) as unknown as {
  __mockClient: Record<string, ReturnType<typeof vi.fn>>;
};

function makeApi(pluginConfig: Record<string, unknown> = {}): OpenClawPluginApi {
  return {
    id: "tesla",
    name: "Tesla",
    pluginConfig: {
      clientId: "cid",
      clientSecret: "cs",
      refreshToken: "rt",
      vin: "DEFAULT_VIN",
      ...pluginConfig,
    },
    config: {} as OpenClawPluginApi["config"],
    runtime: { version: "test" } as OpenClawPluginApi["runtime"],
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as OpenClawPluginApi["logger"],
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerService: vi.fn(),
    registerHook: vi.fn(),
    registerHttpHandler: vi.fn(),
    registerHttpRoute: vi.fn(),
    registerChannel: vi.fn(),
    registerGatewayMethod: vi.fn(),
    registerCli: vi.fn(),
    registerProvider: vi.fn(),
    on: vi.fn(),
    resolvePath: vi.fn((p: string) => p),
  } as unknown as OpenClawPluginApi;
}

describe("createTeslaTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.resolveVehicleId.mockResolvedValue(42);
    mockClient.wakeUp.mockResolvedValue(undefined);
  });

  it("has correct name and description", () => {
    const tool = createTeslaTool(makeApi());
    expect(tool.name).toBe("tesla");
    expect(tool.label).toBe("Tesla");
    expect(tool.description).toContain("Control a Tesla vehicle");
  });

  it("rejects invalid action", async () => {
    const tool = createTeslaTool(makeApi());
    await expect(tool.execute("id", { action: "explode" })).rejects.toThrow("Invalid action");
  });

  it("executes list_vehicles", async () => {
    mockClient.listVehicles.mockResolvedValue([
      { id: 1, vehicleId: 100, vin: "VIN1", displayName: "Car", state: "online" },
    ]);

    const tool = createTeslaTool(makeApi());
    const result = await tool.execute("id", { action: "list_vehicles" });

    expect(result.content[0]!.text).toContain("VIN1");
    expect(mockClient.listVehicles).toHaveBeenCalled();
    // Should NOT wake or resolve vehicle ID
    expect(mockClient.wakeUp).not.toHaveBeenCalled();
  });

  it("executes lock", async () => {
    const tool = createTeslaTool(makeApi());
    const result = await tool.execute("id", { action: "lock" });

    expect(result.content[0]!.text).toBe("Doors locked.");
    expect(mockClient.wakeUp).toHaveBeenCalledWith(42);
    expect(mockClient.lock).toHaveBeenCalledWith(42);
  });

  it("executes unlock", async () => {
    const tool = createTeslaTool(makeApi());
    const result = await tool.execute("id", { action: "unlock" });

    expect(result.content[0]!.text).toBe("Doors unlocked.");
    expect(mockClient.unlock).toHaveBeenCalledWith(42);
  });

  it("executes climate_on", async () => {
    const tool = createTeslaTool(makeApi());
    const result = await tool.execute("id", { action: "climate_on" });

    expect(result.content[0]!.text).toBe("Climate turned on.");
    expect(mockClient.startClimate).toHaveBeenCalledWith(42);
  });

  it("executes set_temp with temperature", async () => {
    const tool = createTeslaTool(makeApi());
    const result = await tool.execute("id", { action: "set_temp", temperature: 22 });

    expect(result.content[0]!.text).toBe("Temperature set to 22°C.");
    expect(mockClient.setTemperature).toHaveBeenCalledWith(42, 22);
  });

  it("rejects set_temp without temperature", async () => {
    const tool = createTeslaTool(makeApi());
    await expect(tool.execute("id", { action: "set_temp" })).rejects.toThrow(
      "temperature parameter is required",
    );
  });

  it("executes set_charge_limit", async () => {
    const tool = createTeslaTool(makeApi());
    const result = await tool.execute("id", { action: "set_charge_limit", chargeLimit: 80 });

    expect(result.content[0]!.text).toContain("80%");
    expect(mockClient.setChargeLimit).toHaveBeenCalledWith(42, 80);
  });

  it("rejects set_charge_limit without chargeLimit", async () => {
    const tool = createTeslaTool(makeApi());
    await expect(tool.execute("id", { action: "set_charge_limit" })).rejects.toThrow(
      "chargeLimit parameter is required",
    );
  });

  it("executes status and formats output", async () => {
    mockClient.getVehicleData.mockResolvedValue({
      vehicle: { id: 42, vehicleId: 100, vin: "VIN1", displayName: "My Tesla", state: "online" },
      charge: {
        batteryLevel: 78,
        batteryRange: 220.5,
        chargingState: "Complete",
        chargePortOpen: false,
        chargeRateKw: 0,
        minutesToFullCharge: 0,
        chargeLimitPercent: 90,
      },
      climate: {
        insideTemp: 22,
        outsideTemp: 15,
        driverTempSetting: 21,
        passengerTempSetting: 21,
        isClimateOn: false,
        seatHeaterLeft: 0,
        seatHeaterRight: 0,
      },
      drive: {
        latitude: 37.7749,
        longitude: -122.4194,
        heading: 90,
        speed: null,
        shiftState: null,
      },
      vehicleState: {
        locked: true,
        odometer: 12345.6,
        softwareUpdate: { status: "", version: "" },
        sentryMode: false,
        frunkOpen: false,
        trunkOpen: false,
        windowsOpen: false,
      },
    });

    const tool = createTeslaTool(makeApi());
    const result = await tool.execute("id", { action: "status" });
    const text = result.content[0]!.text;

    expect(text).toContain("My Tesla");
    expect(text).toContain("78%");
    expect(text).toContain("220.5 mi");
    expect(text).toContain("Locked: yes");
  });

  it("executes location", async () => {
    mockClient.getVehicleData.mockResolvedValue({
      vehicle: { id: 42, vehicleId: 100, vin: "VIN1", displayName: "My Tesla", state: "online" },
      charge: {} as Record<string, unknown>,
      climate: {} as Record<string, unknown>,
      drive: { latitude: 37.7749, longitude: -122.4194, heading: 90, speed: 65, shiftState: "D" },
      vehicleState: {} as Record<string, unknown>,
    });

    const tool = createTeslaTool(makeApi());
    const result = await tool.execute("id", { action: "location" });

    expect(result.content[0]!.text).toContain("37.7749");
    expect(result.content[0]!.text).toContain("-122.4194");
    expect(result.content[0]!.text).toContain("65 mph");
  });

  it("uses default VIN from config", async () => {
    const tool = createTeslaTool(makeApi({ vin: "MY_DEFAULT_VIN" }));
    await tool.execute("id", { action: "lock" });

    expect(mockClient.resolveVehicleId).toHaveBeenCalledWith("MY_DEFAULT_VIN");
  });

  it("prefers explicit VIN over default", async () => {
    const tool = createTeslaTool(makeApi({ vin: "MY_DEFAULT_VIN" }));
    await tool.execute("id", { action: "lock", vin: "EXPLICIT_VIN" });

    expect(mockClient.resolveVehicleId).toHaveBeenCalledWith("EXPLICIT_VIN");
  });

  it("throws when config is missing required fields", async () => {
    const api = makeApi({ clientId: "", clientSecret: "cs", refreshToken: "rt" });
    const tool = createTeslaTool(api);

    await expect(tool.execute("id", { action: "lock" })).rejects.toThrow("clientId is required");
  });
});
