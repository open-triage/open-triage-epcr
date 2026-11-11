import type { Page, Request, Response } from "@playwright/test";
export interface ResponseObservationDiagnostics {
  requests: number;
  beforePhase: number;
  otherScope: number;
  cancelled: number;
  navigated: number;
  completed: number;
}
export declare function observeJsonResponse(page: Page, options: {
  label: string;
  matchesRequest: (request: Request) => boolean;
  action: () => void | Promise<void>;
  scope: (signal: AbortSignal) => ((request: Request) => boolean) | Promise<(request: Request) => boolean>;
  verify: (body: unknown, response: Response) => void;
  timeout?: number;
}): Promise<{ body: unknown; diagnostics: ResponseObservationDiagnostics }>;
