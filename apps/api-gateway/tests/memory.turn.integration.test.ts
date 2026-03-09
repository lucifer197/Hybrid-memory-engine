import { describe, it, expect } from "vitest";

/**
 * Integration test — requires both api-gateway (:3000) and memory-service (:3001)
 * to be running. Run via docker-compose or manually.
 *
 * Usage: INTEGRATION=1 vitest run tests/memory.turn.integration.test.ts
 */
const API_URL = process.env.API_URL ?? "http://localhost:3000";
const RUN_INTEGRATION = process.env.INTEGRATION === "1";

describe.skipIf(!RUN_INTEGRATION)("POST /v1/memory/turn — integration", () => {
  const payload = {
    tenant_id: "t_int",
    workspace_id: "ws_int",
    user_id: "u_int",
    session_id: "sess_int",
    turn_id: `turn_int_${Date.now()}`,
    messages: [
      { role: "user", content: "Integration test message." },
      { role: "assistant", content: "Acknowledged." },
    ],
  };

  it("returns 201 with memory_ids", async () => {
    const res = await fetch(`${API_URL}/v1/memory/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.turn_id).toBe(payload.turn_id);
    expect(body.memory_ids.length).toBeGreaterThanOrEqual(1);
    expect(res.headers.get("X-Trace-Id")).toBeTruthy();
  });

  it("returns same memory_ids on idempotent retry", async () => {
    const first = await fetch(`${API_URL}/v1/memory/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const second = await fetch(`${API_URL}/v1/memory/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const body1 = await first.json();
    const body2 = await second.json();
    expect(body2.memory_ids).toEqual(body1.memory_ids);
  });

  it("rejects invalid payload with 400", async () => {
    const res = await fetch(`${API_URL}/v1/memory/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: "t" }), // missing required fields
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("BAD_REQUEST");
  });
});
