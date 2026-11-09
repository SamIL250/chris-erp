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

  const sales = { label: "Sales", href: "/sales" };
  if (pathname === "/sales") return [{ label: "Desk" }];
  if (pathname === "/sales/customers") return [sales, { label: "Customers" }];
  if (pathname === "/sales/customers/new") {
    return [sales, { label: "Customers", href: "/sales/customers" }, { label: "New customer" }];
  }
  if (pathname === "/sales/quotes") return [sales, { label: "Quotes" }];
  if (pathname === "/sales/quotes/new") {
    return [sales, { label: "Quotes", href: "/sales/quotes" }, { label: "New quote" }];
  }
  const quote = pathname.match(/^\/sales\/quotes\/([^/]+)$/);
  if (quote && quote[1] !== "new") {
    return [
      sales,
      { label: "Quotes", href: "/sales/quotes" },
      { label: pageLabel && pageLabel !== "" ? pageLabel : "Quote" },
    ];
  }
  if (pathname === "/sales/orders") return [sales, { label: "Orders" }];
  if (pathname === "/sales/deliveries") return [sales, { label: "Deliveries" }];
  if (pathname === "/sales/invoices") return [sales, { label: "Invoices" }];
  if (pathname === "/sales/credit-notes") return [sales, { label: "Credit notes" }];
  if (pathname === "/sales/returns") return [sales, { label: "Returns" }];
  const salesReturn = pathname.match(/^\/sales\/returns\/([^/]+)$/);
  if (salesReturn) {
    return [
      sales,
      { label: "Returns", href: "/sales/returns" },
      { label: pageLabel && pageLabel !== "" ? pageLabel : "Return" },
    ];
  }
  const credit = pathname.match(/^\/sales\/credit-notes\/([^/]+)$/);
  if (credit) {
    return [
      sales,
      { label: "Credit notes", href: "/sales/credit-notes" },
      { label: pageLabel && pageLabel !== "" ? pageLabel : "Credit note" },
    ];
  }
  const invoice = pathname.match(/^\/sales\/invoices\/([^/]+)$/);
  if (invoice) {
    return [
      sales,
      { label: "Invoices", href: "/sales/invoices" },
      { label: pageLabel && pageLabel !== "" ? pageLabel : "Invoice" },
    ];
  }
  const delivery = pathname.match(/^\/sales\/deliveries\/([^/]+)$/);
  if (delivery) {
    return [
      sales,
      { label: "Deliveries", href: "/sales/deliveries" },
      { label: pageLabel && pageLabel !== "" ? pageLabel : "Delivery" },
    ];
  }
  const order = pathname.match(/^\/sales\/orders\/([^/]+)$/);
  if (order) {
    return [
      sales,
      { label: "Orders", href: "/sales/orders" },
      { label: pageLabel && pageLabel !== "" ? pageLabel : "Order" },
    ];
  }
  if (pathname === "/sales/prices") return [sales, { label: "Prices" }];
  const priceList = pathname.match(/^\/sales\/prices\/([^/]+)$/);
  if (priceList) {
    return [
      sales,
      { label: "Prices", href: "/sales/prices" },
      { label: pageLabel && pageLabel !== "" ? pageLabel : "Price list" },
    ];
  }
  if (pathname === "/sales/customer-groups") return [sales, { label: "Customer groups" }];
  const customerGroup = pathname.match(/^\/sales\/customer-groups\/([^/]+)$/);
  if (customerGroup) {
    return [
      sales,
      { label: "Customer groups", href: "/sales/customer-groups" },
      { label: pageLabel && pageLabel !== "" ? pageLabel : "Customer group" },
    ];
  }
  const customer = pathname.match(/^\/sales\/customers\/([^/]+)$/);
  if (customer && customer[1] !== "new") {
    return [
      sales,
      { label: "Customers", href: "/sales/customers" },
      { label: pageLabel && pageLabel !== "" ? pageLabel : "Customer" },
    ];
  }

  if (pathname === "/procurement") return [{ label: "Desk" }];
  const procurement = { label: "Procurement", href: "/procurement" };
  if (pathname === "/procurement/vendors") return [procurement, { label: "Vendors" }];
  if (pathname === "/procurement/vendors/new") {
    return [
      procurement,
      { label: "Vendors", href: "/procurement/vendors" },
      { label: "New vendor" },
    ];
  }
  const vendor = pathname.match(/^\/procurement\/vendors\/([^/]+)$/);
  if (vendor && vendor[1] !== "new") {
    return [
      procurement,
      { label: "Vendors", href: "/procurement/vendors" },
      { label: pageLabel && pageLabel !== "" ? pageLabel : "Vendor" },
    ];
  }
  if (pathname === "/procurement/requisitions") {
    return [procurement, { label: "Requisitions" }];
  }
  if (pathname === "/procurement/requisitions/new") {
    return [
      procurement,
      { label: "Requisitions", href: "/procurement/requisitions" },
      { label: "New requisition" },
    ];
  }
  const requisition = pathname.match(/^\/procurement\/requisitions\/([^/]+)$/);
  if (requisition && requisition[1] !== "new") {
    return [
      procurement,
      { label: "Requisitions", href: "/procurement/requisitions" },
      { label: pageLabel && pageLabel !== "" ? pageLabel : "Requisition" },
    ];
  }
  if (pathname === "/procurement/purchase-orders") {
    return [procurement, { label: "Purchase orders" }];
  }
  const purchaseOrder = pathname.match(/^\/procurement\/purchase-orders\/([^/]+)$/);
  if (purchaseOrder) {
    return [
      procurement,
      { label: "Purchase orders", href: "/procurement/purchase-orders" },
      { label: pageLabel && pageLabel !== "" ? pageLabel : "Purchase order" },
    ];
  }
  if (pathname === "/procurement/bills") return [procurement, { label: "Bills" }];
  if (pathname === "/procurement/bills/new") {
    return [procurement, { label: "Bills", href: "/procurement/bills" }, { label: "New bill" }];
  }
  const vendorBill = pathname.match(/^\/procurement\/bills\/([^/]+)$/);
  if (vendorBill && vendorBill[1] !== "new") {
    return [
      procurement,
      { label: "Bills", href: "/procurement/bills" },
      { label: pageLabel && pageLabel !== "" ? pageLabel : "Bill" },
    ];
  }
  if (pathname === "/procurement/returns") return [procurement, { label: "Vendor returns" }];
  if (pathname === "/procurement/returns/new") {
    return [
      procurement,
      { label: "Vendor returns", href: "/procurement/returns" },
      { label: "New return" },
    ];
  }
  const purchaseReturn = pathname.match(/^\/procurement\/returns\/([^/]+)$/);
  if (purchaseReturn && purchaseReturn[1] !== "new") {
    return [
      procurement,
      { label: "Vendor returns", href: "/procurement/returns" },
      { label: pageLabel && pageLabel !== "" ? pageLabel : "Return" },
    ];
  }

  const settings = SETTINGS_PAGES[pathname];
  if (settings) return [{ label: "Settings" }, { label: settings }];

  if (pathname === "/users") return [{ label: "Settings" }, { label: "Users" }];

  return [];
}
