import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MIXED_CONTENT_PRESENTATION_ERROR,
  getPresentationUrlValidationError,
} from './presentationUrlCompatibility.js'

void test('getPresentationUrlValidationError rejects invalid URLs', () => {
  assert.equal(
    getPresentationUrlValidationError('javascript:alert(1)', 'https:'),
    'Presentation URL must be a valid http(s) URL',
  )
})

void test('getPresentationUrlValidationError rejects http presentations on https hosts', () => {
  assert.equal(
    getPresentationUrlValidationError('http://slides.example/deck.html', 'https:'),
    MIXED_CONTENT_PRESENTATION_ERROR,
  )
})

void test('getPresentationUrlValidationError allows localhost http presentations on https hosts', () => {
  assert.equal(
    getPresentationUrlValidationError('http://localhost:5500/deck.html', 'https:'),
    null,
  )

  assert.equal(
    getPresentationUrlValidationError('http://127.0.0.1:5500/deck.html', 'http:'),
    null,
  )
})

void test('getPresentationUrlValidationError allows loopback ip http presentations on https hosts', () => {
  assert.equal(
    getPresentationUrlValidationError('http://127.0.0.1:5500/deck.html', 'https:'),
    null,
  )
})

void test('getPresentationUrlValidationError allows https presentations on https hosts', () => {
  assert.equal(
    getPresentationUrlValidationError('https://slides.example/deck.html', 'https:'),
    null,
  )
})
