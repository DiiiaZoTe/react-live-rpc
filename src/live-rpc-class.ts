import type { MutationDef, QueryDef, RPCConfig, RPCRequest } from './live-rpc-builder-class';
import { tryCatch } from './try-catch';
import { getRpcChannelName } from './get-rpc-channel';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';

type InferQueryFunctions<Q extends Record<string, QueryDef<any, any>>> = {
  [K in keyof Q]: {
    (
      params: Q[K] extends QueryDef<infer P, any> ? z.infer<P> : never,
      request: RPCRequest
    ): Promise<
      Q[K] extends QueryDef<any, infer R> ? R : never
    >;
    invalidate: (
      params: Q[K] extends QueryDef<infer P, any> ? z.infer<P> : never,
      request: RPCRequest
    ) => Promise<
      Q[K] extends QueryDef<any, infer R> ? R : never
    >;
    batchInvalidate: (
      params: Q[K] extends QueryDef<infer P, any> ? z.infer<P> : never,
      request: RPCRequest
    ) => Promise<{ result: any, channel: string }>;
  };
};

type InferMutationFunctions<M extends Record<string, MutationDef<any, any, any>>> = {
  [K in keyof M]: (
    params: M[K] extends MutationDef<infer P, any, any> ? z.infer<P> : never,
    request: RPCRequest
  ) => Promise<
    M[K] extends MutationDef<any, infer R, any> ? R : never
  >;
};

/**
 * @example
 * ``` js
 * const rpc = new LiveRPC({
 *   socket: {
 *     broadcast: async (channel: string, event: string, data: any) => {
 *       await pusher.trigger(channel, event, data);
 *     },
 *     batchBroadcast: async (broadcasts: { channel: string, name: string, data: any }[]) => {
 *       await pusher.triggerBatch(broadcasts);
 *     },
 *     maxBatchSize: 10,
 *   },
 *   config: new LiveRPCBuilder()
 *     .addQuery('getUsers', {
 *       params: z.undefined(),
 *       query: async (params, request) => {
 *         return await db.query.users.findMany();
 *       }
 *     })
 *     .addMutation('createUser', {
 *       params: z.object({
 *         name: z.string(),
 *       }),
 *       mutation: async (params, request) => {
 *         return await db.mutation.users.create({ data: params });
 *       }
 *     })
 * })
 *
 * const rpcRoutes = new Hono()
 *   .post('/*', async (c) => {
 *     return await rpc.handleRequest(c);
 *   })
 * ```
 */
export class LiveRPC<T extends RPCConfig<any, any>> {
  public queries: InferQueryFunctions<T['queries']>;
  public mutations: InferMutationFunctions<T['mutations']>;
  private config: T;

  constructor(
    private options: {
      socket: {
        /** broadcast a single event */
        broadcast: (channel: string, event: string, data: any) => Promise<void>;
        /** broadcast multiple events (`name`) at once */
        batchBroadcast: (broadcasts: { channel: string, name: string, data: any }[]) => Promise<void>;
        /** max number of broadcasts to send in a single batch, default is 10 */
        maxBatchSize?: number;
      };
      config: T | { build: () => T };
    }
  ) {
    const builtConfig: T =
      typeof (options.config as any).build === 'function'
        ? (options.config as any).build()
        : options.config;

    this.queries = {} as T['queries'];
    this.mutations = {} as T['mutations'];
    this.config = builtConfig;

    //set default maxBatchSize to 10
    if (!options.socket.maxBatchSize) {
      options.socket.maxBatchSize = 10;
    }

    const { queries, mutations } = builtConfig;

    for (const [name, def] of Object.entries(queries) as [string, QueryDef<any, any>][]) {
      const fn = async (params: any, request: RPCRequest, withAuth = true) => {
        const [parsed, parsedError] = await tryCatch(this.validateParams('query', name, params));
        if (parsedError) throw new HTTPException(400, { message: parsedError.message });
        if (withAuth && def.authorization) {
          const [result, error] = await tryCatch(def.authorization(parsed, request));
          if (error) throw new HTTPException(401, { message: "Unauthorized" });
        }
        const [result, error] = await tryCatch(def.query(parsed, request));
        if (error) throw error;
        return result;
      };

      fn.invalidate = async (params: any, request: RPCRequest) => {
        const [parsed, parsedError] = await tryCatch(this.validateParams('query', name, params));
        if (parsedError) throw new HTTPException(400, { message: parsedError.message });
        const [result, error] = await tryCatch(def.query(parsed, request));
        if (error) throw error;
        const channel = getRpcChannelName(name, parsed);
        const [, errorBroadcast] = await tryCatch(options.socket.broadcast(channel, 'update', result));
        if (errorBroadcast) throw new HTTPException(500, { message: "Failed to broadcast update" });
        return result;
      };

      fn.batchInvalidate = async (params: any, request: RPCRequest) => { // INFO: just do not broadcast
        const [parsed, parsedError] = await tryCatch(this.validateParams('query', name, params));
        if (parsedError) throw new HTTPException(400, { message: parsedError.message });
        const [result, error] = await tryCatch(def.query(parsed, request));
        if (error) throw error;
        const channel = getRpcChannelName(name, parsed);
        const [, errorBroadcast] = await tryCatch(options.socket.broadcast(channel, 'update', result));
        if (errorBroadcast) throw new HTTPException(500, { message: "Failed to broadcast update" });
        return { result, channel };
      }

      (this.queries as any)[name] = fn;
    }

    for (const [name, def] of Object.entries(mutations) as [string, MutationDef<any, any, any>][]) {
      const fn = async (params: any, request: RPCRequest, withAuth = true) => {
        const [parsed, parsedError] = await tryCatch(this.validateParams('mutation', name, params));
        if (parsedError) throw new HTTPException(400, { message: parsedError.message });
        if (withAuth && def.authorization) {
          const [result, error] = await tryCatch(def.authorization(parsed, request));
          if (error) throw new HTTPException(401, { message: "Unauthorized" });
        }
        const [result, error] = await tryCatch(def.mutation(parsed, request));
        if (error) throw error;

        Promise.all(def.invalidateQueries ?
          Object.entries(def.invalidateQueries).map(async ([queryName, invalidateParamsFn]) => {
            if (!invalidateParamsFn) return Promise.resolve();
            const [queryParams, queryParamsError] = await tryCatch(invalidateParamsFn(parsed, result)) as [z.infer<any>, Error | null];
            if (queryParamsError) throw new HTTPException(500, { message: "Failed to invalidate query" });

            if (Array.isArray(queryParams)) {
              let allSuccess = true;
              const broadcasts: ({
                success: false,
                channel: null,
                result: null
              } | {
                success: true,
                channel: string,
                result: any
              })[] = await Promise.all(queryParams.map(async (queryParam) => {
                const [data, error] = await tryCatch(this.queries[queryName].batchInvalidate(queryParam, request));
                if (error) {
                  allSuccess = false;
                  return { success: false, channel: null, result: null };
                }
                return { success: true, channel: data.channel, result: data.result };
              }));

              // filter out the unsuccessfull broadcasts and group by maxBatchSize
              // meaning we are creating an array of arrays, each containing up to maxBatchSize broadcasts
              const toBroadcast = broadcasts.filter(
                broadcast => broadcast.success && broadcast.channel !== null
              ).reduce((acc, broadcast) => {
                if (acc.length === 0) {
                  acc.push([]);
                }
                acc[acc.length - 1].push({
                  channel: broadcast.channel,
                  name: "update",
                  data: broadcast.result
                });
                return acc;
              }, [] as { channel: string, name: string, data: any }[][]);

              // broadcast each array of broadcasts
              let allBroadcastSuccess = true;
              await Promise.all(toBroadcast.map(async (broadcastBatch) => {
                const [, error] = await tryCatch(options.socket.batchBroadcast(broadcastBatch));
                if (error) {
                  allBroadcastSuccess = false;
                }
              }));

              if (!allSuccess) throw new HTTPException(500, { message: "Failed to invalidate some queries" });
              if (!allBroadcastSuccess) throw new HTTPException(500, { message: "Failed to broadcast some updates" });
              return { success: true };
            }

            const [data, error] = await tryCatch(this.queries[queryName].invalidate(queryParams, request));
            if (error) throw error;
            return { success: true };
          })
          : []
        );
        return result;
      };

      (this.mutations as any)[name] = fn;
    }

    // Replace config with the built one for internal use
    this.options.config = builtConfig;
  }

  private validateParams(type: 'query' | 'mutation', key: string, params: any) {
    const def = type === 'query' ? this.config.queries[key] as QueryDef<any, any> : this.config.mutations[key] as MutationDef<any, any, any>;
    if (!def) {
      throw new HTTPException(400, { message: `Unknown ${type}: ${key}` });
    }
    const { success, data, error } = def.params.safeParse(params);
    if (!success || error) {
      throw new HTTPException(400, { message: error.message ?? 'Invalid params' });
    }
    return data;
  }

  public async handleRequest(c: Context): Promise<any> {
    const url = new URL(c.req.url);
    const pathname = url.pathname;

    const isQuery = pathname.endsWith('/rpc/query');
    const isMutation = pathname.endsWith('/rpc/mutation');

    if (!isQuery && !isMutation) {
      return;
    }

    const body = await c.req.json();
    const { key, params } = body;

    if (isQuery) {
      const queryFn = this.queries[key];
      if (!queryFn) {
        throw new HTTPException(400, { message: `Unknown query type: ${key}` });
      }
      const [result, error] = await tryCatch(queryFn(params, c));
      if (error) throw error;
      const channel = getRpcChannelName(key, params);
      return c.json({ data: result, channel, error: null });
    }

    if (isMutation) {
      const mutationFn = this.mutations[key];
      if (!mutationFn) {
        throw new HTTPException(400, { message: `Unknown mutation: ${key}` });
      }

      const [result, error] = await tryCatch(mutationFn(params, c));

      if (error) throw error;

      return c.json({ success: true, data: result ?? undefined, error: null });
    }

    return c.json({ error: 'Request not valid' }, 400);
  }
}