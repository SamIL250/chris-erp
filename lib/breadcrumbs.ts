export interface Crumb {
  label: string;
  href?: string;
}

const SETTINGS_PAGES: Record<string, string> = {
  "/settings/company": "Company",
  "/settings/currencies": "Currencies",
  "/settings/tax": "Tax",
  "/settings/sequences": "Document numbering",
  "/settings/formatting": "Formatting",
  "/settings/audit": "Audit log",
  "/settings/profile": "Profile",
};

/**
 * Trail for an admin path. A single top-level page (Dashboard, Sales, …)
 * returns nothing — there is nowhere above it to go. `pageLabel` fills the
 * product name on the editor and the variants page.
 */
export function crumbsForPath(pathname: string, pageLabel?: string): Crumb[] {
  const catalog = { label: "Catalog", href: "/catalog" };
  const products = { label: "Products", href: "/catalog/products" };

  if (pathname === "/catalog/categories") return [catalog, { label: "Categories" }];
  if (pathname === "/catalog/attributes") return [catalog, { label: "Attributes" }];
  if (pathname === "/catalog/products") return [catalog, { label: "Products" }];

  if (pathname === "/catalog/products/new") {
    return [
      catalog,
      products,
      { label: pageLabel && pageLabel !== "" ? pageLabel : "New product" },
    ];
  }

  const variants = pathname.match(/^\/catalog\/products\/([^/]+)\/variants$/);
  if (variants) {
    const id = variants[1];
    return [
      catalog,
      products,
      {
        label: pageLabel && pageLabel !== "" ? pageLabel : "Product",
        href: `/catalog/products/${id}`,
      },
      { label: "Variants" },
    ];
  }

  const product = pathname.match(/^\/catalog\/products\/([^/]+)$/);
  if (product && product[1] !== "new") {
    return [catalog, products, { label: pageLabel && pageLabel !== "" ? pageLabel : "Product" }];
  }

  const inventory = { label: "Inventory", href: "/inventory" };
  if (pathname === "/inventory/stock") return [inventory, { label: "Stock" }];
  if (pathname === "/inventory/warehouses") return [inventory, { label: "Warehouses" }];
  if (pathname === "/inventory/adjustments") return [inventory, { label: "Adjustments" }];
  if (pathname === "/inventory/receipts") return [inventory, { label: "Receipts" }];
  if (pathname === "/inventory/receipts/new") {
    return [
      inventory,
      { label: "Receipts", href: "/inventory/receipts" },
      { label: "New receipt" },
    ];
  }
  const receipt = pathname.match(/^\/inventory\/receipts\/([^/]+)$/);
  if (receipt && receipt[1] !== "new") {
    return [
      inventory,
      { label: "Receipts", href: "/inventory/receipts" },
      { label: pageLabel && pageLabel !== "" ? pageLabel : "Receipt" },
    ];
  }
  if (pathname === "/inventory/transfers") return [inventory, { label: "Transfers" }];
  if (pathname === "/inventory/transfers/new") {
    return [
      inventory,
      { label: "Transfers", href: "/inventory/transfers" },
      { label: "New transfer" },
    ];
  }
  const transfer = pathname.match(/^\/inventory\/transfers\/([^/]+)$/);
  if (transfer && transfer[1] !== "new") {
    return [
      inventory,
      { label: "Transfers", href: "/inventory/transfers" },
      { label: pageLabel && pageLabel !== "" ? pageLabel : "Transfer" },
    ];
  }
  const stockProduct = pathname.match(/^\/inventory\/stock\/([^/]+)$/);
  if (stockProduct) {
    return [
      inventory,
      { label: "Stock", href: "/inventory/stock" },
      { label: pageLabel && pageLabel !== "" ? pageLabel : "Product" },
    ];
  }

  const settings = SETTINGS_PAGES[pathname];
  if (settings) return [{ label: "Settings" }, { label: settings }];

  if (pathname === "/users") return [{ label: "Settings" }, { label: "Users" }];

  return [];
}
