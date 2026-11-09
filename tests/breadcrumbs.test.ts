import { describe, expect, it } from "vitest";
import { crumbsForPath } from "../lib/breadcrumbs";

const labels = (path: string, pageLabel?: string) =>
  crumbsForPath(path, pageLabel).map((item) => item.label);

describe("crumbsForPath", () => {
  it("skips top-level pages", () => {
    expect(crumbsForPath("/dashboard")).toEqual([]);
    expect(crumbsForPath("/finance")).toEqual([]);
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
    expect(labels("/sales")).toEqual(["Desk"]);
    expect(labels("/sales/customers")).toEqual(["Sales", "Customers"]);
    expect(labels("/sales/customers/new")).toEqual(["Sales", "Customers", "New customer"]);
    expect(labels("/sales/customers/abc", "Acme Clinic")).toEqual([
      "Sales",
      "Customers",
      "Acme Clinic",
    ]);
    expect(crumbsForPath("/sales/customers/abc", "Acme Clinic")[1]?.href).toBe("/sales/customers");
    expect(labels("/sales/quotes")).toEqual(["Sales", "Quotes"]);
    expect(labels("/sales/quotes/new")).toEqual(["Sales", "Quotes", "New quote"]);
    expect(labels("/sales/quotes/abc", "QT-0001")).toEqual(["Sales", "Quotes", "QT-0001"]);
    expect(crumbsForPath("/sales/quotes/abc", "QT-0001")[1]?.href).toBe("/sales/quotes");
    expect(labels("/sales/orders")).toEqual(["Sales", "Orders"]);
    expect(labels("/sales/orders/abc", "SO-0001")).toEqual(["Sales", "Orders", "SO-0001"]);
    expect(labels("/sales/deliveries")).toEqual(["Sales", "Deliveries"]);
    expect(labels("/sales/invoices")).toEqual(["Sales", "Invoices"]);
    expect(labels("/sales/credit-notes")).toEqual(["Sales", "Credit notes"]);
    expect(labels("/sales/credit-notes/abc", "CR-0001")).toEqual([
      "Sales",
      "Credit notes",
      "CR-0001",
    ]);
    expect(crumbsForPath("/sales/credit-notes/abc", "CR-0001")[1]?.href).toBe(
      "/sales/credit-notes",
    );
    expect(labels("/sales/returns")).toEqual(["Sales", "Returns"]);
    expect(labels("/sales/returns/abc", "RMA-0001")).toEqual(["Sales", "Returns", "RMA-0001"]);
    expect(crumbsForPath("/sales/returns/abc", "RMA-0001")[1]?.href).toBe("/sales/returns");
    expect(labels("/sales/invoices/abc", "INV-0001")).toEqual(["Sales", "Invoices", "INV-0001"]);
    expect(crumbsForPath("/sales/invoices/abc", "INV-0001")[1]?.href).toBe("/sales/invoices");
    expect(labels("/sales/deliveries/abc", "DN-0001")).toEqual(["Sales", "Deliveries", "DN-0001"]);
    expect(crumbsForPath("/sales/deliveries/abc", "DN-0001")[1]?.href).toBe("/sales/deliveries");
    expect(labels("/sales/prices")).toEqual(["Sales", "Prices"]);
    expect(labels("/sales/prices/abc", "Standard")).toEqual(["Sales", "Prices", "Standard"]);
    expect(crumbsForPath("/sales/prices/abc", "Standard")[1]?.href).toBe("/sales/prices");
    expect(labels("/sales/customer-groups")).toEqual(["Sales", "Customer groups"]);
    expect(labels("/sales/customer-groups/abc", "Wholesale")).toEqual([
      "Sales",
      "Customer groups",
      "Wholesale",
    ]);
    expect(crumbsForPath("/sales/customer-groups/abc", "Wholesale")[1]?.href).toBe(
      "/sales/customer-groups",
    );
    expect(labels("/procurement")).toEqual(["Desk"]);
    expect(labels("/procurement/vendors")).toEqual(["Procurement", "Vendors"]);
    expect(labels("/procurement/vendors/new")).toEqual(["Procurement", "Vendors", "New vendor"]);
    expect(labels("/procurement/vendors/abc", "Med Supply")).toEqual([
      "Procurement",
      "Vendors",
      "Med Supply",
    ]);
    expect(crumbsForPath("/procurement/vendors/abc", "Med Supply")[1]?.href).toBe(
      "/procurement/vendors",
    );
    expect(labels("/procurement/requisitions")).toEqual(["Procurement", "Requisitions"]);
    expect(labels("/procurement/requisitions/new")).toEqual([
      "Procurement",
      "Requisitions",
      "New requisition",
    ]);
    expect(labels("/procurement/requisitions/abc", "REQ-0001")).toEqual([
      "Procurement",
      "Requisitions",
      "REQ-0001",
    ]);
    expect(labels("/procurement/purchase-orders")).toEqual(["Procurement", "Purchase orders"]);
    expect(labels("/procurement/purchase-orders/abc", "PO-0001")).toEqual([
      "Procurement",
      "Purchase orders",
      "PO-0001",
    ]);
    expect(labels("/procurement/bills")).toEqual(["Procurement", "Bills"]);
    expect(labels("/procurement/bills/new")).toEqual(["Procurement", "Bills", "New bill"]);
    expect(labels("/procurement/bills/abc", "BILL-0001")).toEqual([
      "Procurement",
      "Bills",
      "BILL-0001",
    ]);
    expect(labels("/procurement/returns")).toEqual(["Procurement", "Vendor returns"]);
    expect(labels("/procurement/returns/new")).toEqual([
      "Procurement",
      "Vendor returns",
      "New return",
    ]);
    expect(labels("/procurement/returns/abc", "DBN-0001")).toEqual([
      "Procurement",
      "Vendor returns",
      "DBN-0001",
    ]);
    expect(labels("/settings/sequences")).toEqual(["Settings", "Document numbering"]);
    expect(labels("/users")).toEqual(["Settings", "Users"]);
    expect(crumbsForPath("/users")[0]?.href).toBeUndefined();
  });
});
