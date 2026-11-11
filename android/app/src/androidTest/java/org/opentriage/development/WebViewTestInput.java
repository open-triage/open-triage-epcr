package org.opentriage.development;

import org.json.JSONObject;

/** Match ordinary control interaction, including clinical fields committed on blur. */
final class WebViewTestInput {
    static String change(String expression,String value) {
        return "(()=>{const input="+expression+";if(!input||input.matches(':disabled')||input.readOnly)return false;input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,"+JSONObject.quote(value)+");input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.blur();return true;})()";
    }
}
