import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeListAnswer, normalizeExpected } from './componentUtils.js'

void test('normalizeListAnswer returns empty string for empty input', () => {
  assert.equal(normalizeListAnswer(''), '')
  assert.equal(normalizeListAnswer('   '), '')
})

void test('normalizeListAnswer removes brackets and normalizes spacing', () => {
  assert.equal(normalizeListAnswer('[hello,world]'), 'hello,world')
  assert.equal(normalizeListAnswer('[ hello , world ]'), 'hello,world')
  assert.equal(normalizeListAnswer('[1,2,3]'), '1,2,3')
})

void test('normalizeListAnswer removes quoted strings', () => {
  assert.equal(normalizeListAnswer("['hello','world']"), 'hello,world')
  assert.equal(normalizeListAnswer('["hello","world"]'), 'hello,world')
  assert.equal(normalizeListAnswer("['hello', 'world']"), 'hello,world')
})

void test('normalizeListAnswer filters empty tokens', () => {
  assert.equal(normalizeListAnswer('[,,hello,,world,,]'), 'hello,world')
  assert.equal(normalizeListAnswer('[ , , hello , , world , , ]'), 'hello,world')
})

void test('normalizeExpected handles null/undefined challenge', () => {
  assert.equal(normalizeExpected(null), '')
  assert.equal(normalizeExpected(undefined), '')
})

void test('normalizeExpected formats list type challenges', () => {
  const listChallenge = { type: 'list' as const, expected: '[a,b,c]' }
  assert.equal(normalizeExpected(listChallenge), 'a,b,c')

  const listChallenge2 = { type: 'list' as const, expected: "['x', 'y', 'z']" }
  assert.equal(normalizeExpected(listChallenge2), 'x,y,z')
})

void test('normalizeExpected formats other type challenges', () => {
  const otherChallenge = { type: 'other' as const, expected: '  hello world  ' }
  assert.equal(normalizeExpected(otherChallenge), 'hello world')

  const otherChallenge2 = { type: 'other' as const, expected: 123 }
  assert.equal(normalizeExpected(otherChallenge2), '123')
})
