import type { z } from "zod";
import type { QueryDef, MutationDef } from "./live-rpc-builder-class"; // your server-side types
import { useQuery as useReactQuery, useMutation as useReactMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getRpcChannelName } from "./get-rpc-channel";

type ExtractQueries<T extends { queries: unknown }> = T["queries"];
type ExtractMutations<T extends { mutations: unknown }> = T["mutations"];

export type ClientQuery<
  TConfig extends { queries: any },
  K extends keyof ExtractQueries<TConfig>
> = {
  key: K;
  input: Parameters<ExtractQueries<TConfig>[K]["query"]>[0];
  output: Awaited<ReturnType<ExtractQueries<TConfig>[K]["query"]>>;
};

type InputOfQuery<T> = T extends QueryDef<infer Schema, any>
  ? z.infer<Schema>
  : never;

type OutputOfQuery<T> = T extends QueryDef<any, infer Result>
  ? Result
  : never;

type InputOfMutation<T> = T extends MutationDef<infer Schema, any, any>
  ? z.infer<Schema>
  : never;

type OutputOfMutation<T> = T extends MutationDef<any, infer Result, any>
  ? Result
  : never;

/**
 * Create the client side of the LiveRPC
 * @param config - The config for the LiveRPC
 * @returns The client side of the LiveRPC
 * @example
 * ``` js
 * const { useQuery, useMutation, useLiveQuery } = createClientLiveRPC({
 *   url: "http://localhost:8000", // backend url
 *   basePath: "/rpc", // backend path to the rpc endpoint
 *   socketFn: (channelName, eventName, callback) => {
 *     // subscribe to the channel and listen for events (pusher but could be socket.io for instance)
 *     const channel = pusher.subscribe(channelName)
 *     channel.bind(eventName, callback)
 *     return () => { channel.unbind(eventName); pusher.unsubscribe(channelName) }
 *   }
 * })
 * ```
 */
export function createClientLiveRPC<TConfig extends {
  queries: Record<string, QueryDef<any, any>>;
  mutations: Record<string, MutationDef<any, any, any>>;
}>({
  url,
  basePath = "/rpc",
  socketFn
}: {
  /** The url to the backend */
  url: string,
  /** The base path to the rpc endpoint on the backend (default: "/rpc") */
  basePath?: string,
  /**
   * The function to subscribe to the channel, listen for events, and cleanup when the component unmounts
   * @param channelName - The name of the channel to subscribe to
   * @param eventName - The name of the event to listen for
   * @param callback - The callback to call when the event is received
   * @returns A cleanup function to unsubscribe from the channel and unbind the event
   * 
   * @example For a pusher client, this might look like:
    * ``` js
    * const pusher = new Pusher(...);
    * const socketFn = async (channelName, eventName, callback) => {
    *   const channel = pusher.subscribe(channelName)
    *   channel.bind(eventName, callback)
    *   return () => { channel.unbind(eventName); pusher.unsubscribe(channelName) }
    * }
    * ```
    */
  socketFn: (
    channelName: string,
    eventName: string,
    callback: (payload: any) => void
  ) => (() => void)
}) {
  async function callRPC<
    TKind extends "query" | "mutation",
    TKey extends TKind extends "query"
    ? keyof TConfig["queries"]
    : keyof TConfig["mutations"]
  >(
    kind: TKind,
    key: TKey,
    params: TKind extends "query"
      ? InputOfQuery<TConfig["queries"][Extract<TKey, keyof TConfig["queries"]>]>
      : InputOfMutation<TConfig["mutations"][Extract<TKey, keyof TConfig["mutations"]>]>
  ): Promise<
    TKind extends "query"
    ? OutputOfQuery<TConfig["queries"][Extract<TKey, keyof TConfig["queries"]>]>
    : OutputOfMutation<TConfig["mutations"][Extract<TKey, keyof TConfig["mutations"]>]>
  > {
    const res = await fetch(`${url}${basePath}/${kind}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
      },
      body: JSON.stringify({ key, params }),
    });
    if (!res.ok) {
      console.error(res);
      throw new Error(`${kind} failed`);
    }
    const result = await res.json();
    if (result.error) {
      throw new Error(result.error);
    }
    return result;
  }

  function useQuery<TKey extends keyof TConfig["queries"]>(
    key: TKey,
    params: InputOfQuery<TConfig["queries"][TKey]>
  ) {
    return useReactQuery<OutputOfQuery<TConfig["queries"][TKey]>>({
      queryKey: [key, params],
      queryFn: () => callRPC("query", key, params)
    });
  }

  function useMutation<TKey extends keyof TConfig["mutations"]>(
    key: TKey,
  ) {
    type Input = InputOfMutation<TConfig["mutations"][TKey]>;
    type Output = OutputOfMutation<TConfig["mutations"][TKey]>;

    return useReactMutation<Output, Error, Input>({
      mutationKey: [key],
      mutationFn: async (params: Input) => {
        const result = await callRPC("mutation", key, params);
        // @ts-ignore
        if (result.error || !result.success) {
          // @ts-ignore
          throw new Error(result.error ?? " An error occured");
        }
        // @ts-ignore
        return result.data;
      },
    });
  }

  function useLiveQuery<TKey extends keyof TConfig["queries"]>(
    key: TKey,
    params: InputOfQuery<TConfig["queries"][TKey]>
  ) {
    const [data, setData] = useState<OutputOfQuery<TConfig["queries"][TKey]>>();
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
    useEffect(() => {
      const channel = getRpcChannelName(key as string, params);

      callRPC("query", key, params)
        .then(async (initialData: any) => {
          setData(initialData.data);
          setIsLoading(false);
        })
        .catch((err) => {
          setError(err);
          setIsLoading(false);
        });

      const unsub = socketFn(channel, "update", (payload) => {
        setData(payload);
      });

      return () => unsub?.();
    }, [key, JSON.stringify(params)]);

    return { data, isLoading, error };
  }

  return {
    useQuery,
    useLiveQuery,
    useMutation
  };
}