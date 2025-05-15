// live-rpc-builder-class.ts

import type { z, ZodTypeAny } from "zod";
import type { Context } from "hono";

export type RPCRequest = Context<any, any, any>;

export type QueryDef<
  TSchema extends ZodTypeAny,
  TResult
> = {
  params: TSchema;
  query: (params: z.infer<TSchema>, req?: RPCRequest) => Promise<TResult>;
  authorization?: (params: z.infer<TSchema>, req?: RPCRequest) => Promise<boolean>;
};

export type MutationDef<
  TSchema extends ZodTypeAny,
  TResult,
  TQueries extends Record<string, QueryDef<any, any>>
> = {
  params: TSchema;
  mutation: (params: z.infer<TSchema>, req?: RPCRequest) => Promise<TResult>;
  authorization?: (params: z.infer<TSchema>, req?: RPCRequest) => Promise<boolean>;
  invalidateQueries?: {
    [K in keyof TQueries]?: (
      params: z.infer<TSchema>,
      result: TResult
    ) => Promise<Parameters<TQueries[K]["query"]>[0] | Array<Parameters<TQueries[K]["query"]>[0]>>;
  };
};

export type RPCConfig<
  TQueries extends Record<string, QueryDef<any, any>>,
  TMutations extends Record<string, MutationDef<any, any, TQueries>>
> = {
  queries: TQueries;
  mutations: TMutations;
};

/**
 * Build the LiveRPC config
 * @example
 * ```js
 * const rpc = new LiveRPCBuilder()
 *   .addQuery('getUsers', {
 *     params: z.undefined(),
 *     query: async (params, request) => {
 *       return await db.query.users.findMany(); // your own db
 *     }
 *   })
 *   .addMutation('createUser', {
 *     params: z.object({
 *       name: z.string(),
 *     }),
 *     mutation: async (params, request) => {
 *       return await db.mutation.users.create({ data: params }); // your own db
 *     }
 * ```
 */
export class LiveRPCBuilder<
  // biome-ignore lint/complexity/noBannedTypes: {} is ok
  TQueries extends Record<string, QueryDef<any, any>> = {},
  // biome-ignore lint/complexity/noBannedTypes: {} is ok
  TMutations extends Record<string, MutationDef<any, any, TQueries>> = {}
> {
  public queries: TQueries;
  public mutations: TMutations;

  constructor(
    queries: TQueries = {} as TQueries,
    mutations: TMutations = {} as TMutations
  ) {
    this.queries = queries;
    this.mutations = mutations;
  }

  addQuery<
    K extends string,
    Schema extends ZodTypeAny,
    R = any
  >(
    key: K,
    def: {
      params: Schema;
      query: (params: z.infer<Schema>, req?: RPCRequest) => Promise<R>;
      authorization?: (params: z.infer<Schema>, req?: RPCRequest) => Promise<boolean>;
    }
  ): LiveRPCBuilder<
    TQueries & { [k in K]: QueryDef<Schema, R> },
    TMutations
  > {
    return new LiveRPCBuilder(
      { ...this.queries, [key]: def } as TQueries & { [k in K]: QueryDef<Schema, R> },
      this.mutations
    );
  }

  addMutation<
    K extends string,
    Schema extends ZodTypeAny,
    R = any
  >(
    key: K,
    def: {
      params: Schema;
      mutation: (params: z.infer<Schema>, req?: RPCRequest) => Promise<R>;
      authorization?: (params: z.infer<Schema>, req?: RPCRequest) => Promise<boolean>;
      invalidateQueries?: {
        [Q in keyof TQueries]?: (
          params: z.infer<Schema>,
          result: R
        ) => Promise<Parameters<TQueries[Q]["query"]>[0] | Array<Parameters<TQueries[Q]["query"]>[0]>>;
      };
    }
  ): LiveRPCBuilder<
    TQueries,
    TMutations & { [k in K]: MutationDef<Schema, R, TQueries> }
  > {
    return new LiveRPCBuilder(
      this.queries,
      { ...this.mutations, [key]: def } as TMutations & { [k in K]: MutationDef<Schema, R, TQueries> }
    );
  }

  merge<
    Q2 extends Record<string, QueryDef<any, any>>,
    M2 extends Record<string, MutationDef<any, any, Q2>>
  >(
    other: LiveRPCBuilder<Q2, M2>
  ): LiveRPCBuilder<
    TQueries & Q2,
    TMutations & M2
  > {
    return new LiveRPCBuilder(
      { ...this.queries, ...other.queries } as TQueries & Q2,
      { ...this.mutations, ...other.mutations } as TMutations & M2
    );
  }

  build(): RPCConfig<TQueries, TMutations> {
    return {
      queries: this.queries,
      mutations: this.mutations,
    };
  }
}
