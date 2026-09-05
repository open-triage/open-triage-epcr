import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DialogValidationMessage } from "../components/dialog-validation-message";

test("dialog validation renders the selected finding as an inline alert", () => {
  const html = renderToStaticMarkup(createElement(DialogValidationMessage, {
    finding: { severity: "warning", message: "Confirm this picker value." },
  }));
  assert.match(html, /dialog-validation-message/);
  assert.match(html, /role="alert"/);
  assert.match(html, /Warning:<\/strong> Confirm this picker value\./);
});
