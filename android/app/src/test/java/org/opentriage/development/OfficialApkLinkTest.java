package org.opentriage.development;

import static org.junit.Assert.*;
import org.junit.Test;

public class OfficialApkLinkTest {
    private static final String PREFIX="https://github.com/open-triage/open-triage-epcr/releases/download/";
    private static final String HASH="ab".repeat(32);
    private String link(String tag,String version,String code,String hash){return PREFIX+tag+"/opentriage-"+version+"-"+code+"-"+hash+".apk";}
    @Test public void versionOnlyNamesRetainExactRepositoryAndTagBinding() {
        for(String tag:new String[]{"android-v6-0.1.0-rc.6","android-candidate-6-0.1.0-rc.6"}){
            String value=PREFIX+tag+"/opentriage-0.1.0-rc.6.apk";
            assertEquals(value,OfficialApkLink.approved(value).toString());
            for(String invalid:new String[]{value.replace("github.com","attacker.invalid"),value+"?download=1",value.replace("/opentriage-0.1.0-rc.6.apk","/opentriage-0.1.0-rc.7.apk"),value.replace("opentriage-0.1.0-rc.6.apk","opentriage-0.1.0-rc.6-6.apk"),value.replace("android-v6-","android-v06-").replace("android-candidate-6-","android-candidate-06-")})assertNull(OfficialApkLink.approved(invalid));
        }
    }
    @Test public void onlyExactPinnedRepositoryAndCanonicalReleaseMetadataCanOpen() {
        for(String tag:new String[]{"android-v2-0.1.0-rc.2","android-candidate-2-0.1.0-rc.2"}) {
            String value=link(tag,"0.1.0-rc.2","2",HASH);assertEquals(value,OfficialApkLink.approved(value).toString());
        }
        String valid=link("android-candidate-2-0.1.0-rc.2","0.1.0-rc.2","2",HASH);
        for(String value:new String[]{null,"",valid.replace("https:","http:"),valid.replace("github.com","attacker.invalid"),valid.replace("github.com","github.com.attacker.invalid"),
                valid.replace("github.com","person@github.com"),valid.replace("github.com","github.com:443"),valid.replace("open-triage/open-triage-epcr","other/repository"),
                valid+"?download=1",valid+"#fragment",valid.replace("download/","download/%2e%2e/"),valid.replace("opentriage-","%6fpentriage-"),valid.replace(".apk",".apk/extra"),
                link("android-candidate-3-0.1.0-rc.2","0.1.0-rc.2","2",HASH),link("android-candidate-2-0.1.1","0.1.0-rc.2","2",HASH),
                link("android-candidate-02-0.1.0-rc.2","0.1.0-rc.2","02",HASH),link("android-v2100000001-1.0.0","1.0.0","2100000001",HASH),
                link("android-v2-1.0.0","1.0.0","2",HASH.toUpperCase()),link("android-v2-1.0.0","1.0.0","2",HASH.substring(1)),
                "https://github.com/open-triage/open-triage-epcr/issues/798","javascript:alert(1)","file:///data/private.apk"})assertNull("Rejected noncanonical release URL",OfficialApkLink.approved(value));
    }
}
