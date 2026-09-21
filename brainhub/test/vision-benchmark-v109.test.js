'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const market=require('../market');
const {syntheticVisionCases,parseBenchmarkLabel}=require('../vision-benchmark');

test('synthetic Vision benchmark exposes BOS sweep and FVG fixtures as renderable 896x504 charts',()=>{
  const cases=syntheticVisionCases();
  assert.deepEqual(cases.map(x=>x.id),['BOS_UP','SWEEP_RECLAIM','BULL_FVG']);
  for(const c of cases){
    assert.equal(c.chart.candles.length,64);
    const png=market.renderChartPng(c.chart,'annotated',{outputWidth:896,outputHeight:504});
    assert.equal(png.slice(1,4).toString('ascii'),'PNG');
    assert.ok(png.length>1000);
  }
});

test('Vision benchmark label parser is strict and reports only known synthetic classes',()=>{
  assert.equal(parseBenchmarkLabel('PATTERN: BOS_UP'),'BOS_UP');
  assert.equal(parseBenchmarkLabel('PATTERN: SWEEP_RECLAIM'),'SWEEP_RECLAIM');
  assert.equal(parseBenchmarkLabel('PATTERN: BULL_FVG'),'BULL_FVG');
  assert.equal(parseBenchmarkLabel('PATTERN: LONG'),'null'.replace('null','')||null);
});
