import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { describeDatabaseError, ensureBuildState, resolveWorkspaceId } from "../db";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireWorkspace = t.middleware(async ({ ctx, next }) => {
  let workspaceId = ctx.workspaceId;

  if (!Number.isSafeInteger(workspaceId) || (workspaceId ?? 0) < 1) {
    try {
      ctx.workspacePromise ??= (async () => {
        const resolved = await resolveWorkspaceId();
        await ensureBuildState(resolved);
        return resolved;
      })();
      workspaceId = await ctx.workspacePromise;
      ctx.workspaceId = workspaceId;
    } catch (error) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: describeDatabaseError(error),
        cause: error,
      });
    }
  }

  return next({
    ctx: {
      ...ctx,
      workspaceId: workspaceId as number,
    },
  });
});

export const workspaceProcedure = t.procedure.use(requireWorkspace);
