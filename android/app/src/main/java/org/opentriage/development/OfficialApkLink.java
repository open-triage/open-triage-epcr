package org.opentriage.development;

import java.net.URI;
import java.util.regex.Pattern;

/** Public release downloads only; callers never transfer installation credentials or trust. */
final class OfficialApkLink {
    private static final String PREFIX="/open-triage/open-triage-epcr/releases/download/";
    private static final Pattern FILE=Pattern.compile("opentriage-([0-9]+\\.[0-9]+\\.[0-9]+(?:-[A-Za-z0-9.-]+)?)-([1-9][0-9]{0,9})-([a-f0-9]{64})\\.apk");
    static URI approved(String value) {
        if(value==null||value.length()>2048)return null;
        try {
            URI uri=URI.create(value);
            if(!"https".equals(uri.getScheme())||!"github.com".equals(uri.getRawAuthority())||uri.getRawUserInfo()!=null
                    ||uri.getPort()!=-1||uri.getRawQuery()!=null||uri.getRawFragment()!=null||!value.equals(uri.toASCIIString()))return null;
            String path=uri.getRawPath();if(path==null||!path.startsWith(PREFIX)||path.contains("%"))return null;
            String[] parts=path.substring(PREFIX.length()).split("/",-1);if(parts.length!=2)return null;
            var file=FILE.matcher(parts[1]);if(!file.matches())return null;
            String version=file.group(1),code=file.group(2);if(version.length()>100||Long.parseLong(code)>2100000000L)return null;
            if(!parts[0].equals("android-v"+code+"-"+version)&&!parts[0].equals("android-candidate-"+code+"-"+version))return null;
            return uri;
        }catch(IllegalArgumentException invalid){return null;}
    }
}
