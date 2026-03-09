import type { Request, Response } from "express";

export interface DependencyCheck {
  name: string;
  check: () => Promise<void>;
}

export interface HealthResponse {
  service: string;
  status: "ok" | "degraded" | "unavailable";
  version: string;
  timestamp: string;
  dependencies: Record<string, { status: "ok" | "unavailable"; latency_ms: number; error?: string }>;
}

function getVersion(): string {
  return process.env.npm_package_version ?? process.env.SERVICE_VERSION ?? "0.1.0";
}

async function checkDependency(dep: DependencyCheck) {
  const start = performance.now();
  try {
    await dep.check();
    return { status: "ok" as const, latency_ms: Math.round(performance.now() - start) };
  } catch (err) {
    return {
      status: "unavailable" as const,
      latency_ms: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function createHealthRoutes(serviceName: string, dependencies: DependencyCheck[]) {
  const liveness = (_req: Request, res: Response) => {
    res.json({
      service: serviceName,
      status: "ok",
      version: getVersion(),
      timestamp: new Date().toISOString(),
    });
  };

  const readiness = async (_req: Request, res: Response) => {
    const depResults: HealthResponse["dependencies"] = {};
    const checks = await Promise.all(
      dependencies.map(async (dep) => {
        const result = await checkDependency(dep);
        depResults[dep.name] = result;
        return result;
      })
    );

    const allOk = checks.every((c) => c.status === "ok");
    const response: HealthResponse = {
      service: serviceName,
      status: allOk ? "ok" : "degraded",
      version: getVersion(),
      timestamp: new Date().toISOString(),
      dependencies: depResults,
    };

    res.status(allOk ? 200 : 503).json(response);
  };

  return { liveness, readiness };
}
