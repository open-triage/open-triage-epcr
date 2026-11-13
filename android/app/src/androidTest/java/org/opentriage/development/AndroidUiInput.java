package org.opentriage.development;

import static org.junit.Assert.assertEquals;
import org.json.JSONObject;

/** Follow actual control readiness before delivering a synthetic file selection. */
final class AndroidUiInput {
    @FunctionalInterface interface Evaluate { String run(String script) throws Exception; }
    @FunctionalInterface interface WaitFor { void until(String expression) throws Exception; }

    static void clickEnabled(Evaluate evaluate, WaitFor waitFor, String expression) throws Exception {
        String ready = "(()=>{const button=(" + expression + ");return Boolean(button && button.isConnected && button.offsetParent!==null && !button.matches(':disabled') && button.getAttribute('aria-disabled')!=='true');})()";
        waitFor.until(ready);
        assertEquals("Click delivery must use the current visible enabled control", "true", evaluate.run(
            "(()=>{const button=(" + expression + ");if(!button || !button.isConnected || button.offsetParent===null || button.matches(':disabled') || button.getAttribute('aria-disabled')==='true')return false;button.click();return true;})()"));
    }

    /** Current APKs review the admin name; historical APKs still require client input. */
    static void installationName(Evaluate evaluate, WaitFor waitFor, String legacyName) throws Exception {
        String input = "document.querySelector(\"input[maxlength='100']\")";
        waitFor.until(input + " && !(" + input + ").matches(':disabled')");
        boolean assigned = "true".equals(evaluate.run("(" + input + ").readOnly"));
        if (assigned) {
            assertEquals("The administrator name must be present", "true", evaluate.run("Boolean((" + input + ").value.trim())"));
        } else {
            assertEquals("Historical APK name entry remains supported", "true", evaluate.run(WebViewTestInput.change(input, legacyName)));
        }
    }

    static void importPairing(Evaluate evaluate, WaitFor waitFor, String artifact) throws Exception {
        String input = "document.querySelector('input[type=file]')";
        waitFor.until(input + " && !(" + input + ").matches(':disabled')");
        assertEquals("Pairing file delivery must use the current enabled control", "true", evaluate.run(
            "(()=>{const input=" + input + ";if(!input || input.matches(':disabled'))return false;"
            + "const files=new DataTransfer();files.items.add(new File([" + JSONObject.quote(artifact)
            + "],'pairing.json',{type:'application/json'}));input.files=files.files;"
            + "input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()"));
    }
}
