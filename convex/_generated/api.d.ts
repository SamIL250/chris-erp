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
import type * as _lib_fileUrl from "../_lib/fileUrl.js";
import type * as _lib_invites from "../_lib/invites.js";
import type * as _lib_notifications from "../_lib/notifications.js";
import type * as _lib_permissions from "../_lib/permissions.js";
import type * as _lib_productCategories from "../_lib/productCategories.js";
import type * as _lib_sequences from "../_lib/sequences.js";
import type * as _lib_slugs from "../_lib/slugs.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as authProviders from "../authProviders.js";
import type * as authSessions from "../authSessions.js";
import type * as catalog_attributeSets from "../catalog/attributeSets.js";
import type * as catalog_attributes from "../catalog/attributes.js";
import type * as catalog_categories from "../catalog/categories.js";
import type * as catalog_products from "../catalog/products.js";
import type * as catalog_variants from "../catalog/variants.js";
import type * as crons from "../crons.js";
import type * as currencies from "../currencies.js";
import type * as files from "../files.js";
import type * as formatting from "../formatting.js";
import type * as http from "../http.js";
import type * as inventory_goodsReceipts from "../inventory/goodsReceipts.js";
import type * as inventory_lowStock from "../inventory/lowStock.js";
import type * as inventory_reorderPoints from "../inventory/reorderPoints.js";
import type * as inventory_stock from "../inventory/stock.js";
import type * as inventory_transfers from "../inventory/transfers.js";
import type * as inventory_warehouses from "../inventory/warehouses.js";
import type * as invites from "../invites.js";
import type * as notifications from "../notifications.js";
import type * as organization from "../organization.js";
import type * as roles from "../roles.js";
import type * as seed from "../seed.js";
import type * as sequences from "../sequences.js";
import type * as tax from "../tax.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "_lib/audit": typeof _lib_audit;
  "_lib/fileUrl": typeof _lib_fileUrl;
  "_lib/invites": typeof _lib_invites;
  "_lib/notifications": typeof _lib_notifications;
  "_lib/permissions": typeof _lib_permissions;
  "_lib/productCategories": typeof _lib_productCategories;
  "_lib/sequences": typeof _lib_sequences;
  "_lib/slugs": typeof _lib_slugs;
  audit: typeof audit;
  auth: typeof auth;
  authProviders: typeof authProviders;
  authSessions: typeof authSessions;
  "catalog/attributeSets": typeof catalog_attributeSets;
  "catalog/attributes": typeof catalog_attributes;
  "catalog/categories": typeof catalog_categories;
  "catalog/products": typeof catalog_products;
  "catalog/variants": typeof catalog_variants;
  crons: typeof crons;
  currencies: typeof currencies;
  files: typeof files;
  formatting: typeof formatting;
  http: typeof http;
  "inventory/goodsReceipts": typeof inventory_goodsReceipts;
  "inventory/lowStock": typeof inventory_lowStock;
  "inventory/reorderPoints": typeof inventory_reorderPoints;
  "inventory/stock": typeof inventory_stock;
  "inventory/transfers": typeof inventory_transfers;
  "inventory/warehouses": typeof inventory_warehouses;
  invites: typeof invites;
  notifications: typeof notifications;
  organization: typeof organization;
  roles: typeof roles;
  seed: typeof seed;
  sequences: typeof sequences;
  tax: typeof tax;
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
