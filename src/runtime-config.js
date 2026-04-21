function getInstagramRuntimeConfig({ store, config }) {
  const saved = store.getInstagramRuntimeConfig({
    igSessionId: config.igSessionId,
    igProxyUrl: config.igProxyUrl,
  });

  return {
    ...config,
    igSessionId: saved.igSessionId || null,
    igProxyUrl: saved.igProxyUrl || null,
  };
}

function getInstagramRuntimeConfigSummary({ store, config }) {
  const runtime = getInstagramRuntimeConfig({ store, config });
  return {
    hasSessionId: Boolean(runtime.igSessionId),
    sessionIdPreview: runtime.igSessionId
      ? `${runtime.igSessionId.slice(0, 6)}...${runtime.igSessionId.slice(-4)}`
      : null,
    proxyUrl: runtime.igProxyUrl || "",
  };
}

module.exports = {
  getInstagramRuntimeConfig,
  getInstagramRuntimeConfigSummary,
};
