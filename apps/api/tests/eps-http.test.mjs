import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { EpsController } from '../dist/hospital/eps.controller.js';
import { EpsService } from '../dist/hospital/eps.service.js';
import { EpsImportService } from '../dist/hospital/eps-import.service.js';

test('EPS context is JSON for both inactive and active integrations over HTTP', async () => {
  const reportId = '00000000-0000-4000-8000-000000000001';
  let context = null;
  class FixtureModule {}
  Module({controllers: [EpsController], providers: [
    {provide: EpsService, useValue: {context: async (token, id) => {
      assert.equal(token, 'fixture-token');
      assert.equal(id, reportId);
      return context;
    }}},
    {provide: EpsImportService, useValue: {}},
  ]})(FixtureModule);
  const app = await NestFactory.create(FixtureModule, {logger: false});
  try {
    await app.listen(0, '127.0.0.1');
    const url = `${await app.getUrl()}/reports/${reportId}/eps/context`;
    for (const value of [null, {reportId, binding: 'fixture-binding'}]) {
      context = value;
      const response = await fetch(url, {headers: {authorization: 'Bearer fixture-token'}});
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /application\/json/);
      assert.equal(response.headers.get('cache-control'), 'no-store, private');
      assert.deepEqual(await response.json(), value);
    }
    assert.equal((await fetch(url)).status, 401);
  } finally { await app.close(); }
});
