/**
 * Public surface of @ccc/api-types.
 *
 * Everything here is either a re-export of, or a type derived from,
 * `./generated.ts` - which is produced by `npm run generate:types` from the
 * Django-Ninja OpenAPI schema. No API shape is ever hand-written in this repo.
 */

export type { $defs, components, operations, paths, webhooks } from "./generated";

import type { components, operations, paths } from "./generated";

/** All paths exposed by the API, keyed by URL. */
export type ApiPaths = paths;

/** All named schemas from the OpenAPI `components.schemas` block. */
export type ApiSchemas = components["schemas"];

/** All operations, keyed by their OpenAPI `operationId`. */
export type ApiOperations = operations;

/** Look up a generated schema by its OpenAPI name, e.g. `Schema<"HealthOut">`. */
export type Schema<TName extends keyof ApiSchemas> = ApiSchemas[TName];

/**
 * The JSON body of an operation's 200 response, e.g.
 * `OperationResponse<"config_api_health">`.
 */
export type OperationResponse<TOperation extends keyof ApiOperations> =
  ApiOperations[TOperation] extends {
    responses: { 200: { content: { "application/json": infer TBody } } };
  }
    ? TBody
    : never;

/**
 * The JSON request body of an operation, or `never` when it takes none.
 */
export type OperationRequestBody<TOperation extends keyof ApiOperations> =
  ApiOperations[TOperation] extends {
    requestBody: { content: { "application/json": infer TBody } };
  }
    ? TBody
    : never;
