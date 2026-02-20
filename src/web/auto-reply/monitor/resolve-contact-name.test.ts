import { describe, expect, it } from "vitest";
import { resolveDmSenderName } from "./resolve-contact-name.js";

describe("resolveDmSenderName", () => {
  it("returns undefined for group chats", () => {
    const result = resolveDmSenderName({
      msg: {
        chatType: "group",
        from: "+15551234567",
        senderE164: "+15551234567",
        senderName: "Alice",
      },
    });
    expect(result).toBeUndefined();
  });

  it("uses contactNames when phone matches", () => {
    const result = resolveDmSenderName({
      msg: {
        chatType: "direct",
        from: "+15551234567",
        senderE164: "+15551234567",
        senderName: "MG",
      },
      contactNames: { "+15551234567": "Alice Smith" },
    });
    expect(result).toBe("Alice Smith");
  });

  it("falls back to pushName when contactNames has no entry", () => {
    const result = resolveDmSenderName({
      msg: {
        chatType: "direct",
        from: "+15559999999",
        senderE164: "+15559999999",
        senderName: "Bob",
      },
      contactNames: { "+15551111111": "Someone Else" },
    });
    expect(result).toBe("Bob");
  });

  it("falls back to phone number when pushName is empty", () => {
    const result = resolveDmSenderName({
      msg: {
        chatType: "direct",
        from: "+15551234567",
        senderE164: "+15551234567",
        senderName: "",
      },
    });
    expect(result).toBe("+15551234567");
  });

  it("falls back to 'contact' when no phone and no pushName", () => {
    const result = resolveDmSenderName({
      msg: {
        chatType: "direct",
        from: "",
        senderE164: undefined,
        senderName: undefined,
      },
    });
    expect(result).toBe("contact");
  });

  it("normalizes phone number for contactNames lookup", () => {
    const result = resolveDmSenderName({
      msg: {
        chatType: "direct",
        from: "15551234567",
        senderE164: "15551234567",
        senderName: "MG",
      },
      contactNames: { "+15551234567": "Alice Smith" },
    });
    expect(result).toBe("Alice Smith");
  });

  it("uses senderE164 over from for lookup", () => {
    const result = resolveDmSenderName({
      msg: {
        chatType: "direct",
        from: "15551234567@s.whatsapp.net",
        senderE164: "+15559876543",
        senderName: "MG",
      },
      contactNames: { "+15559876543": "Carol" },
    });
    expect(result).toBe("Carol");
  });

  it("prefers contactNames over pushName even when pushName is set", () => {
    const result = resolveDmSenderName({
      msg: {
        chatType: "direct",
        from: "+15551234567",
        senderE164: "+15551234567",
        senderName: "Weird PushName 123",
      },
      contactNames: { "+15551234567": "Proper Name" },
    });
    expect(result).toBe("Proper Name");
  });

  it("works with undefined contactNames", () => {
    const result = resolveDmSenderName({
      msg: {
        chatType: "direct",
        from: "+15551234567",
        senderE164: "+15551234567",
        senderName: "Alice",
      },
      contactNames: undefined,
    });
    expect(result).toBe("Alice");
  });
});
