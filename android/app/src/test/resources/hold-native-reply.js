(function holdNativeReply(targetMethod) {
  const bridge = window.Capacitor;
  const send = bridge.nativePromise.bind(bridge);
  bridge.nativePromise = (plugin, method, options) => {
    const reply = send(plugin, method, options);
    if (plugin !== "OpenTriageConnection" || method !== targetMethod) return reply;
    return reply.then(() => {
      window.__heldNativeReply = method;
      return new Promise(() => {});
    });
  };
})
