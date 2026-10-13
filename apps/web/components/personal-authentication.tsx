"use client";
import { createContext,useContext } from "react";
import { resolveMessage } from "../app/localization";
export const PersonalAuthenticationContext=createContext<"local"|"oidc">("local");
export function usePasswordAuthentication(){return useContext(PersonalAuthenticationContext)!=="oidc";}
/** Shared sensitive-action control, driven by the server-authenticated session. */
export function PersonalAuthenticationField({language,value,onChange,label}:{language:string;value:string;onChange:(value:string)=>void;label?:string}){
 const password=usePasswordAuthentication();
 return password?<label>{label??resolveMessage(language,"login.password")}<input type="password" autoComplete="current-password" maxLength={1024} required value={value} onChange={event=>onChange(event.target.value)}/></label>
  :<p role="note">{resolveMessage(language,"login.regionalReauthentication")}</p>;
}
