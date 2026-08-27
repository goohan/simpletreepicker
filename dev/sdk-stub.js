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

export async function init() {
  report("init", "handshake");
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
});
