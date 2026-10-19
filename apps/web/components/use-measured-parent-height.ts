'use client';
import {useCallback, type RefObject} from 'react';

/** Attach measurement to the DOM node's lifetime, including conditional mounts. */
export function useMeasuredParentHeight(ref:RefObject<HTMLElement|null>,property:string) {
 return useCallback((element:HTMLElement|null)=>{
  ref.current=element;
  const parent=element?.parentElement;
  if(!element||!parent)return;
  const measure=()=>parent.style.setProperty(property,`${element.getBoundingClientRect().height}px`);
  measure();
  const observer=new ResizeObserver(measure);
  observer.observe(element);
  return ()=>{observer.disconnect();parent.style.removeProperty(property);if(ref.current===element)ref.current=null;};
 },[ref,property]);
}
