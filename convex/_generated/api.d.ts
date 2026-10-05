/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as _lib_audit from "../_lib/audit.js";
import type * as _lib_notifications from "../_lib/notifications.js";
import type * as _lib_permissions from "../_lib/permissions.js";
import type * as _lib_sequences from "../_lib/sequences.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as authProviders from "../authProviders.js";
import type * as authSessions from "../authSessions.js";
import type * as currencies from "../currencies.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as invites from "../invites.js";
import type * as notifications from "../notifications.js";
import type * as organization from "../organization.js";
import type * as roles from "../roles.js";
import type * as sequences from "../sequences.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "_lib/audit": typeof _lib_audit;
  "_lib/notifications": typeof _lib_notifications;
  "_lib/permissions": typeof _lib_permissions;
  "_lib/sequences": typeof _lib_sequences;
  audit: typeof audit;
  auth: typeof auth;
  authProviders: typeof authProviders;
  authSessions: typeof authSessions;
  currencies: typeof currencies;
  files: typeof files;
  http: typeof http;
  invites: typeof invites;
  notifications: typeof notifications;
  organization: typeof organization;
  roles: typeof roles;
  sequences: typeof sequences;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
