import type { Role } from "./element.js";

const IOS_ROLES: Record<string, Role> = {
  button: "button",
  xcuielementtypebutton: "button",
  key: "button",
  textfield: "textfield",
  securetextfield: "textfield",
  searchfield: "textfield",
  textview: "textfield",
  xcuielementtypetextfield: "textfield",
  xcuielementtypesecuretextfield: "textfield",
  xcuielementtypesearchfield: "textfield",
  statictext: "text",
  xcuielementtypestatictext: "text",
  switch: "toggle",
  toggle: "toggle",
  checkbox: "toggle",
  xcuielementtypeswitch: "toggle",
  cell: "cell",
  xcuielementtypecell: "cell",
  link: "link",
  xcuielementtypelink: "link",
  image: "image",
  xcuielementtypeimage: "image",
  tab: "tab",
  tabbar: "tab",
  radiobutton: "tab",
  xcuielementtypetabbar: "tab",
  table: "list",
  collectionview: "list",
  list: "list",
  xcuielementtypetable: "list",
  xcuielementtypecollectionview: "list",
};

const ANDROID_ROLES: Record<string, Role> = {
  "android.widget.button": "button",
  "android.widget.imagebutton": "button",
  "android.widget.edittext": "textfield",
  "android.widget.autocompletetextview": "textfield",
  "android.widget.textview": "text",
  "android.widget.switch": "toggle",
  "android.widget.switchcompat": "toggle",
  "androidx.appcompat.widget.switchcompat": "toggle",
  "android.widget.checkbox": "toggle",
  "android.widget.togglebutton": "toggle",
  "android.widget.imageview": "image",
  "android.widget.listview": "list",
  "androidx.recyclerview.widget.recyclerview": "list",
  "android.widget.tabwidget": "tab",
  "android.widget.horizontalscrollview": "tab",
};

const WEB_ROLES: Record<string, Role> = {
  button: "button",
  textbox: "textfield",
  searchbox: "textfield",
  textarea: "textfield",
  input: "textfield",
  paragraph: "text",
  heading: "text",
  text: "text",
  label: "text",
  switch: "toggle",
  checkbox: "toggle",
  listitem: "cell",
  cell: "cell",
  link: "link",
  image: "image",
  img: "image",
  tab: "tab",
  list: "list",
};

export function mapIosRole(type?: string, role?: string, roleDescription?: string): Role | undefined {
  return lookup(IOS_ROLES, type, roleDescription, role);
}

export function mapAndroidRole(className?: string, contentRole?: string): Role | undefined {
  const mapped = lookup(ANDROID_ROLES, className);
  if (mapped) return mapped;
  if (contentRole) return lookup(WEB_ROLES, contentRole);
  if (className?.toLowerCase().includes("button")) return "button";
  if (className?.toLowerCase().includes("edit")) return "textfield";
  if (className?.toLowerCase().includes("text")) return "text";
  if (className?.toLowerCase().includes("switch") || className?.toLowerCase().includes("check")) {
    return "toggle";
  }
  if (className?.toLowerCase().includes("image")) return "image";
  if (className?.toLowerCase().includes("tab")) return "tab";
  return undefined;
}

export function mapWebRole(role?: string, tag?: string, type?: string): Role | undefined {
  if (role) {
    const mapped = lookup(WEB_ROLES, role);
    if (mapped) return mapped;
  }
  const t = (tag ?? "").toLowerCase();
  if (t === "button") return "button";
  if (t === "a") return "link";
  if (t === "input") {
    const inputType = (type ?? "text").toLowerCase();
    if (["checkbox", "radio"].includes(inputType)) return "toggle";
    if (["button", "submit", "reset"].includes(inputType)) return "button";
    return "textfield";
  }
  if (t === "textarea") return "textfield";
  if (t === "select") return "button";
  if (["p", "span", "h1", "h2", "h3", "h4", "h5", "h6", "label"].includes(t)) return "text";
  if (t === "img") return "image";
  if (t === "li") return "cell";
  if (["ul", "ol"].includes(t)) return "list";
  return lookup(WEB_ROLES, t);
}

function lookup(table: Record<string, Role>, ...values: Array<string | undefined>): Role | undefined {
  for (const value of values) {
    if (!value) continue;
    const key = value.toLowerCase().replace(/[^a-z0-9.]+/g, "");
    if (table[key]) return table[key];
    const stripped = key.replace(/^ax/, "");
    if (table[stripped]) return table[stripped];
  }
  return undefined;
}
