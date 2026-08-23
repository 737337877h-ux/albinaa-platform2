'use strict';

class OracleReadPool {
  constructor(oracledb, config) {
    this.driver = oracledb;
    this.config = config;
    this.pool = null;
  }

  async start() {
    this.driver.initOracleClient({ libDir: this.config.clientLibDir });
    this.driver.outFormat = this.driver.OUT_FORMAT_OBJECT;
    this.pool = await this.driver.createPool({
      user: this.config.user,
      password: this.config.password,
      connectString: this.config.connectString,
      poolMin: this.config.poolMin,
      poolMax: this.config.poolMax,
      poolIncrement: this.config.poolIncrement,
      queueTimeout: this.config.queueTimeout,
    });
    const identity = await this.select("SELECT SYS_CONTEXT('USERENV', 'SESSION_USER') AS SESSION_USER FROM DUAL");
    if (identity.rows[0]?.SESSION_USER !== 'ALBINAA_RO') {
      await this.close();
      throw new Error('Oracle session is not ALBINAA_RO');
    }
  }

  async select(sql, binds = {}) {
    if (!/^\s*(SELECT|WITH)\b/i.test(sql) || /;/.test(sql)) {
      throw new Error('Oracle Read API rejected a non-SELECT statement');
    }
    if (!this.pool) throw new Error('Oracle pool is not started');
    const connection = await this.pool.getConnection();
    try {
      connection.callTimeout = this.config.queryTimeout;
      return await connection.execute(sql, binds, { outFormat: this.driver.OUT_FORMAT_OBJECT });
    } finally {
      await connection.rollback();
      await connection.close();
    }
  }

  async close() {
    if (this.pool) await this.pool.close(10);
    this.pool = null;
  }
}

module.exports = { OracleReadPool };
