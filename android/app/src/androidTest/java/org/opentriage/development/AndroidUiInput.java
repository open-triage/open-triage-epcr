package org.opentriage.development;

import static org.junit.Assert.assertEquals;
import org.json.JSONObject;

/** Follow actual control readiness before delivering a synthetic file selection. */
final class AndroidUiInput {
    @FunctionalInterface interface Evaluate { String run(String script) throws Exception; }
    @FunctionalInterface interface WaitFor { void until(String expression) throws Exception; }

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
