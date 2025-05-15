type Result<T, E = Error> = [T, null] | [null, E];

/** 
 * Use this to wrap a function call to catch errors
 * @example
 * const [data, error] = await tryCatch(fetch("https://api.example.com/data"));
 * if (error) {
 *   console.error(error);
 * }
 */
export async function tryCatch<T, E = Error>(
  value: T | Promise<T>,
): Promise<Result<T, E>> {
  try {
    const data = await value;
    return [data, null];
  } catch (error) {
    return [null, error as E];
  }
}

/**
 * Use this to wrap a function to catch errors, like a predefined function you know may throw an error.
 * @example
 * const myFunction = tryWrapper(async (input: string) => {
 *   return input;
 * });
 * const [data, error] = await myFunction("test");
 * if (error) {
 *   console.error(error);
 * }
 * @example
 * const myErrorTypedFunction = tryWrapper<MyReturnType, [MyInputType1, ...], MyErrorType>(async (input1: MyInputType1, ...) => {
 *   // ...
 * });
 */
// biome-ignore lint/suspicious/noExplicitAny: <explanation>
export function tryWrapper<T, Args extends any[], E = Error>(func: (...args: Args) => Promise<T>) {
  return async (...args: Args): Promise<Result<T, E>> => {
    try {
      const data = await func(...args);
      return [data, null];
    } catch (error) {
      return [null, error as E];
    }
  };
}