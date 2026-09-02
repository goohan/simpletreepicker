// A stand-in for `azure-devops-extension-sdk`, used only by `npm run preview`.
//
// It fakes the host handshake and the work item form service against an
// in-memory field. Only the host is fake: the tree building, the rendering, the
// event wiring and the read/write cycle against the field are the real paths.
//
// The control runs inside a REAL iframe here, which matters more than it
// sounds. Height is negotiated by postMessage to the parent, exactly as the
// host does it, so the frame clips and measures the way it will in production.
// The earlier harness ran the control loose in the page, and that is precisely
// why a measurement bug — reading the frame it was trying to size — survived
// local testing and had to be found in Azure DevOps.

import theme from "./ado-theme-light.json";

const FIELD_NAME = "Custom.Demo";

const DEMO_PATHS = [
  "Administration",
  "Commercial",
  "Development",
  "Development\\EDocuments",
  "Development\\Erp",
  "Development\\ErpCloud",
  "Development\\Licensing",
  "Development\\Salesforce",
  "Development\\SalesforceCloud",
  "Support",
  "Support\\Consulting",
  "Support\\Implementations",
  "Deep\\Branch\\With\\Several\\Levels\\To\\Test\\Scrolling",
];

const field = { value: "Development\\Salesforce" };
let observer = null;

/**
 * What the fake form knows about the field's state, toggled from the harness.
 * `ruleLocked` plays the rule the real host never announces: the write is
 * TAKEN, then the field shows up as invalid — exactly the behavior the control
 * has to detect and undo. `committed` is the value the form considers saved,
 * so a locked write can be told apart from the value it displaced.
 */
const formState = { readOnly: false, ruleLocked: false, required: false, committed: field.value };

/** Everything the harness page shows goes through here. */
function report(event, detail) {
  parent.postMessage({ source: "stp-preview", event, detail, value: field.value }, "*");
}

const formService = {
  async getFieldValue(name) {
    report("getFieldValue", name);
    return field.value;
  },
  async setFieldValue(name, value) {
    field.value = value;
    report("setFieldValue", `${name} = ${JSON.stringify(value)}`);
  },
  async getAllowedFieldValues(name) {
    report("getAllowedFieldValues", name);
    return DEMO_PATHS;
  },
  async isReadOnly() {
    report("isReadOnly", String(formState.readOnly));
    return formState.readOnly;
  },
  async getFields(names) {
    report("getFields", JSON.stringify(names));
    return [{ referenceName: FIELD_NAME, name: "Demo", readOnly: false }];
  },
  async getInvalidFields() {
    const invalid = [];
    if (formState.required && !field.value) invalid.push({ referenceName: FIELD_NAME });
    if (formState.ruleLocked && field.value !== formState.committed) invalid.push({ referenceName: FIELD_NAME });
    report("getInvalidFields", invalid.length ? FIELD_NAME : "(none)");
    return invalid;
  },
};

/**
 * The dialog surface is deliberately NOT simulated. Its real risk is whether
 * the host behaves as the code assumes — where the close handle lives, whether
 * XDM proxies the pick callback — and a stub built on those same assumptions
 * would only confirm them to itself. Better to say so out loud than to hand
 * over a green light that means nothing.
 */
const layoutService = {
  openCustomDialog() {
    report("openCustomDialog", "NOT SIMULATED — verify the dialog style in Azure DevOps");
    parent.postMessage({ source: "stp-preview", event: "dialog-unavailable" }, "*");
  },
};

/**
 * Injects the real Azure DevOps design tokens, captured from a live work item
 * form (dev/ado-theme-light.json), the same way the SDK does on handshake:
 * one style element defining them on :root, plus the body color rule the SDK
 * pins itself. That makes the harness show the control in ADO's actual colors
 * instead of approximations.
 */
function applyCapturedTheme() {
  const declarations = Object.entries(theme)
    .map(([name, value]) => `${name}: ${value}`)
    .join("; ");
  const style = document.createElement("style");
  style.textContent = `:root { ${declarations} } body { color: var(--text-primary-color) }`;
  document.head.appendChild(style);
}

export async function init() {
  applyCapturedTheme();
  report("init", "handshake + theme applied");
}

export async function ready() {}

export async function notifyLoadSucceeded() {
  report("notifyLoadSucceeded", "control is up");
}

export async function notifyLoadFailed(error) {
  report("notifyLoadFailed", String(error?.message ?? error));
}

export function getConfiguration() {
  const params = new URLSearchParams(location.search);
  return {
    witInputs: {
      FieldName: FIELD_NAME,
      Paths: "",
      PickerStyle: params.get("style") === "dialog" ? "dialog" : "inline",
    },
  };
}

export function getContributionId() {
  return "preview.simple-tree-picker-control";
}

export function getExtensionContext() {
  return { id: "goohan.simpletreepicker", publisherId: "goohan", extensionId: "simpletreepicker" };
}

export async function getService(contributionId) {
  return contributionId === "ms.vss-features.host-page-layout-service" ? layoutService : formService;
}

export function register(id, instance) {
  observer = typeof instance === "function" ? instance() : instance;
  report("register", id);
}

export function unregister() {
  observer = null;
}

/** The host owns the frame's height; here the parent page plays that part. */
export function resize(width, height) {
  report("resize", `height = ${height}px`);
  parent.postMessage({ source: "stp-preview", event: "resize", height }, "*");
}

// Lets the harness poke the control the way the form would.
window.addEventListener("message", (message) => {
  if (message.data?.source !== "stp-harness") return;
  const { command, value } = message.data;
  if (command === "set-value") {
    field.value = value;
    observer?.onFieldChanged?.({ changedFields: { [FIELD_NAME]: value } });
  }
  if (command === "refresh") observer?.onRefreshed?.();
  // The host's side of the three states. A read-only work item arrives with a
  // refresh; the two rule-driven states arrive the way rules do — riding on a
  // change to ANOTHER field, State here.
  if (command === "toggle-readonly") {
    formState.readOnly = !formState.readOnly;
    report("host", `work item read-only = ${formState.readOnly}`);
    observer?.onRefreshed?.();
  }
  if (command === "toggle-rule-lock") {
    formState.ruleLocked = !formState.ruleLocked;
    formState.committed = field.value;
    report("host", `rule locks the field = ${formState.ruleLocked}`);
    observer?.onFieldChanged?.({ changedFields: { "System.State": "Escalated" } });
  }
  if (command === "toggle-required") {
    formState.required = !formState.required;
    report("host", `rule requires the field = ${formState.required}`);
    observer?.onFieldChanged?.({ changedFields: { "System.State": "Escalated" } });
  }
});
