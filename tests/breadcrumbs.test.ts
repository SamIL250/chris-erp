import { describe, expect, it } from "vitest";
import { crumbsForPath } from "../lib/breadcrumbs";

const labels = (path: string, pageLabel?: string) =>
  crumbsForPath(path, pageLabel).map((item) => item.label);

describe("crumbsForPath", () => {
  it("skips top-level pages", () => {
    expect(crumbsForPath("/dashboard")).toEqual([]);
    expect(crumbsForPath("/sales")).toEqual([]);
  });

  it("trails catalog lists back to Catalog", () => {
    expect(labels("/catalog/products")).toEqual(["Catalog", "Products"]);
    expect(labels("/catalog/categories")).toEqual(["Catalog", "Categories"]);
    expect(labels("/catalog/attributes")).toEqual(["Catalog", "Attributes"]);
    expect(crumbsForPath("/catalog/products")[0]?.href).toBe("/catalog");
  });

  it("names the product on the editor and links back from variants", () => {
    expect(labels("/catalog/products/new")).toEqual(["Catalog", "Products", "New product"]);
    expect(labels("/catalog/products/new", "Ultrasound Gel 5L")).toEqual([
      "Catalog",
      "Products",
      "Ultrasound Gel 5L",
    ]);
    expect(labels("/catalog/products/abc")).toEqual(["Catalog", "Products", "Product"]);
    expect(labels("/catalog/products/abc", "Ultrasound Gel 5L")).toEqual([
      "Catalog",
      "Products",
      "Ultrasound Gel 5L",
    ]);
    const variants = crumbsForPath("/catalog/products/abc/variants", "Ultrasound Gel 5L");
    expect(variants.map((item) => item.label)).toEqual([
      "Catalog",
      "Products",
      "Ultrasound Gel 5L",
      "Variants",
    ]);
    expect(variants[1]?.href).toBe("/catalog/products");
    expect(variants[2]?.href).toBe("/catalog/products/abc");
    expect(variants[3]?.href).toBeUndefined();
  });

  it("trails inventory and settings", () => {
    expect(labels("/inventory/stock")).toEqual(["Inventory", "Stock"]);
    expect(labels("/inventory/warehouses")).toEqual(["Inventory", "Warehouses"]);
    expect(labels("/inventory/transfers")).toEqual(["Inventory", "Transfers"]);
    expect(labels("/inventory/transfers/new")).toEqual(["Inventory", "Transfers", "New transfer"]);
    expect(labels("/inventory/transfers/abc", "TR-0001")).toEqual([
      "Inventory",
      "Transfers",
      "TR-0001",
    ]);
    expect(crumbsForPath("/inventory/transfers/abc", "TR-0001")[1]?.href).toBe(
      "/inventory/transfers",
    );
    expect(labels("/inventory/stock/abc", "Ultrasound Gel 5L")).toEqual([
      "Inventory",
      "Stock",
      "Ultrasound Gel 5L",
    ]);
    expect(labels("/inventory/adjustments")).toEqual(["Inventory", "Adjustments"]);
    expect(labels("/inventory/receipts/new")).toEqual(["Inventory", "Receipts", "New receipt"]);
    expect(labels("/settings/sequences")).toEqual(["Settings", "Document numbering"]);
    expect(labels("/users")).toEqual(["Settings", "Users"]);
    expect(crumbsForPath("/users")[0]?.href).toBeUndefined();
  });
});
