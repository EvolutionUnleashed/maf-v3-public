import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  /** Resolved lazily by workspaceProcedure so setup and key management stay available. */
  workspaceId: number | null;
  workspacePromise?: Promise<number>;
};

export async function createContext(
  opts: CreateExpressContextOptions,
): Promise<TrpcContext> {
  return {
    req: opts.req,
    res: opts.res,
    workspaceId: null,
  };
}
