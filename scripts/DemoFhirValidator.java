import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import org.hl7.fhir.services.renderers.RendererFactory;
import org.hl7.fhir.standalone.terminology.client.TerminologyClientContext;
import org.hl7.fhir.utilities.TimeTracker;
import org.hl7.fhir.validation.service.ValidationService;
import org.hl7.fhir.validation.service.ValidatorWatchMode;
import org.hl7.fhir.validation.service.ValidateSourceParameters;
import org.hl7.fhir.validation.service.WatchParameters;
import org.hl7.fhir.validation.service.model.InstanceValidatorParameters;
import org.hl7.fhir.validation.service.model.ValidationEngineParameters;

// One private pipe connects this long-lived HL7 engine to its owning API process.
class DemoFhirValidator {
    public static void main(String[] args) throws Exception {
        ProcessHandle.current().parent().ifPresent(parent ->
            parent.onExit().thenRun(() -> Runtime.getRuntime().halt(0)));
        PrintStream replies = System.out;
        String prefix = args[3];
        System.setOut(System.err);
        TerminologyClientContext.setCanUseCacheId(true);
        var service = new ValidationService(new RendererFactory());
        var settings = new ValidationEngineParameters().setSv("4.0.1").setIgs(List.of(args[0]))
            .setTxServer(args[1]).setNoEcosystem(true);
        var parameters = new InstanceValidatorParameters();
        var watch = new WatchParameters(ValidatorWatchMode.NONE, 0, 0);
        var engine = service.initializeValidator(settings, parameters, "hl7.fhir.r4.core#4.0.1",
            new TimeTracker(), List.of());
        service.validateSources(engine, new ValidateSourceParameters(parameters, List.of(args[2]), null, watch));
        replies.println(prefix + "READY");
        var requests = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        for (String directory; (directory = requests.readLine()) != null;) {
            var dir = Path.of(directory);
            var job = new ValidateSourceParameters(parameters, List.of(dir.resolve("bundle.json").toString()),
                dir.resolve("outcome.json").toString(), watch);
            try {
                service.validateSources(engine, job);
                replies.println(prefix + "DONE");
            } catch (Exception e) {
                replies.println(prefix + "FAILED");
            }
        }
    }
}
