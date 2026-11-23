import { computeDashboard, type DashboardComputeInput } from "./dashboardLogic";

self.onmessage = (event: MessageEvent<{ id: number; payload: DashboardComputeInput }>) => {
  const { id, payload } = event.data;
  const result = computeDashboard(payload);
  self.postMessage({ id, result });
};
