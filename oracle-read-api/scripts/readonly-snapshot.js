'use strict';

// Dedicated, bounded, consistent snapshot. Never use a writer or legacy YS login.
class ReadonlySnapshot {
  constructor(driver, config) { this.driver = driver; this.config = config; this.connection = null; }
  async start() {
    if (this.config.user !== 'ALBINAA_RO') throw new Error('Snapshot requires ALBINAA_RO');
    this.driver.initOracleClient({ libDir: this.config.clientLibDir });
    // Oracle document serials exceed JavaScript's safe integer range.
    this.driver.fetchAsString = [this.driver.NUMBER];
    const connectString = this.config.connectString.replace(/\(DESCRIPTION\s*=/i,
      '(DESCRIPTION=(CONNECT_TIMEOUT=15)(TRANSPORT_CONNECT_TIMEOUT=5)(RETRY_COUNT=0)');
    this.connection = await this.driver.getConnection({ user: this.config.user, password: this.config.password, connectString });
    this.connection.callTimeout = 120000;
    await this.connection.execute('SET TRANSACTION READ ONLY');
    const identity = await this.select("SELECT SYS_CONTEXT('USERENV','SESSION_USER') SESSION_USER FROM DUAL");
    if (identity.rows[0]?.SESSION_USER !== 'ALBINAA_RO') {
      await this.close();
      throw new Error('Unexpected Oracle snapshot session');
    }
  }
  select(sql, binds = {}) {
    if (!/^\s*SELECT\b/i.test(sql) || /;|\b(NEXTVAL|INSERT|UPDATE|DELETE|MERGE|EXECUTE|ALTER|DROP|CREATE)\b/i.test(sql)) {
      throw new Error('Snapshot accepts SELECT only');
    }
    return this.connection.execute(sql, binds, { outFormat: this.driver.OUT_FORMAT_OBJECT, fetchArraySize: 1000 });
  }
  async close() {
    if (this.connection) {
      try { await this.connection.rollback(); } finally { await this.connection.close(); this.connection = null; }
    }
  }
}
module.exports = { ReadonlySnapshot };
