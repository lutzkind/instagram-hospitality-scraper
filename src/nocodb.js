function createNocoDbService({ store, config }) {
  return {
    getConfig() {
      return store.getNocoDbConfig(config.nocoDb);
    },
    saveConfig(input) {
      return store.saveNocoDbConfig(input, config.nocoDb);
    },
    async testConnection(input = null) {
      const merged = {
        ...store.getNocoDbConfig(config.nocoDb),
        ...(input || {}),
      };

      if (!merged.baseUrl || !merged.apiToken || !merged.baseId || !merged.tableId) {
        return {
          ok: false,
          enabled: false,
          message: "NocoDB is not configured.",
        };
      }

      return {
        ok: true,
        enabled: true,
        message: "Configuration saved. Sync is not implemented in v1.",
      };
    },
    getJobSyncStatus(jobId) {
      return {
        enabled: Boolean(store.getNocoDbConfig(config.nocoDb).baseUrl),
        jobId,
        lastStatus: "idle",
        lastMessage: "NocoDB sync is not implemented in v1.",
        syncedRecordCount: 0,
        unsyncedLeadCount: store.countJobLeadsAfterId(jobId, 0),
      };
    },
    async syncJob(jobId) {
      return {
        ok: false,
        jobId,
        message: "NocoDB sync is not implemented in v1.",
        sync: this.getJobSyncStatus(jobId),
      };
    },
  };
}

module.exports = { createNocoDbService };
