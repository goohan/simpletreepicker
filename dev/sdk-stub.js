// A stand-in for `azure-devops-extension-sdk`, used only by `npm run preview`.
//
// It fakes the host handshake and the work item form service against an
// in-memory field, so the control can be driven in a plain browser. Only the
// host is fake: the tree building, the rendering, the event wiring and the
// read/write cycle against the field are the real code paths.

const FIELD_NAME = "Custom.Demo";

const DEMO_PATHS = [
  "ErpCloud",
  "ErpCloud\\Web App",
  "ErpCloud\\Web App\\Treasury",
  "ErpCloud\\Web App\\Inventory",
  "ErpCloud\\Web App\\Sales",
  "ErpCloud\\Ventapp\\Sales",
  "EDocuments",
  "Salesforce",
  "Global\\Very\\Deep\\Branch\\To\\Test\\Scrolling",
];

const field = { value: "ErpCloud\\Web App\\Treasury" };
let observer = null;

/** The panel the preview page renders beside the control. */
function report(event, detail) {
  window.dispatchEvent(new CustomEvent("stp-preview", { detail: { event, detail, value: field.value } }));
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
  return { witInputs: { FieldName: FIELD_NAME, Paths: "" } };
}

export function getContributionId() {
  return "preview.simple-tree-picker-control";
}

export async function getService() {
  return formService;
}

export function register(id, instance) {
  observer = typeof instance === "function" ? instance() : instance;
  report("register", id);
}

export function unregister() {
  observer = null;
}

export function resize(width, height) {
  report("resize", `height = ${height}px`);
  document.documentElement.style.setProperty("--preview-height", `${height}px`);
}

// Exposed so the preview page can poke the control the way the form would.
window.__stpPreview = {
  get value() {
    return field.value;
  },
  set value(next) {
    field.value = next;
    observer?.onFieldChanged?.({ changedFields: { [FIELD_NAME]: next } });
  },
  refresh: () => observer?.onRefreshed?.(),
  reset: () => observer?.onReset?.(),
};
