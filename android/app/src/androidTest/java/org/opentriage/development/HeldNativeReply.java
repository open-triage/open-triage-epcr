package org.opentriage.development;

import androidx.test.platform.app.InstrumentationRegistry;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

final class HeldNativeReply {
    static String install(String method) throws IOException {
        var assets = InstrumentationRegistry.getInstrumentation().getContext().getAssets();
        try (var script = assets.open("hold-native-reply.js")) {
            return new String(script.readAllBytes(), StandardCharsets.UTF_8) + "(" + JSONObject.quote(method) + ")";
        }
    }
}
